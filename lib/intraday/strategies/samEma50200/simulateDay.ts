import { applyLongExitPrice, applyLongFillPrice, commissionCost } from '@/lib/intraday/backtest/executionCost';
import { etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { DEFAULT_SAM_EMA50_200_CONFIG } from '@/lib/intraday/strategies/samEma50200/config';
import { aggregateBars, atr, ema, slopePct } from '@/lib/intraday/strategies/samEma50200/indicators';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  MinuteBar,
  SamEma50200Config,
  TradeExitReason,
} from '@/lib/intraday/types';

export type SamEma50200DayResult = { trades: BacktestTrade[] };

/**
 * SAM EMA 50/200 on N-minute bars. Indicators run over prior sessions + today so EMA200 is
 * valid at the open; trades only on `sessionDate`, always flat by `forceFlatEt`.
 *
 * Entry: EMA50 crosses above EMA200 (within `crossEntryWindowBars`), EMA50 rising, close > EMA50.
 * With `dualSlopeReversalEntry` (v2), also at the bar where both EMA slopes turn positive after a slow joint decline.
 * Exit: EMA50 slope turns negative and reaches -ratio x its peak since entry; disaster ATR stop; EOD.
 */
export function simulateSamEma50200(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: SamEma50200Config = DEFAULT_SAM_EMA50_200_CONFIG,
  priorBars: MinuteBar[] = [],
): SamEma50200DayResult {
  const trades: BacktestTrade[] = [];
  const series = aggregateBars([...priorBars, ...bars], config.barMinutes);
  const firstToday = series.findIndex(b => b.sessionDate === sessionDate);
  if (firstToday < 1) return { trades };

  const closes = series.map(b => b.c);
  const e50 = ema(closes, config.emaFast);
  const e200 = ema(closes, config.emaSlow);
  const a = atr(series, config.atrPeriod);
  const s50 = series.map((_, i) => slopePct(e50, i, config.slopeLookbackBars));
  const s200 = series.map((_, i) => slopePct(e200, i, config.slopeLookbackBars));

  const totalShares = sharesFromBudget(effectiveBudgetUsd, series[firstToday].c);
  if (!totalShares) return { trades };

  const firstEntry = etHHMMToMinutes(config.firstEntryEt);
  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlat = etHHMMToMinutes(config.forceFlatEt);
  const L = config.slopeLookbackBars;

  let open = false;
  let entryPrice = 0;
  let entryTime = '';
  let stopPrice = 0;
  let peakSlope = 0;
  let reasons: string[] = [];
  let mfeUsd = 0;
  let maeUsd = 0;
  let roundTrips = 0;
  let cooldownUntil = 0;
  let lastCrossIdx = -1;
  let usedCrossIdx = -1;
  let entrySetup = config.crossSetupType;

  const close = (exitTime: string, rawExit: number, exitReason: TradeExitReason) => {
    let pnlUsd = (applyLongExitPrice(rawExit, config) - entryPrice) * totalShares;
    pnlUsd -= commissionCost(totalShares, config) * 2;
    trades.push({
      sessionDate,
      setupType: entrySetup,
      entryTimeEt: entryTime,
      exitTimeEt: exitTime,
      entryPrice,
      exitPrice: rawExit,
      shares: totalShares,
      pnlUsd,
      pnlPct: entryPrice > 0 ? ((rawExit - entryPrice) / entryPrice) * 100 : 0,
      confidence: 70,
      reasons,
      exitReason,
      mfeUsd,
      maeUsd,
    });
    open = false;
  };

  for (let i = 1; i < series.length; i++) {
    if (
      [e50[i - 1], e200[i - 1], e50[i], e200[i]].every(Number.isFinite) &&
      e50[i - 1] <= e200[i - 1] &&
      e50[i] > e200[i]
    ) {
      lastCrossIdx = i;
    }

    const b = series[i];
    if (i < firstToday || b.sessionDate !== sessionDate) continue;
    const tMin = etHHMMToMinutes(b.endEt);
    const slopeNow = slopePct(e50, i, L);

    if (open) {
      mfeUsd = Math.max(mfeUsd, (b.h - entryPrice) * totalShares);
      maeUsd = Math.max(maeUsd, (entryPrice - b.l) * totalShares);
      if (Number.isFinite(slopeNow)) peakSlope = Math.max(peakSlope, slopeNow);

      let exit: { price: number; reason: TradeExitReason } | null = null;
      if (b.l <= stopPrice) {
        exit = { price: Math.min(b.o, stopPrice), reason: 'stop' };
      } else if (
        Number.isFinite(slopeNow) &&
        slopeNow < 0 &&
        slopeNow <= -config.exitSlopeReversalRatio * peakSlope
      ) {
        exit = { price: b.c, reason: 'ema50_slope_reversal' };
      } else if (tMin >= forceFlat) {
        exit = { price: b.c, reason: 'eod_flat' };
      }

      if (exit) {
        if (exit.reason === 'ema50_slope_reversal') {
          reasons = [
            ...reasons,
            `exit: EMA50 slope ${slopeNow.toFixed(3)}% <= -${config.exitSlopeReversalRatio.toFixed(2)} x peak ${peakSlope.toFixed(3)}%`,
          ];
        }
        close(b.endEt, exit.price, exit.reason);
        roundTrips += 1;
        cooldownUntil = i + config.cooldownBars + 1;
      }
      continue;
    }

    if (tMin < firstEntry || tMin > noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay || i < cooldownUntil) continue;
    if (![e50[i], e200[i], slopeNow, a[i]].every(Number.isFinite)) continue;

    let entryLines: string[] | null = null;

    const crossFresh =
      lastCrossIdx >= 0 &&
      lastCrossIdx !== usedCrossIdx &&
      i - lastCrossIdx <= config.crossEntryWindowBars;
    if (crossFresh && e50[i] > e200[i] && slopeNow > 0 && b.c > e50[i]) {
      usedCrossIdx = lastCrossIdx;
      entrySetup = config.crossSetupType;
      entryLines = [
        `EMA50 crossed above EMA200 at ${series[lastCrossIdx].endEt} (${series[lastCrossIdx].sessionDate})`,
        `close ${b.c.toFixed(2)} > EMA50 ${e50[i].toFixed(2)} > EMA200 ${e200[i].toFixed(2)}`,
        `EMA50 slope ${slopeNow.toFixed(3)}% rising`,
      ];
    } else if (config.dualSlopeReversalEntry) {
      const rev = dualSlopeReversal(s50, s200, i, config);
      if (rev) {
        entrySetup = config.reversalSetupType;
        entryLines = [
          `EMA50 + EMA200 slopes both turned positive (${s50[i].toFixed(4)}% / ${s200[i].toFixed(4)}%)`,
          `slow decline before the turn: ${rev.downBars}/${config.reversalLookbackBars} bars both falling, steepest EMA50 slope ${rev.minSlope50.toFixed(3)}%`,
          `close ${b.c.toFixed(2)}, EMA50 ${e50[i].toFixed(2)}, EMA200 ${e200[i].toFixed(2)}`,
        ];
      }
    }
    if (!entryLines) continue;

    entryPrice = applyLongFillPrice(b.c, config);
    entryTime = b.endEt;
    stopPrice = entryPrice - config.atrStopMult * a[i];
    peakSlope = slopeNow;
    mfeUsd = 0;
    maeUsd = 0;
    reasons = [
      ...entryLines,
      `disaster stop ${stopPrice.toFixed(2)} (${config.atrStopMult}x ATR ${a[i].toFixed(3)})`,
    ];
    open = true;
  }

  if (open) {
    const last = series[series.length - 1];
    close(last.endEt, last.c, 'session_end');
  }

  return { trades };
}

/**
 * Turn bar: both slopes positive now and not both positive on the previous bar.
 * EMA50 usually turns well before EMA200, so the slow-decline window ends at the last bar where
 * both were still falling, which must be within `reversalMaxTurnBars` of the turn.
 */
export function dualSlopeReversal(
  s50: number[],
  s200: number[],
  i: number,
  config: SamEma50200Config,
): { downBars: number; minSlope50: number } | null {
  if (!(s50[i] > 0 && s200[i] > 0)) return null;
  if (s50[i - 1] > 0 && s200[i - 1] > 0) return null;

  let lastBothDown = -1;
  for (let j = i - 1; j >= Math.max(0, i - config.reversalMaxTurnBars); j--) {
    if (s50[j] < 0 && s200[j] < 0) {
      lastBothDown = j;
      break;
    }
  }
  if (lastBothDown < 0) return null;

  const W = config.reversalLookbackBars;
  const from = lastBothDown - W + 1;
  if (from < 0) return null;
  let downBars = 0;
  let minSlope50 = Infinity;
  for (let j = from; j <= lastBothDown; j++) {
    if (!Number.isFinite(s50[j]) || !Number.isFinite(s200[j])) return null;
    if (s50[j] < 0 && s200[j] < 0) downBars += 1;
    minSlope50 = Math.min(minSlope50, s50[j]);
  }
  if (downBars < config.reversalMinDownBars) return null;
  if (minSlope50 < -config.reversalMaxDeclineSlopePct) return null;
  return { downBars, minSlope50 };
}
