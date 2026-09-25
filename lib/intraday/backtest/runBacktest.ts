import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { simulateStrategyDay } from '@/lib/intraday/strategies/runStrategyDay';
import { INTRADAY_STRATEGY_VWAP_OR_V1, type BacktestMetrics, type BacktestTrade } from '@/lib/intraday/types';

export type BacktestRunResult = {
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  daysWithData: number;
  errors: string[];
};

export async function runIntradayBacktest(input: {
  symbol: string;
  calendarDays: number;
  effectiveBudgetUsd: number;
  auth: AlpacaAuth;
  strategyId?: string;
}): Promise<BacktestRunResult> {
  const strategyId = input.strategyId ?? INTRADAY_STRATEGY_VWAP_OR_V1;
  const end = lastUsEquityBacktestEndDate();
  const dates = listRecentTradingDates(end, input.calendarDays);
  const allTrades: BacktestTrade[] = [];
  const errors: string[] = [];
  let daysWithData = 0;

  for (const sessionDate of dates) {
    try {
      const raw = await fetchMinuteBarsForDay(input.symbol, sessionDate, input.auth);
      const bars = filterRegularSessionBars(raw, sessionDate);
      if (bars.length < 20) continue;
      daysWithData += 1;
      const trades = simulateStrategyDay(
        strategyId,
        sessionDate,
        bars,
        input.effectiveBudgetUsd,
      );
      allTrades.push(...trades);
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const metrics = aggregateBacktestMetrics(allTrades, daysWithData);
  return { trades: allTrades, metrics, daysWithData, errors: errors.slice(0, 8) };
}
