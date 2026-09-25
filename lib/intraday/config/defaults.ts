import type { IntradayStrategyConfig } from '@/lib/intraday/types';

export const DEFAULT_INTRADAY_CONFIG: IntradayStrategyConfig = {
  openingRangeMinutes: 15,
  cooldownMinutes: 10,
  maxTradesPerDay: 3,
  target1Pct: 1.25,
  target2Pct: 2.0,
  maxStopPct: 1.5,
  partialExitPct: 50,
  noNewEntriesAfterEt: '15:30',
  forceFlatEt: '15:50',
  scaleFirstPct: 50,
};

export const BACKTEST_DAY_PRESETS = [30, 90, 180, 365] as const;

export const MIN_TRADING_BUDGET_USD = 100;
export const MAX_TRADING_BUDGET_USD = 10_000_000;
export const MIN_BACKTEST_DAYS = 5;
export const MAX_BACKTEST_DAYS = 365;
