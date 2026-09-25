import { applyLongExitPrice, applyLongFillPrice, commissionCost } from '@/lib/intraday/backtest/executionCost';
import { barEtHHMM, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { buildBarContexts, swingLow } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import { trendResumptionV1Config } from '@/lib/intraday/strategies/trendResumptionV1/config';
import {
  distVwapPct,
  isMomentumExtended,
  resumptionEvidence,
} from '@/lib/intraday/strategies/trendResumptionV1/resumption';
import { TrendResumptionFsm } from '@/lib/intraday/strategies/trendResumptionV1/stateMachine';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  MinuteBar,
  SetupType,
  TradeExitReason,
  TrendResumptionV1Config,
} from '@/lib/intraday/types';

export type TrendResumptionDayResult = { trades: BacktestTrade[] };

export function simulateTrendResumptionV1(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: TrendResumptionV1Config = trendResumptionV1Config('EARLY_RESUMPTION'),
): TrendResumptionDayResult {
  const trades: BacktestTrade[] = [];
  if (bars.length < config.warmupBars + 5) return { trades };

  const contexts = buildBarContexts(bars);
  const refPrice = bars[config.warmupBars]?.c ?? 0;
  const totalShares = sharesFromBudget(effectiveBudgetUsd, refPrice);
  if (!totalShares) return { trades };

  const fsm = new TrendResumptionFsm();
  let state: 'flat' | 'open' = 'flat';
  let entryPrice = 0;
  let entryTime = '';
  let entrySetup: SetupType = 'trend_resumption_building';
  let sharesHeld = 0;
  let roundTrips = 0;
  let cooldownUntilIdx = 0;
  let reasons: string[] = [];
  let initialStop = 0;
  let mfeUsd = 0;
  let maeUsd = 0;

  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlatAfter = etHHMMToMinutes(config.forceFlatEt);

  for (let i = config.warmupBars; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const ctx = contexts[i];
    const ctxPrev = contexts[i - 1];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);
    if (!Number.isFinite(ctx.ema9)) continue;

    if (state === 'open' && tMin >= forceFlatAfter) {
      closeTrade(trades, sessionDate, entrySetup, entryTime, t, entryPrice, b.c, sharesHeld, reasons, mfeUsd, maeUsd, config, 'eod_flat');
      state = 'flat';
      break;
    }

    if (state === 'open') {
      mfeUsd = Math.max(mfeUsd, (b.h - entryPrice) * sharesHeld);
      maeUsd = Math.max(maeUsd, (entryPrice - b.l) * sharesHeld);
      const exit = pickExit(b, ctx, ctxPrev, entryPrice, initialStop, config);
      if (exit) {
        closeTrade(trades, sessionDate, entrySetup, entryTime, t, entryPrice, b.c, sharesHeld, reasons, mfeUsd, maeUsd, config, exit);
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        roundTrips += 1;
        fsm.reset();
      }
      continue;
    }

    if (i < cooldownUntilIdx) continue;
    if (tMin >= noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay) continue;

    fsm.tick(bars, i, b, ctx, ctxPrev, config);

    const trendContext =
      ctx.ema9 > ctx.ema20 && ctx.ema9Slope > 0 && ctx.ema20Slope >= 0 && b.c >= ctx.vwap * 0.998;
    if (!trendContext) continue;

    const ready =
      config.triggerMode === 'CONFIRMED_RESUMPTION'
        ? fsm.readyConfirmedEntry()
        : fsm.readyEarlyEntry();
    if (!ready) continue;

    if (isMomentumExtended(bars, i, b, ctx, ctxPrev, config)) continue;

    const ev = resumptionEvidence(bars, i, b, ctx, ctxPrev, config);
    if (!ev.ok) continue;

    if (config.triggerMode === 'EARLY_RESUMPTION' && ev.phase !== 'BUILDING' && ev.phase !== 'EXPANDING') {
      continue;
    }
    if (config.triggerMode === 'CONFIRMED_RESUMPTION' && ev.phase !== 'EXPANDING') {
      continue;
    }

    entrySetup =
      ev.phase === 'EXPANDING' ? 'trend_resumption_expanding' : 'trend_resumption_building';
    reasons = [
      `trigger ${config.triggerMode}`,
      `FSM ${fsm.phase}`,
      `distVWAP ${distVwapPct(b, ctx).toFixed(3)}%`,
      ...ev.lines,
    ];
    entryPrice = applyLongFillPrice(b.c, config);
    entryTime = t;
    sharesHeld = totalShares;
    const sw = swingLow(bars, i, config.structuralStopLookbackBars);
    initialStop = Math.max(entryPrice * (1 - config.maxLossPctGuard / 100), Math.min(sw, ctx.ema20 * 0.998));
    mfeUsd = 0;
    maeUsd = 0;
    state = 'open';
    fsm.reset();
  }

  if (state === 'open' && bars.length > 0) {
    const last = bars[bars.length - 1];
    const exitT = barEtHHMM(last.t);
    closeTrade(
      trades,
      sessionDate,
      entrySetup,
      entryTime,
      exitT,
      entryPrice,
      last.c,
      sharesHeld,
      reasons,
      mfeUsd,
      maeUsd,
      config,
      etHHMMToMinutes(exitT) >= forceFlatAfter ? 'eod_flat' : 'session_end',
    );
  }

  return { trades };
}

function pickExit(
  b: MinuteBar,
  ctx: { ema9: number; ema20: number },
  ctxPrev: { ema9: number; ema20: number },
  entryPrice: number,
  initialStop: number,
  config: TrendResumptionV1Config,
): TradeExitReason | null {
  if (b.c <= entryPrice * (1 - config.maxLossPctGuard / 100)) return 'max_loss_guard';
  if (b.c <= initialStop) return 'structural_stop';
  if (config.exitOnBearCross && ctxPrev.ema9 >= ctxPrev.ema20 && ctx.ema9 < ctx.ema20) {
    return 'ema_cross_down';
  }
  return null;
}

function closeTrade(
  trades: BacktestTrade[],
  sessionDate: string,
  setupType: SetupType,
  entryTimeEt: string,
  exitTimeEt: string,
  entryPrice: number,
  exitPrice: number,
  shares: number,
  reasons: string[],
  mfeUsd: number,
  maeUsd: number,
  config: TrendResumptionV1Config,
  exitReason: TradeExitReason,
) {
  let pnlUsd = (applyLongExitPrice(exitPrice, config) - entryPrice) * shares;
  pnlUsd -= commissionCost(shares, config) * 2;
  const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  trades.push({
    sessionDate,
    setupType,
    entryTimeEt,
    exitTimeEt,
    entryPrice,
    exitPrice,
    shares,
    pnlUsd,
    pnlPct,
    confidence: 70,
    reasons,
    exitReason,
    mfeUsd,
    maeUsd,
    relativeVolumeAtEntry: 1,
  });
}
