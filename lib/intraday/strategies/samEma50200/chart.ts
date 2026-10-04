import {
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

/** SAM trade times are 5m bar close times, so match on `endEt`. */
function findAggBarByEndEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  return (bars as AggBar[]).find(b => b.endEt === hhmm) ?? null;
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

  const first = series.findIndex(b => b.sessionDate === sessionDate);
  const today = first >= 0 ? series.slice(first) : [];
  const todayE50 = first >= 0 ? e50.slice(first) : [];
  const todayE200 = first >= 0 ? e200.slice(first) : [];

  return {
    candles: toCandlePoints(today),
    lines: [
      { label: `EMA${config.emaFast}`, color: '#fbbf24', points: toLinePoints(today, todayE50) },
      { label: `EMA${config.emaSlow}`, color: '#c084fc', points: toLinePoints(today, todayE200) },
    ],
    markers: markersForSessionTrades(sessionDate, today, trades, findAggBarByEndEt),
  };
}
