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

  const close = (exitTime: string, rawExit: number, exitReason: TradeExitReason) => {
    let pnlUsd = (applyLongExitPrice(rawExit, config) - entryPrice) * totalShares;
    pnlUsd -= commissionCost(totalShares, config) * 2;
    trades.push({
      sessionDate,
      setupType: 'sam_ema50_200',
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
    if (lastCrossIdx < 0 || lastCrossIdx === usedCrossIdx) continue;
    if (i - lastCrossIdx > config.crossEntryWindowBars) continue;
    if (![e50[i], e200[i], slopeNow, a[i]].every(Number.isFinite)) continue;

    const bullish = e50[i] > e200[i] && slopeNow > 0 && b.c > e50[i];
    if (!bullish) continue;

    usedCrossIdx = lastCrossIdx;
    entryPrice = applyLongFillPrice(b.c, config);
    entryTime = b.endEt;
    stopPrice = entryPrice - config.atrStopMult * a[i];
    peakSlope = slopeNow;
    mfeUsd = 0;
    maeUsd = 0;
    reasons = [
      `EMA50 crossed above EMA200 at ${series[lastCrossIdx].endEt} (${series[lastCrossIdx].sessionDate})`,
      `close ${b.c.toFixed(2)} > EMA50 ${e50[i].toFixed(2)} > EMA200 ${e200[i].toFixed(2)}`,
      `EMA50 slope ${slopeNow.toFixed(3)}% rising`,
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
