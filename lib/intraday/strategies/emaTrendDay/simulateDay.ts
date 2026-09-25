import { barEtHHMM, computeSessionIndicators, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type { BacktestTrade, EmaTrendDayConfig, MinuteBar, SetupType, TradeExitReason } from '@/lib/intraday/types';

type SimResult = { trades: BacktestTrade[] };

/**
 * Session EMA 9 / 20 only (computed from RTH bars that day).
 * Long when 9 crosses above 20 (or pullback to 9 while 9 > 20). Exit on 9 cross below 20 or EOD flat.
 */
export function simulateEmaTrendDay(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: EmaTrendDayConfig,
): SimResult {
  const trades: BacktestTrade[] = [];
  if (bars.length < config.warmupBars + 5) return { trades };

  const ind = computeSessionIndicators(bars);
  const refPrice = bars[config.warmupBars]?.c ?? bars[0]?.c ?? 0;
  const totalShares = sharesFromBudget(effectiveBudgetUsd, refPrice);
  if (!totalShares) return { trades };

  let state: 'flat' | 'open' = 'flat';
  let entryPrice = 0;
  let entryTime = '';
  let entrySetup: SetupType = 'ema_cross_up';
  let sharesHeld = 0;
  let roundTrips = 0;
  let cooldownUntilIdx = 0;
  let reasons: string[] = [];
  let confidence = 0;

  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlatAfter = etHHMMToMinutes(config.forceFlatEt);

  for (let i = config.warmupBars; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);
    const e9 = ind.ema9[i];
    const e20 = ind.ema20[i];
    const e9Prev = ind.ema9[i - 1];
    const e20Prev = ind.ema20[i - 1];
    if (![e9, e20, e9Prev, e20Prev].every(Number.isFinite)) continue;

    if (state === 'open' && tMin >= forceFlatAfter) {
      trades.push(
        closeTrade(
          sessionDate,
          entrySetup,
          entryTime,
          t,
          entryPrice,
          b.c,
          sharesHeld,
          reasons,
          confidence,
          'eod_flat',
        ),
      );
      state = 'flat';
      break;
    }

    if (state === 'open') {
      const bearCross = e9Prev >= e20Prev && e9 < e20;
      const priceLostFast = config.exitOnCloseBelowFast && b.c < e9 && prev.c >= e9Prev;
      if (bearCross || priceLostFast) {
        trades.push(
          closeTrade(
            sessionDate,
            entrySetup,
            entryTime,
            t,
            entryPrice,
            b.c,
            sharesHeld,
            reasons,
            confidence,
            'ema_cross_down',
          ),
        );
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        roundTrips += 1;
      }
      continue;
    }

    if (i < cooldownUntilIdx) continue;
    if (tMin >= noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay) continue;

    const setup = detectEmaEntry(
      b,
      prev,
      e9,
      e20,
      e9Prev,
      e20Prev,
      config,
    );
    if (!setup) continue;

    entrySetup = setup.type;
    reasons = setup.reasons;
    confidence = setup.confidence;
    entryPrice = b.c;
    entryTime = t;
    sharesHeld = totalShares;
    state = 'open';
  }

  if (state === 'open' && bars.length > 0) {
    const last = bars[bars.length - 1];
    const exitT = barEtHHMM(last.t);
    trades.push(
      closeTrade(
        sessionDate,
        entrySetup,
        entryTime,
        exitT,
        entryPrice,
        last.c,
        sharesHeld,
        reasons,
        confidence,
        etHHMMToMinutes(exitT) >= forceFlatAfter ? 'eod_flat' : 'session_end',
      ),
    );
  }

  return { trades };
}

function detectEmaEntry(
  b: MinuteBar,
  prev: MinuteBar,
  e9: number,
  e20: number,
  e9Prev: number,
  e20Prev: number,
  config: EmaTrendDayConfig,
): { type: SetupType; reasons: string[]; confidence: number } | null {
  const bullCross = e9Prev <= e20Prev && e9 > e20 && b.c > e9;
  if (bullCross) {
    return {
      type: 'ema_cross_up',
      reasons: ['9 EMA crossed above 20 EMA', 'close above 9 EMA'],
      confidence: 70,
    };
  }

  if (!config.allowPullbackEntry) return null;

  const uptrend = e9 > e20;
  const touchedFast =
    uptrend &&
    b.l <= e9 * (1 + config.pullbackTouchPct / 100) &&
    b.c > e9 &&
    prev.c >= e9Prev;
  if (touchedFast) {
    return {
      type: 'ema_pullback',
      reasons: ['9 EMA > 20 EMA', 'pullback hold at 9 EMA'],
      confidence: 62,
    };
  }

  return null;
}

function closeTrade(
  sessionDate: string,
  setupType: SetupType,
  entryTimeEt: string,
  exitTimeEt: string,
  entryPrice: number,
  exitPrice: number,
  shares: number,
  reasons: string[],
  confidence: number,
  exitReason: TradeExitReason,
): BacktestTrade {
  const pnlUsd = (exitPrice - entryPrice) * shares;
  const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  return {
    sessionDate,
    setupType,
    entryTimeEt,
    exitTimeEt,
    entryPrice,
    exitPrice,
    shares,
    pnlUsd,
    pnlPct,
    confidence,
    reasons,
    exitReason,
  };
}
