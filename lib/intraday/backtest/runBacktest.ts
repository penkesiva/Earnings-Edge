import type { AlpacaAuth } from '@/lib/alpaca';
import { lastUsEquityBacktestEndDate } from '@/lib/earningsDate';
import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import { fetchMinuteBarsForDay, listRecentTradingDates } from '@/lib/intraday/data/bars';
import { filterRegularSessionBars } from '@/lib/intraday/indicators/engine';
import { aggregateV2BacktestMetrics } from '@/lib/intraday/backtest/metricsV2';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { simulateStrategyDay } from '@/lib/intraday/strategies/runStrategyDay';
import {
  INTRADAY_STRATEGY_EMA_TREND_DAY_V2,
  INTRADAY_STRATEGY_VWAP_OR_V1,
  type BacktestMetrics,
  type BacktestMetricsExtended,
  type BacktestTrade,
  type SignalLogEntry,
} from '@/lib/intraday/types';

export type BacktestRunResult = {
  trades: BacktestTrade[];
  metrics: BacktestMetrics | BacktestMetricsExtended;
  daysWithData: number;
  errors: string[];
  signalLogSample?: SignalLogEntry[];
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
  const allSignalLog: SignalLogEntry[] = [];
  const errors: string[] = [];
  let daysWithData = 0;

  for (const sessionDate of dates) {
    try {
      const raw = await fetchMinuteBarsForDay(input.symbol, sessionDate, input.auth);
      const bars = filterRegularSessionBars(raw, sessionDate);
      if (bars.length < 20) continue;
      daysWithData += 1;
      const day = simulateStrategyDay(
        strategyId,
        sessionDate,
        bars,
        input.effectiveBudgetUsd,
      );
      allTrades.push(...day.trades);
      if (day.signalLog) allSignalLog.push(...day.signalLog);
    } catch (e) {
      errors.push(`${sessionDate}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const metrics =
    strategyId === INTRADAY_STRATEGY_EMA_TREND_DAY_V2
      ? aggregateV2BacktestMetrics(
          allTrades,
          daysWithData,
          allSignalLog,
          DEFAULT_EMA_TREND_DAY_V2_CONFIG.slippageBps,
          DEFAULT_EMA_TREND_DAY_V2_CONFIG.commissionPerShare,
        )
      : aggregateBacktestMetrics(allTrades, daysWithData);

  return {
    trades: allTrades,
    metrics,
    daysWithData,
    errors: errors.slice(0, 8),
    signalLogSample: strategyId === INTRADAY_STRATEGY_EMA_TREND_DAY_V2 ? allSignalLog.slice(0, 400) : undefined,
  };
}
