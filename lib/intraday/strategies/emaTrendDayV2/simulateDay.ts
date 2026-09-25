import { passesForensicsDelayedEntry } from '@/lib/intraday/diagnostics/delayedEntryGate';
import { applyLongExitPrice, applyLongFillPrice, commissionCost } from '@/lib/intraday/backtest/executionCost';
import { barEtHHMM, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import {
  detectEmaOnlyEntry,
  detectMomentumCrossEntry,
  detectMomentumPullbackEntry,
  detectRegimeEntry,
} from '@/lib/intraday/strategies/emaTrendDayV2/entryLogic';
import { buildBarContexts, swingLow, type BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import {
  evaluateMomentum,
  passesMomentumGate,
} from '@/lib/intraday/strategies/emaTrendDayV2/momentumEngine';
import { PullbackStateMachine } from '@/lib/intraday/strategies/emaTrendDayV2/pullbackState';
import { classifyRegime } from '@/lib/intraday/strategies/emaTrendDayV2/regime';
import {
  distPctFromEma9,
  distPctFromVwap,
  isPriceExtended,
  passesVolumeFilter,
  scoreEntryCandidate,
} from '@/lib/intraday/strategies/emaTrendDayV2/score';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  EmaTrendDayV2Config,
  MarketRegime,
  MinuteBar,
  SetupType,
  SignalLogEntry,
  TradeExitReason,
} from '@/lib/intraday/types';

export type EmaV2DayResult = {
  trades: BacktestTrade[];
  signalLog: SignalLogEntry[];
};

export function simulateEmaTrendDayV2(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: EmaTrendDayV2Config = DEFAULT_EMA_TREND_DAY_V2_CONFIG,
): EmaV2DayResult {
  const trades: BacktestTrade[] = [];
  const signalLog: SignalLogEntry[] = [];
  if (bars.length < config.warmupBars + 5) return { trades, signalLog };

  const contexts = buildBarContexts(bars);
  const refPrice = bars[config.warmupBars]?.c ?? 0;
  const totalShares = sharesFromBudget(effectiveBudgetUsd, refPrice);
  if (!totalShares) return { trades, signalLog };

  let state: 'flat' | 'open' = 'flat';
  let entryPrice = 0;
  let entryTime = '';
  let entrySetup: SetupType = 'ema_cross_up_confirmed';
  let sharesHeld = 0;
  let roundTrips = 0;
  let cooldownUntilIdx = 0;
  let reasons: string[] = [];
  let confidence = 0;
  let regimeAtEntry: MarketRegime = 'UNKNOWN';
  let relVolEntry = 1;
  let initialStop = 0;
  let highestSinceEntry = 0;
  let peakUnrealizedPct = 0;
  let consecutiveLosses = 0;
  let sessionHalted = false;
  let lastExitWasLoss = false;
  let mfeUsd = 0;
  let maeUsd = 0;
  const pullbackFsm = new PullbackStateMachine();

  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlatAfter = etHHMMToMinutes(config.forceFlatEt);

  const logSignal = (
    i: number,
    b: MinuteBar,
    ctx: BarContext,
    regime: MarketRegime,
    signalType: string,
    score: number,
    scoreLines: string[],
    accepted: boolean,
    rejectionReason?: string,
    momentumScore?: number,
  ) => {
    signalLog.push({
      sessionDate,
      timeEt: barEtHHMM(b.t),
      price: b.c,
      ema9: ctx.ema9,
      ema20: ctx.ema20,
      emaSpreadPct: ctx.emaSpreadPct,
      ema9Slope: ctx.ema9Slope,
      ema20Slope: ctx.ema20Slope,
      vwap: ctx.vwap,
      relativeVolume: ctx.relVolume,
      distEma9Pct: distPctFromEma9(b, ctx),
      distVwapPct: distPctFromVwap(b, ctx),
      regime,
      signalType,
      score,
      momentumScore,
      scoreLines,
      accepted,
      rejectionReason,
    });
  };

  for (let i = config.warmupBars; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const ctx = contexts[i];
    const ctxPrev = contexts[i - 1];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);
    if (!Number.isFinite(ctx.ema9)) continue;

    const regime = classifyRegime(b, ctx, config);

    if (state === 'open' && tMin >= forceFlatAfter) {
      pushTrade(
        trades,
        sessionDate,
        entrySetup,
        entryTime,
        t,
        entryPrice,
        applyLongExitPrice(b.c, config),
        sharesHeld,
        reasons,
        confidence,
        regimeAtEntry,
        relVolEntry,
        mfeUsd,
        maeUsd,
        config,
        'eod_flat',
      );
      if (b.c < entryPrice) consecutiveLosses += 1;
      else consecutiveLosses = 0;
      state = 'flat';
      break;
    }

    if (state === 'open') {
      highestSinceEntry = Math.max(highestSinceEntry, b.h);
      const unrealPct = ((b.c - entryPrice) / entryPrice) * 100;
      peakUnrealizedPct = Math.max(
        peakUnrealizedPct,
        ((highestSinceEntry - entryPrice) / entryPrice) * 100,
      );
      mfeUsd = Math.max(mfeUsd, (b.h - entryPrice) * sharesHeld);
      maeUsd = Math.max(maeUsd, (entryPrice - b.l) * sharesHeld);

      const exit = pickExit(
        b,
        prev,
        ctx,
        ctxPrev,
        entryPrice,
        initialStop,
        peakUnrealizedPct,
        unrealPct,
        i,
        bars,
        config,
      );
      if (exit) {
        pushTrade(
          trades,
          sessionDate,
          entrySetup,
          entryTime,
          t,
          entryPrice,
          applyLongExitPrice(b.c, config),
          sharesHeld,
          reasons,
          confidence,
          regimeAtEntry,
          relVolEntry,
          mfeUsd,
          maeUsd,
          config,
          exit,
        );
        const loss = b.c < entryPrice;
        lastExitWasLoss = loss;
        if (loss) consecutiveLosses += 1;
        else consecutiveLosses = 0;
        if (consecutiveLosses >= config.consecutiveLossHalt) sessionHalted = true;
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        roundTrips += 1;
      }
      continue;
    }

    if (sessionHalted) continue;
    if (i < cooldownUntilIdx) continue;
    if (tMin >= noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay) continue;

    const minScore =
      lastExitWasLoss && config.requireStrongerAfterLoss
        ? config.minScoreAfterLoss
        : config.minScoreToEnter;

    const entryMode = config.entryMode ?? 'EMA_REGIME_MOMENTUM';
    if (entryMode === 'EMA_REGIME_MOMENTUM' && config.allowPullbackEntry) {
      pullbackFsm.tick(b, prev, ctx, config);
    }
    const candidate = resolveEntryCandidate(
      b,
      prev,
      ctx,
      ctxPrev,
      config,
      entryMode,
      pullbackFsm,
    );
    if (!candidate) continue;

    const scored =
      entryMode === 'EMA_ONLY'
        ? { score: 100, lines: [`EMA_ONLY ${candidate.type}`] }
        : scoreEntryCandidate(candidate.type, b, ctx, regime, config);

    let momentumScore: number | undefined;
    let momentumLines: string[] = [];
    if (entryMode === 'EMA_REGIME_MOMENTUM') {
      const mom = evaluateMomentum(bars, i, b, ctx, ctxPrev, config);
      momentumScore = mom.score;
      momentumLines = [`MOMENTUM SCORE: ${mom.score}`, ...mom.lines];
      const gate = passesMomentumGate(
        mom,
        config,
        config.microBreakRequiredForPullback,
        candidate.isPullback,
      );
      if (!gate.ok) {
        logSignal(
          i,
          b,
          ctx,
          regime,
          candidate.type,
          scored.score,
          [...scored.lines, ...momentumLines],
          false,
          gate.reason,
          momentumScore,
        );
        continue;
      }
    }

    const allLines = [...scored.lines, ...momentumLines];
    logSignal(i, b, ctx, regime, candidate.type, scored.score, allLines, false, undefined, momentumScore);
    const logIdx = signalLog.length - 1;

    const reject = (reason: string) => {
      signalLog[logIdx].accepted = false;
      signalLog[logIdx].rejectionReason = reason;
    };

    if (entryMode !== 'EMA_ONLY') {
      if (regime !== 'BULL_TREND') {
        reject('CHOP_OR_NON_BULL_REGIME');
        continue;
      }
      if (isPriceExtended(b, ctx, config)) {
        reject('PRICE_EXTENDED');
        continue;
      }
      if (!passesVolumeFilter(ctx, config)) {
        reject('VOLUME_FILTER');
        continue;
      }
      if (scored.score < minScore) {
        reject('SCORE_BELOW_MIN');
        continue;
      }
    }

    if (
      config.forensicsDelayedEntryVariant &&
      config.forensicsDelayedEntryVariant !== 'A' &&
      !passesForensicsDelayedEntry(bars, i, b, ctx, config)
    ) {
      reject('DELAYED_CONFIRMATION');
      continue;
    }

    signalLog[logIdx].accepted = true;
    entrySetup = candidate.type;
    reasons = allLines;
    confidence = scored.score;
    regimeAtEntry = regime;
    relVolEntry = ctx.relVolume;
    entryPrice = applyLongFillPrice(b.c, config);
    entryTime = t;
    sharesHeld = totalShares;
    const sw = swingLow(bars, i, config.structuralStopLookbackBars);
    const ema20Stop = ctx.ema20 * 0.998;
    const maxLossStop = entryPrice * (1 - config.maxLossPctGuard / 100);
    initialStop = Math.max(maxLossStop, Math.min(sw, ema20Stop));
    highestSinceEntry = b.h;
    peakUnrealizedPct = 0;
    mfeUsd = 0;
    maeUsd = 0;
    pullbackFsm.reset();
    state = 'open';
  }

  if (state === 'open' && bars.length > 0) {
    const last = bars[bars.length - 1];
    const exitT = barEtHHMM(last.t);
    pushTrade(
      trades,
      sessionDate,
      entrySetup,
      entryTime,
      exitT,
      entryPrice,
      applyLongExitPrice(last.c, config),
      sharesHeld,
      reasons,
      confidence,
      regimeAtEntry,
      relVolEntry,
      mfeUsd,
      maeUsd,
      config,
      etHHMMToMinutes(exitT) >= forceFlatAfter ? 'eod_flat' : 'session_end',
    );
  }

  return { trades, signalLog };
}

function resolveEntryCandidate(
  b: MinuteBar,
  prev: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: EmaTrendDayV2Config,
  entryMode: EmaTrendDayV2Config['entryMode'],
  pullbackFsm: PullbackStateMachine,
): { type: 'ema_cross_up_confirmed' | 'ema_pullback_confirmed'; isPullback: boolean } | null {
  if (entryMode === 'EMA_ONLY') {
    const raw = detectEmaOnlyEntry(b, prev, ctx, ctxPrev, config);
    if (!raw) return null;
    return {
      type: raw.type === 'ema_cross_up' ? 'ema_cross_up_confirmed' : 'ema_pullback_confirmed',
      isPullback: raw.type === 'ema_pullback',
    };
  }

  if (entryMode === 'EMA_REGIME') {
    const raw = detectRegimeEntry(b, prev, ctx, ctxPrev, config);
    if (!raw) return null;
    return { type: raw.type, isPullback: raw.type === 'ema_pullback_confirmed' };
  }

  const cross = detectMomentumCrossEntry(b, ctx, ctxPrev);
  if (cross) return { type: cross.type, isPullback: false };

  if (config.allowPullbackEntry && pullbackFsm.readyForMomentumEntry()) {
    const pb = detectMomentumPullbackEntry(b, ctx);
    if (pb) return { type: pb.type, isPullback: true };
  }

  return null;
}

function pickExit(
  b: MinuteBar,
  prev: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  entryPrice: number,
  initialStop: number,
  peakUnrealizedPct: number,
  unrealPct: number,
  i: number,
  bars: MinuteBar[],
  config: EmaTrendDayV2Config,
): TradeExitReason | null {
  if (b.c <= entryPrice * (1 - config.maxLossPctGuard / 100)) return 'max_loss_guard';
  if (b.c <= initialStop) return 'structural_stop';

  if (
    config.profitProtectMode === 'PROFIT_GIVEBACK' &&
    peakUnrealizedPct >= config.profitGivebackActivatePct
  ) {
    const floor = peakUnrealizedPct * (1 - config.profitGivebackRetracePct / 100);
    if (unrealPct < floor && unrealPct > 0) return 'profit_giveback';
  }

  if (config.exitOnEma9Close && b.c < ctx.ema9 && prev.c >= ctxPrev.ema9) return 'ema9_close';
  if (config.exitOnEma20Close && b.c < ctx.ema20 && prev.c >= ctxPrev.ema20) return 'ema20_close';
  if (config.exitOnVwapClose && b.c < ctx.vwap && prev.c >= ctxPrev.vwap) return 'vwap_close';
  if (config.exitOnSwingLowBreak) {
    const sw = swingLow(bars, i - 1, config.structuralStopLookbackBars);
    if (b.c < sw) return 'swing_low_break';
  }

  if (config.exitOnBearCross && ctxPrev.ema9 >= ctxPrev.ema20 && ctx.ema9 < ctx.ema20) {
    return 'ema_cross_down';
  }

  return null;
}

function pushTrade(
  trades: BacktestTrade[],
  sessionDate: string,
  setupType: SetupType,
  entryTimeEt: string,
  exitTimeEt: string,
  entryPrice: number,
  exitPrice: number,
  shares: number,
  reasons: string[],
  confidence: number,
  regimeAtEntry: MarketRegime,
  relVolEntry: number,
  mfeUsd: number,
  maeUsd: number,
  config: EmaTrendDayV2Config,
  exitReason: TradeExitReason,
) {
  let pnlUsd = (exitPrice - entryPrice) * shares;
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
    confidence,
    reasons,
    exitReason,
    regimeAtEntry,
    mfeUsd,
    maeUsd,
    relativeVolumeAtEntry: relVolEntry,
  });
}
