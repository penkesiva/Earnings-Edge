import { barEtHHMM, computeSessionIndicators, etHHMMToMinutes, openingRange } from '@/lib/intraday/indicators/engine';
import { scaleShares, sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  IntradayStrategyConfig,
  MinuteBar,
  SetupType,
  TradeExitReason,
} from '@/lib/intraday/types';

type SimResult = { trades: BacktestTrade[] };

export function simulateVwapOrDay(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: IntradayStrategyConfig,
): SimResult {
  const trades: BacktestTrade[] = [];
  if (bars.length < config.openingRangeMinutes + 5) return { trades };

  const or = openingRange(bars, config.openingRangeMinutes);
  if (!or) return { trades };

  const ind = computeSessionIndicators(bars);
  const totalShares = sharesFromBudget(effectiveBudgetUsd, bars[config.openingRangeMinutes]?.c ?? 0);
  if (!totalShares) return { trades };

  let state: 'flat' | 'open' = 'flat';
  let entryPrice = 0;
  let entryTime = '';
  let entrySetup: SetupType = 'vwap_pullback';
  let sharesHeld = 0;
  let tradesToday = 0;
  let cooldownUntilIdx = 0;
  let stop = 0;
  let reasons: string[] = [];
  let confidence = 0;

  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlatAfter = etHHMMToMinutes(config.forceFlatEt);
  const maxStopFloor = 1 - config.maxStopPct / 100;

  for (let i = config.openingRangeMinutes; i < bars.length; i++) {
    const b = bars[i];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);
    if (tMin >= forceFlatAfter && state === 'open') {
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
    if (state === 'flat' && i < cooldownUntilIdx) continue;
    if (state === 'flat' && tMin >= noNewEntriesAfter) continue;
    if (state === 'flat' && tradesToday >= config.maxTradesPerDay) continue;

    const vwap = ind.vwap[i];
    const e9 = ind.ema9[i];
    const e20 = ind.ema20[i];
    const rv = ind.relVolume[i];
    if (!Number.isFinite(vwap) || vwap <= 0) continue;

    if (state === 'open') {
      const pnlPct = ((b.c - entryPrice) / entryPrice) * 100;
      if (b.l <= stop) {
        trades.push(
          closeTrade(
            sessionDate,
            entrySetup,
            entryTime,
            t,
            entryPrice,
            stop,
            sharesHeld,
            reasons,
            confidence,
            'stop',
          ),
        );
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        continue;
      }
      if (pnlPct >= config.target1Pct) {
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
            'target',
          ),
        );
        state = 'flat';
        cooldownUntilIdx = i + config.cooldownMinutes;
        continue;
      }
      continue;
    }

    const setup = detectLongSetup(bars, i, or, ind, vwap, e9, e20, rv);
    if (!setup || setup.confidence < config.minConfidence) continue;

    entrySetup = setup.type;
    reasons = setup.reasons;
    confidence = setup.confidence;
    entryPrice = b.c;
    entryTime = t;
    sharesHeld = scaleShares(totalShares, config.scaleFirstPct);
    if (setup.addFull) sharesHeld = totalShares;
    stop = Math.max(entryPrice * maxStopFloor, setup.stop);
    state = 'open';
    tradesToday += 1;
  }

  if (state === 'open' && bars.length > 0) {
    const last = bars[bars.length - 1];
    trades.push(
      closeTrade(
        sessionDate,
        entrySetup,
        entryTime,
        barEtHHMM(last.t),
        entryPrice,
        last.c,
        sharesHeld,
        reasons,
        confidence,
        'session_end',
      ),
    );
  }

  return { trades };
}

function detectLongSetup(
  bars: MinuteBar[],
  i: number,
  or: { orh: number; orl: number },
  ind: ReturnType<typeof computeSessionIndicators>,
  vwap: number,
  e9: number,
  e20: number,
  rv: number,
): { type: SetupType; reasons: string[]; confidence: number; stop: number; addFull: boolean } | null {
  const b = bars[i];
  const prev = bars[i - 1];
  const reasons: string[] = [];
  let score = 40;

  if (e9 > e20) {
    score += 10;
    reasons.push('9 EMA > 20 EMA');
  }
  if (rv >= 1.2) {
    score += 15;
    reasons.push('volume expansion');
  }

  const reclaimedVwap = prev.c <= vwap && b.c > vwap && b.l <= vwap * 1.002;
  if (reclaimedVwap && e9 >= e20) {
    reasons.push('VWAP reclaim');
    score += 20;
    return {
      type: 'vwap_pullback',
      reasons,
      confidence: Math.min(100, score),
      stop: Math.min(b.l, vwap * 0.995),
      addFull: false,
    };
  }

  if (b.c > or.orh && prev.c <= or.orh && b.c > vwap) {
    reasons.push('ORH breakout');
    reasons.push('above VWAP');
    score += 25;
    return {
      type: 'or_breakout',
      reasons,
      confidence: Math.min(100, score),
      stop: or.orl,
      addFull: true,
    };
  }

  if (b.c > or.orh && b.l <= or.orh && b.c > vwap && e9 > e20) {
    reasons.push('ORH retest hold');
    score += 15;
    return {
      type: 'or_retest',
      reasons,
      confidence: Math.min(100, score),
      stop: or.orl,
      addFull: false,
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
  exitReason?: TradeExitReason,
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
