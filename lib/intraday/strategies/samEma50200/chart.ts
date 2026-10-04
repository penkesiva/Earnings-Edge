import {
  findBarByEt,
  markersForSessionTrades,
  toCandlePoints,
  toLinePoints,
  type ChartBarPoint,
  type ChartLineSeries,
  type ChartMarkerPoint,
} from '@/lib/intraday/chart/chartDayPayload';
import { DEFAULT_SAM_EMA50_200_CONFIG } from '@/lib/intraday/strategies/samEma50200/config';
import { aggregateBars, ema, type AggBar } from '@/lib/intraday/strategies/samEma50200/indicators';
import type { BacktestTrade, MinuteBar, SamEma50200Config } from '@/lib/intraday/types';

/** Chart-only reference line; no SAM rule reads it. */
const REFERENCE_EMA = 11;

/** v1/v2 trade times are bar close times, so match on `endEt`. */
function findAggBarByEndEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  return (bars as AggBar[]).find(b => b.endEt === hhmm) ?? null;
}

/** v3 fills at the bar open; `session_end` exits still use the last bar's close time. */
function findAggBarByStartEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  return findBarByEt(bars, hhmm) ?? findAggBarByEndEt(bars, hhmm);
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
  const eRef = ema(closes, REFERENCE_EMA);

  const first = series.findIndex(b => b.sessionDate === sessionDate);
  const today = first >= 0 ? series.slice(first) : [];
  const fromToday = (vals: number[]) => (first >= 0 ? vals.slice(first) : []);

  return {
    candles: toCandlePoints(today),
    lines: [
      { label: `EMA${REFERENCE_EMA}`, color: '#2dd4bf', points: toLinePoints(today, fromToday(eRef)) },
      { label: `EMA${config.emaFast}`, color: '#fbbf24', points: toLinePoints(today, fromToday(e50)) },
      { label: `EMA${config.emaSlow}`, color: '#c084fc', points: toLinePoints(today, fromToday(e200)) },
    ],
    markers: markersForSessionTrades(
      sessionDate,
      today,
      trades,
      config.tradeTimeAnchor === 'bar_start' ? findAggBarByStartEt : findAggBarByEndEt,
    ),
  };
}
