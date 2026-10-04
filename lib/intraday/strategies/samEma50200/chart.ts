import {
  barUnixSeconds,
  findBarByEt,
  markersForSessionTrades,
  toCandlePoints,
  toLinePoints,
  type ChartBarPoint,
  type ChartLinePoint,
  type ChartLineSeries,
  type ChartMarkerPoint,
} from '@/lib/intraday/chart/chartDayPayload';
import {
  DEFAULT_SAM_EMA50_200_CONFIG,
  isSamV3Config as isV3,
} from '@/lib/intraday/strategies/samEma50200/config';
import { aggregateBars, atr, ema, slopePct, type AggBar } from '@/lib/intraday/strategies/samEma50200/indicators';
import type { BacktestTrade, MinuteBar, SamEma50200Config } from '@/lib/intraday/types';

/** Same period keeps the same color across SAM variants. */
const EMA_COLORS: Record<number, string> = { 11: '#2dd4bf', 50: '#fbbf24', 200: '#c084fc' };
const EMA_FALLBACK_COLORS = ['#fbbf24', '#c084fc', '#2dd4bf'];

/** v1/v2 trade times are bar close times, so match on `endEt`. */
function findAggBarByEndEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  return (bars as AggBar[]).find(b => b.endEt === hhmm) ?? null;
}

/** v3 fills at the bar open; `session_end` exits still use the last bar's close time. */
function findAggBarByStartEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  return findBarByEt(bars, hhmm) ?? findAggBarByEndEt(bars, hhmm);
}

/** Initial stop from the entry reasons ("stop 363.79 (R ..." in v3, "disaster stop 99.12 (..." in v1/v2). */
function initialStopFromReasons(t: BacktestTrade): number | null {
  for (const r of t.reasons ?? []) {
    if (r.startsWith('exit:')) continue;
    const m = r.match(/\bstop (\d+(?:\.\d+)?) \(/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Stop level in force during each candle of a trade. v3 replays the trailing rule
 * (activate after +trailActivateR, then max of the last trailLookbackBars lows).
 */
function stopPath(
  series: AggBar[],
  from: number,
  to: number,
  t: BacktestTrade,
  initial: number,
  config: SamEma50200Config,
): ChartLinePoint[] {
  const pts: ChartLinePoint[] = [];
  if (!isV3(config)) {
    for (let i = from; i <= to; i++) pts.push({ time: barUnixSeconds(series[i].t), value: initial });
    return pts;
  }
  const riskR = t.entryPrice - initial;
  let high = series[from].o;
  let trailActive = false;
  let trail = initial;
  let level = initial;
  for (let i = from; i <= to; i++) {
    pts.push({ time: barUnixSeconds(series[i].t), value: level });
    high = Math.max(high, series[i].h);
    if (!trailActive && riskR > 0 && high >= t.entryPrice + config.trailActivateR * riskR) trailActive = true;
    if (trailActive) {
      let lo = Infinity;
      for (let j = Math.max(0, i - config.trailLookbackBars + 1); j <= i; j++) lo = Math.min(lo, series[j].l);
      trail = Math.max(trail, lo);
    }
    level = trailActive ? Math.max(initial, trail) : initial;
  }
  return pts;
}

export function buildSamChartDay(
  sessionDate: string,
  bars: MinuteBar[],
  priorBars: MinuteBar[],
  trades: BacktestTrade[],
  config: SamEma50200Config = DEFAULT_SAM_EMA50_200_CONFIG,
): { candles: ChartBarPoint[]; lines: ChartLineSeries[]; markers: ChartMarkerPoint[] } {
  const series = aggregateBars([...priorBars, ...bars], config.barMinutes);
  const closes = series.map(b => b.c);
  const e50 = ema(closes, config.emaFast);
  const e200 = ema(closes, config.emaSlow);
  const a = atr(series, config.atrPeriod);
  const s50 = series.map((_, i) => slopePct(e50, i, config.slopeLookbackBars));
  const s200 = series.map((_, i) => slopePct(e200, i, config.slopeLookbackBars));

  const first = series.findIndex(b => b.sessionDate === sessionDate);
  const today = first >= 0 ? series.slice(first) : [];
  const fromToday = (vals: number[]) => (first >= 0 ? vals.slice(first) : []);
  /** Value at candle i computed from the previous candle (what the simulator sees at open[i]). */
  const atOpen = (f: (i: number) => number) => today.map((_, k) => (first + k > 0 ? f(first + k) : NaN));

  const emaLine = (period: number, values: number[], fallback: number, ref: boolean): ChartLineSeries => ({
    label: ref ? `EMA${period} (ref)` : `EMA${period}`,
    color: EMA_COLORS[period] ?? EMA_FALLBACK_COLORS[fallback],
    points: toLinePoints(today, fromToday(values)),
  });
  const refs = config.chartReferenceEmas.filter(n => n !== config.emaFast && n !== config.emaSlow);

  const lines: ChartLineSeries[] = [
    ...refs.map(n => emaLine(n, ema(closes, n), 2, true)),
    emaLine(config.emaFast, e50, 0, false),
    emaLine(config.emaSlow, e200, 1, false),
    {
      label: `ATR${config.atrPeriod}`,
      color: '#f472b6',
      pane: 'atr',
      group: 'atr',
      precision: 3,
      points: toLinePoints(today, fromToday(a)),
    },
    {
      label: `EMA${config.emaFast} slope %`,
      color: EMA_COLORS[config.emaFast] ?? EMA_FALLBACK_COLORS[0],
      pane: 'slope',
      group: 'slope',
      precision: 4,
      points: toLinePoints(today, fromToday(s50)),
    },
    {
      label: `EMA${config.emaSlow} slope %`,
      color: EMA_COLORS[config.emaSlow] ?? EMA_FALLBACK_COLORS[1],
      pane: 'slope',
      group: 'slope',
      precision: 4,
      points: toLinePoints(today, fromToday(s200)),
    },
  ];

  const minStopMult = isV3(config) ? config.minStopAtrMult : null;
  if (minStopMult != null) {
    lines.push({
      label: `Stop if bought here (${minStopMult}x ATR)`,
      color: '#94a3b8',
      style: 'dotted',
      width: 1,
      group: 'atrBands',
      points: toLinePoints(today, atOpen(i => series[i].o - minStopMult * a[i - 1])),
    });
  }
  lines.push({
    label: `Stop if bought here (${config.atrStopMult}x ATR)`,
    color: '#64748b',
    style: 'dotted',
    width: 1,
    group: 'atrBands',
    points: toLinePoints(today, atOpen(i => series[i].o - config.atrStopMult * a[i - 1])),
  });

  if (isV3(config)) {
    lines.push(
      {
        label: `EMA${config.emaFast} break level (-${config.ema50BreakBufferAtr}x ATR)`,
        color: '#f59e0b',
        style: 'dashed',
        width: 1,
        group: 'exitLevels',
        points: toLinePoints(today, fromToday(e50.map((v, i) => v - config.ema50BreakBufferAtr * a[i]))),
      },
      {
        label: `Gap sell level (prev low -${config.gapExitMinAtr}x ATR)`,
        color: '#fb7185',
        style: 'dotted',
        width: 1,
        group: 'exitLevels',
        points: toLinePoints(today, atOpen(i => series[i - 1].l - config.gapExitMinAtr * a[i - 1])),
      },
    );
  }

  const findBar = config.tradeTimeAnchor === 'bar_start' ? findAggBarByStartEt : findAggBarByEndEt;
  trades
    .filter(t => t.sessionDate === sessionDate)
    .forEach((t, n) => {
      const initial = initialStopFromReasons(t);
      const entryBar = findBar(today, t.entryTimeEt);
      const exitBar = findBar(today, t.exitTimeEt);
      if (initial == null || !entryBar || !exitBar) return;
      const from = series.indexOf(entryBar as AggBar);
      const to = series.indexOf(exitBar as AggBar);
      if (from < 0 || to < from) return;
      lines.push({
        label: `Stop #${n + 1}`,
        color: '#ef4444',
        style: 'dotted',
        width: 2,
        group: 'stops',
        points: stopPath(series, from, to, t, initial, config),
      });
    });

  return {
    candles: toCandlePoints(today),
    lines,
    markers: markersForSessionTrades(sessionDate, today, trades, findBar),
  };
}
