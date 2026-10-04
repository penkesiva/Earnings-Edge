import { applyLongExitPrice, applyLongFillPrice, commissionCost } from '@/lib/intraday/backtest/executionCost';
import { barEtHHMM, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import { candleParts, isHammer, isUpperWickRejection } from '@/lib/intraday/strategies/samEma50200/candles';
import { DEFAULT_SAM_V3_CONFIG } from '@/lib/intraday/strategies/samEma50200/config';
import { aggregateBars, atr, ema, slopePct } from '@/lib/intraday/strategies/samEma50200/indicators';
import { dualSlopeReversal } from '@/lib/intraday/strategies/samEma50200/simulateDay';
import { sharesFromBudget } from '@/lib/intraday/sizing/computeShares';
import type {
  BacktestTrade,
  MinuteBar,
  SamV3Config,
  SetupType,
  TradeExitReason,
} from '@/lib/intraday/types';

export type SamV3DayResult = { trades: BacktestTrade[] };

/**
 * SAM v3. Every decision is made at the open of candle i from completed candles (<= i-1) plus open[i].
 * Entries and candle exits fill at open[i]; stops fill intrabar at min(open, stop).
 * Trade times are candle i's start time.
 */
export function simulateSamV3(
  sessionDate: string,
  bars: MinuteBar[],
  effectiveBudgetUsd: number,
  config: SamV3Config = DEFAULT_SAM_V3_CONFIG,
  priorBars: MinuteBar[] = [],
): SamV3DayResult {
  const trades: BacktestTrade[] = [];
  const series = aggregateBars([...priorBars, ...bars], config.barMinutes);
  const firstToday = series.findIndex(b => b.sessionDate === sessionDate);
  if (firstToday < 2) return { trades };

  const closes = series.map(b => b.c);
  const e50 = ema(closes, config.emaFast);
  const e200 = ema(closes, config.emaSlow);
  const a = atr(series, config.atrPeriod);
  const s50 = series.map((_, i) => slopePct(e50, i, config.slopeLookbackBars));
  const s200 = series.map((_, i) => slopePct(e200, i, config.slopeLookbackBars));

  const totalShares = sharesFromBudget(effectiveBudgetUsd, series[firstToday].o);
  if (!totalShares) return { trades };

  const F = `EMA${config.emaFast}`;
  const S = `EMA${config.emaSlow}`;
  const firstEntry = etHHMMToMinutes(config.firstEntryEt);
  const noNewEntriesAfter = etHHMMToMinutes(config.noNewEntriesAfterEt);
  const forceFlat = etHHMMToMinutes(config.forceFlatEt);

  let open = false;
  let entryPrice = 0;
  let entryTime = '';
  let entryIdx = 0;
  let entrySetup: SetupType = config.crossSetupType;
  let initialStop = 0;
  let trailStop = 0;
  let trailActive = false;
  let riskR = 0;
  let highSinceEntry = 0;
  let peakSlope = 0;
  let reasons: string[] = [];
  let mfeUsd = 0;
  let maeUsd = 0;
  let roundTrips = 0;
  let cooldownUntil = 0;
  let lastCrossIdx = -1;
  let usedCrossIdx = -1;

  const lowestLow = (from: number, to: number) => {
    let lo = Infinity;
    for (let j = Math.max(0, from); j <= to; j++) lo = Math.min(lo, series[j].l);
    return lo;
  };

  const close = (exitTime: string, rawExit: number, exitReason: TradeExitReason, line?: string) => {
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
      reasons: line ? [...reasons, `exit: ${line}`] : reasons,
      exitReason,
      mfeUsd,
      maeUsd,
    });
    open = false;
  };

  /** Intrabar stop check on candle i. Returns true if the trade closed. */
  const checkStops = (i: number, t: string): boolean => {
    const b = series[i];
    const level = trailActive ? Math.max(initialStop, trailStop) : initialStop;
    if (b.l > level) return false;
    const isTrail = trailActive && trailStop > initialStop;
    close(
      t,
      Math.min(b.o, level),
      isTrail ? 'trailing_stop' : 'stop',
      isTrail
        ? `low ${b.l.toFixed(2)} broke trailing stop ${level.toFixed(2)} (lowest of last ${config.trailLookbackBars} lows)`
        : `low ${b.l.toFixed(2)} hit initial stop ${level.toFixed(2)}`,
    );
    return true;
  };

  /** Fold completed candle i into the open trade's running state. */
  const updateOpenState = (i: number) => {
    const b = series[i];
    highSinceEntry = Math.max(highSinceEntry, b.h);
    if (Number.isFinite(s50[i])) peakSlope = Math.max(peakSlope, s50[i]);
    mfeUsd = Math.max(mfeUsd, (b.h - entryPrice) * totalShares);
    maeUsd = Math.max(maeUsd, (entryPrice - b.l) * totalShares);
    if (!trailActive && riskR > 0 && highSinceEntry >= entryPrice + config.trailActivateR * riskR) {
      trailActive = true;
    }
    if (trailActive) {
      trailStop = Math.max(trailStop, lowestLow(i - config.trailLookbackBars + 1, i));
    }
  };

  for (let i = 2; i < series.length; i++) {
    const p = i - 1;
    if (
      [e50[p - 1], e200[p - 1], e50[p], e200[p]].every(Number.isFinite) &&
      e50[p - 1] <= e200[p - 1] &&
      e50[p] > e200[p]
    ) {
      lastCrossIdx = p;
    }

    const b = series[i];
    if (i < firstToday || b.sessionDate !== sessionDate) continue;
    const prev = series[p];
    const t = barEtHHMM(b.t);
    const tMin = etHHMMToMinutes(t);

    if (open) {
      const prevParts = candleParts(prev);
      const candleSellsActive = i - entryIdx >= config.exitGraceBars;
      const atrP = Number.isFinite(a[p]) ? a[p] : 0;
      const gapLevel = prev.l - config.gapExitMinAtr * atrP;
      const ema50BreakLevel = e50[p] - config.ema50BreakBufferAtr * atrP;
      let exit: { reason: TradeExitReason; line: string } | null = null;
      if (candleSellsActive && b.o < gapLevel) {
        exit = {
          reason: 'gap_below_prev_low',
          line: `open ${b.o.toFixed(2)} < previous low ${prev.l.toFixed(2)} - ${config.gapExitMinAtr}x ATR ${atrP.toFixed(3)} = ${gapLevel.toFixed(2)}`,
        };
      } else if (
        candleSellsActive &&
        Number.isFinite(e50[p]) &&
        prev.c < ema50BreakLevel &&
        b.o < e50[p]
      ) {
        exit = {
          reason: 'ema50_break_confirmed',
          line: `previous close ${prev.c.toFixed(2)} < ${F} ${e50[p].toFixed(2)} - ${config.ema50BreakBufferAtr}x ATR = ${ema50BreakLevel.toFixed(2)}; open ${b.o.toFixed(2)} below ${F}`,
        };
      } else if (
        candleSellsActive &&
        isUpperWickRejection(prev, config.wickBodyRatio, config.upperWickRangePct) &&
        prev.h >= highSinceEntry &&
        b.o < prevParts.bodyMid
      ) {
        exit = {
          reason: 'upper_wick_rejection',
          line: `upper wick ${prevParts.upperWick.toFixed(2)} vs body ${prevParts.body.toFixed(2)} at high ${prev.h.toFixed(2)}; open ${b.o.toFixed(2)} < body mid ${prevParts.bodyMid.toFixed(2)}`,
        };
      } else if (
        Number.isFinite(s50[p]) &&
        s50[p] < 0 &&
        s50[p] <= -config.exitSlopeReversalRatio * peakSlope
      ) {
        exit = {
          reason: 'ema50_slope_reversal',
          line: `${F} slope ${s50[p].toFixed(4)}% <= -${config.exitSlopeReversalRatio.toFixed(2)} x peak ${peakSlope.toFixed(4)}%`,
        };
      } else if (tMin >= forceFlat) {
        exit = { reason: 'eod_flat', line: `end of day ${t} ET` };
      }

      if (exit) {
        close(t, b.o, exit.reason, exit.line);
      } else if (!checkStops(i, t)) {
        updateOpenState(i);
      }
      if (!open) {
        roundTrips += 1;
        cooldownUntil = i + config.cooldownBars + 1;
      }
      continue;
    }

    if (tMin < firstEntry || tMin > noNewEntriesAfter) continue;
    if (roundTrips >= config.maxTradesPerDay || i < cooldownUntil) continue;
    if (![e50[p], e200[p], s50[p], a[p]].every(Number.isFinite)) continue;

    const trend = e50[p] > e200[p] && s50[p] > 0;
    let trigger: { setup: SetupType; stop: number; lines: string[] } | null = null;

    const crossFresh =
      lastCrossIdx >= 0 &&
      lastCrossIdx !== usedCrossIdx &&
      p - lastCrossIdx <= config.crossEntryWindowBars;
    if (crossFresh && trend && prev.c > e50[p]) {
      trigger = {
        setup: config.crossSetupType,
        stop: lowestLow(p - config.crossReversalStopLookbackBars + 1, p),
        lines: [
          `${F} crossed above ${S} at ${series[lastCrossIdx].endEt} (${series[lastCrossIdx].sessionDate})`,
          `previous close ${prev.c.toFixed(2)} > ${F} ${e50[p].toFixed(2)} > ${S} ${e200[p].toFixed(2)}`,
        ],
      };
    } else {
      const rev = config.dualSlopeReversalEntry ? dualSlopeReversal(s50, s200, p, config) : null;
      if (rev) {
        trigger = {
          setup: config.reversalSetupType,
          stop: lowestLow(p - config.crossReversalStopLookbackBars + 1, p),
          lines: [
            `${F} + ${S} slopes both turned positive (${s50[p].toFixed(4)}% / ${s200[p].toFixed(4)}%)`,
            `slow decline before the turn: ${rev.downBars}/${config.reversalLookbackBars} bars both falling`,
          ],
        };
      } else if (
        trend &&
        prev.l <= e50[p] &&
        prev.c > e50[p] &&
        isHammer(prev, config.wickBodyRatio)
      ) {
        const pp = candleParts(prev);
        trigger = {
          setup: config.hammerSetupType,
          stop: prev.l,
          lines: [
            `hammer off ${F} ${e50[p].toFixed(2)}: low ${prev.l.toFixed(2)}, close ${prev.c.toFixed(2)}`,
            `lower wick ${pp.lowerWick.toFixed(2)} vs body ${pp.body.toFixed(2)}`,
          ],
        };
      }
    }
    if (!trigger) continue;

    // >= because 1m opens often print exactly at the previous close; only a lower open is a veto.
    if (!(b.o >= prev.c)) continue;
    if (isUpperWickRejection(prev, config.wickBodyRatio, config.upperWickRangePct)) continue;

    const fill = applyLongFillPrice(b.o, config);
    const stop = Math.min(
      Math.max(trigger.stop, fill - config.atrStopMult * a[p]),
      fill - config.minStopAtrMult * a[p],
    );
    if (!(stop < fill)) continue;

    if (trigger.setup === config.crossSetupType) usedCrossIdx = lastCrossIdx;
    entrySetup = trigger.setup;
    entryPrice = fill;
    entryTime = t;
    entryIdx = i;
    initialStop = stop;
    riskR = fill - stop;
    trailStop = stop;
    trailActive = false;
    highSinceEntry = b.o;
    peakSlope = s50[p];
    mfeUsd = 0;
    maeUsd = 0;
    reasons = [
      ...trigger.lines,
      `confirm: open ${b.o.toFixed(2)} >= previous close ${prev.c.toFixed(2)}, no upper-wick rejection`,
      `stop ${stop.toFixed(2)} (R ${riskR.toFixed(2)}, ${config.minStopAtrMult}-${config.atrStopMult}x ATR ${a[p].toFixed(3)}), trail after +${config.trailActivateR}R`,
      `candle sells start after ${config.exitGraceBars} candles`,
    ];
    open = true;

    if (checkStops(i, t)) {
      roundTrips += 1;
      cooldownUntil = i + config.cooldownBars + 1;
    } else {
      updateOpenState(i);
    }
  }

  if (open) {
    const last = series[series.length - 1];
    close(last.endEt, last.c, 'session_end');
  }

  return { trades };
}
