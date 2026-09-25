import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import { aggregateV2BacktestMetrics } from '@/lib/intraday/backtest/metricsV2';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { simulateEmaTrendDayV2 } from '@/lib/intraday/strategies/emaTrendDayV2/simulateDay';
import { simulateEmaTrendDay } from '@/lib/intraday/strategies/emaTrendDay/simulateDay';
import { DEFAULT_EMA_TREND_DAY_CONFIG } from '@/lib/intraday/config/defaults';
import type { BacktestMetricsExtended, BacktestTrade, SignalLogEntry } from '@/lib/intraday/types';

export type EmaTrendCompareResult = {
  v1: BacktestMetricsExtended;
  v2: BacktestMetricsExtended;
  daysWithData: number;
  errors: string[];
};

export async function compareEmaTrendDayBacktest(input: {
  symbol: string;
  calendarDays: number;
  effectiveBudgetUsd: number;
  auth: AlpacaAuth;
}): Promise<EmaTrendCompareResult> {
  const end = lastUsEquityBacktestEndDate();
  const dates = listRecentTradingDates(end, input.calendarDays);
  const v1Trades: BacktestTrade[] = [];
  const v2Trades: BacktestTrade[] = [];
  const v2Log: SignalLogEntry[] = [];
  const errors: string[] = [];
  let daysWithData = 0;

  for (const sessionDate of dates) {
    try {
      const raw = await fetchMinuteBarsForDay(input.symbol, sessionDate, input.auth);
      const bars = filterRegularSessionBars(raw, sessionDate);
      if (bars.length < 20) continue;
      daysWithData += 1;
      v1Trades.push(
        ...simulateEmaTrendDay(sessionDate, bars, input.effectiveBudgetUsd, DEFAULT_EMA_TREND_DAY_CONFIG)
          .trades,
      );
      const v2 = simulateEmaTrendDayV2(
        sessionDate,
        bars,
        input.effectiveBudgetUsd,
        DEFAULT_EMA_TREND_DAY_V2_CONFIG,
      );
      v2Trades.push(...v2.trades);
      v2Log.push(...v2.signalLog);
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const cfg = DEFAULT_EMA_TREND_DAY_V2_CONFIG;
  return {
    v1: aggregateBacktestMetrics(v1Trades, daysWithData) as BacktestMetricsExtended,
    v2: aggregateV2BacktestMetrics(
      v2Trades,
      daysWithData,
      v2Log,
      cfg.slippageBps,
      cfg.commissionPerShare,
    ),
    daysWithData,
    errors: errors.slice(0, 8),
  };
}
