import type { AlpacaAuth } from '@/lib/alpaca';
import { earningsSessionDate } from '@/lib/earningsDate';
import { DEFAULT_INTRADAY_CONFIG } from '@/lib/intraday/config/defaults';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import { simulateVwapOrDay } from '@/lib/intraday/strategies/vwapOpeningRange/simulateDay';
import type { BacktestMetrics, BacktestTrade } from '@/lib/intraday/types';

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
}): Promise<BacktestRunResult> {
  const end = earningsSessionDate();
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
      const { trades } = simulateVwapOrDay(
        sessionDate,
        bars,
        input.effectiveBudgetUsd,
        DEFAULT_INTRADAY_CONFIG,
      );
      allTrades.push(...trades);
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const metrics = aggregateBacktestMetrics(allTrades, daysWithData);
  return { trades: allTrades, metrics, daysWithData, errors: errors.slice(0, 8) };
}
