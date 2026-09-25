export const INTRADAY_STRATEGY_VWAP_OR_V1 = 'vwap_opening_range_v1' as const;
export const INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1 = 'buy_weak_sell_strong_v1' as const;

export type IntradayStrategyId =
  | typeof INTRADAY_STRATEGY_VWAP_OR_V1
  | typeof INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1;

export type IntradayRunMode = 'backtest' | 'paper' | 'live';

export type StrategyState =
  | 'WAIT_FOR_OPEN'
  | 'BUILD_OPENING_RANGE'
  | 'WAIT_FOR_SETUP'
  | 'ENTRY_CANDIDATE'
  | 'CONFIRMED_ENTRY'
  | 'POSITION_OPEN'
  | 'PARTIAL_PROFIT'
  | 'TRAILING_POSITION'
  | 'EXIT'
  | 'COOLDOWN'
  | 'FORCE_EXIT';

export type SetupType =
  | 'vwap_pullback'
  | 'or_breakout'
  | 'or_retest'
  | 'vwap_dip'
  | 'deep_dip';

export type MinuteBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type DayIndicators = {
  vwap: number[];
  ema9: number[];
  ema20: number[];
  relVolume: number[];
};

export type IntradayStrategyConfig = {
  openingRangeMinutes: number;
  cooldownMinutes: number;
  maxTradesPerDay: number;
  target1Pct: number;
  target2Pct: number;
  maxStopPct: number;
  partialExitPct: number;
  noNewEntriesAfterEt: string;
  forceFlatEt: string;
  scaleFirstPct: number;
  /** Minimum signal score (0–100) before entering. */
  minConfidence: number;
};

/** Buy weak / sell strong — no stop, exit on profit or EOD flat. */
export type BuyWeakStrategyConfig = {
  openingRangeMinutes: number;
  cooldownMinutes: number;
  maxTradesPerDay: number;
  /** Min % gain before allowing a strength exit. */
  minProfitExitPct: number;
  /** Enter when price is at least this % below session VWAP. */
  dipBelowVwapPct: number;
  /** Also exit when back above VWAP with partial min profit. */
  ripExitAboveVwap: boolean;
  noNewEntriesAfterEt: string;
  forceFlatEt: string;
  minConfidence: number;
};

export type TradeExitReason = 'strength' | 'stop' | 'target' | 'eod_flat' | 'session_end';

export type BacktestTrade = {
  sessionDate: string;
  setupType: SetupType;
  entryTimeEt: string;
  exitTimeEt: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnlUsd: number;
  pnlPct: number;
  confidence: number;
  reasons: string[];
  /** Why the position closed (Buy Weak uses strength vs eod_flat). */
  exitReason?: TradeExitReason;
};

export type BacktestMetrics = {
  tradingDays: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnlUsd: number;
  avgWinnerUsd: number | null;
  avgLoserUsd: number | null;
  profitFactor: number | null;
  maxDrawdownUsd: number;
  avgHoldMinutes: number | null;
  tradesPerDay: number | null;
  bySetup: Record<string, { trades: number; pnlUsd: number }>;
};
