export const INTRADAY_STRATEGY_VWAP_OR_V1 = 'vwap_opening_range_v1' as const;
export const INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1 = 'buy_weak_sell_strong_v1' as const;
export const INTRADAY_STRATEGY_EMA_TREND_DAY_V1 = 'ema_trend_day_v1' as const;
export const INTRADAY_STRATEGY_EMA_TREND_DAY_V2 = 'ema_trend_day_v2' as const;

export type IntradayStrategyId =
  | typeof INTRADAY_STRATEGY_VWAP_OR_V1
  | typeof INTRADAY_STRATEGY_BUY_WEAK_SELL_STRONG_V1
  | typeof INTRADAY_STRATEGY_EMA_TREND_DAY_V1
  | typeof INTRADAY_STRATEGY_EMA_TREND_DAY_V2;

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
  | 'deep_dip'
  | 'ema_cross_up'
  | 'ema_pullback'
  | 'ema_cross_up_confirmed'
  | 'ema_pullback_confirmed';

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

/** Intraday 9/20 EMA session trend (from RTH bars only). */
export type EmaTrendDayConfig = {
  warmupBars: number;
  cooldownMinutes: number;
  maxTradesPerDay: number;
  allowPullbackEntry: boolean;
  pullbackTouchPct: number;
  exitOnCloseBelowFast: boolean;
  noNewEntriesAfterEt: string;
  forceFlatEt: string;
};

export type MarketRegime = 'BULL_TREND' | 'CHOP' | 'BEARISH' | 'UNKNOWN';

export type VolumeFilterMode = 'OFF' | 'PREFER' | 'REQUIRE';
export type ProfitProtectMode = 'NONE' | 'EMA9' | 'SWING_LOW' | 'TRAILING_PERCENT' | 'PROFIT_GIVEBACK';
export type MarketContextFilter = 'OFF' | 'SCORE_ONLY' | 'REQUIRE';
export type EmaInitialization = 'SESSION_ONLY' | 'PRIOR_BARS_SEEDED';
export type EmaV2EntryMode = 'EMA_ONLY' | 'EMA_REGIME' | 'EMA_REGIME_MOMENTUM';
/** Forensics / replay only — not in compare EMA modes UI. */
export type EmaV2ForensicsOnlyEntryMode = 'EXPERIMENTAL_VWAP_RESUMPTION';
export type EmaV2SimEntryMode = EmaV2EntryMode | EmaV2ForensicsOnlyEntryMode;
export type VolumeMomentumMode = 'OFF' | 'SCORE_ONLY' | 'REQUIRE';
/** Diagnostic replay only — does not change production default config. */
export type ForensicsDelayedEntryVariant = 'A' | 'B' | 'C' | 'D' | 'E';

export type EmaTrendDayV2Config = {
  warmupBars: number;
  cooldownMinutes: number;
  maxTradesPerDay: number;
  noNewEntriesAfterEt: string;
  forceFlatEt: string;
  emaInitialization: EmaInitialization;
  minScoreToEnter: number;
  minEmaSpreadPctBull: number;
  minEmaSpreadPctChop: number;
  maxEmaCrossCount30: number;
  maxVwapCrossCount30: number;
  flatSlopeAbsMax: number;
  pullbackZonePct: number;
  allowPullbackEntry: boolean;
  maxExtensionFromEma9Pct: number;
  maxExtensionFromVwapPct: number;
  volumeFilterMode: VolumeFilterMode;
  minRelativeVolumePrefer: number;
  minRelativeVolumeRequire: number;
  structuralStopLookbackBars: number;
  maxLossPctGuard: number;
  slippageBps: number;
  commissionPerShare: number;
  profitProtectMode: ProfitProtectMode;
  profitGivebackActivatePct: number;
  profitGivebackRetracePct: number;
  exitOnBearCross: boolean;
  exitOnEma9Close: boolean;
  exitOnEma20Close: boolean;
  exitOnVwapClose: boolean;
  exitOnSwingLowBreak: boolean;
  consecutiveLossHalt: number;
  requireStrongerAfterLoss: boolean;
  minScoreAfterLoss: number;
  marketContextFilter: MarketContextFilter;

  /** Backtest entry variant (v2 only). */
  entryMode: EmaV2SimEntryMode;
  minMomentumScore: number;
  minCloseLocation: number;
  microBreakoutBars: number;
  microBreakRequiredForPullback: boolean;
  /** Pullback touch % for EMA_ONLY (aligns with v1 default 0.05). */
  emaOnlyPullbackTouchPct: number;
  volumeMomentumMode: VolumeMomentumMode;
  momentumWeightPrice: number;
  momentumWeightCandle: number;
  momentumWeightMicroBreak: number;
  momentumWeightVolume: number;
  momentumWeightEma: number;
  momentumWeightVwap: number;
  /** When set, applies extra entry confirmation gate (forensics / variant sim). */
  forensicsDelayedEntryVariant?: ForensicsDelayedEntryVariant;
};

export type SignalLogEntry = {
  sessionDate: string;
  timeEt: string;
  price: number;
  ema9: number;
  ema20: number;
  emaSpreadPct: number;
  ema9Slope: number;
  ema20Slope: number;
  vwap: number;
  relativeVolume: number;
  distEma9Pct: number;
  distVwapPct: number;
  regime: MarketRegime;
  signalType: string;
  score: number;
  momentumScore?: number;
  scoreLines: string[];
  accepted: boolean;
  rejectionReason?: string;
};

export type TradeExitReason =
  | 'strength'
  | 'stop'
  | 'target'
  | 'eod_flat'
  | 'session_end'
  | 'ema_cross_down'
  | 'structural_stop'
  | 'max_loss_guard'
  | 'profit_giveback'
  | 'ema9_close'
  | 'ema20_close'
  | 'vwap_close'
  | 'swing_low_break'
  | 'session_halt_losses';

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
  regimeAtEntry?: MarketRegime;
  mfeUsd?: number;
  maeUsd?: number;
  relativeVolumeAtEntry?: number;
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

export type BacktestMetricsExtended = BacktestMetrics & {
  expectancyPerTrade?: number | null;
  largestWinnerUsd?: number | null;
  largestLoserUsd?: number | null;
  avgMfeUsd?: number | null;
  avgMaeUsd?: number | null;
  byRegime?: Record<string, { trades: number; pnlUsd: number }>;
  rejectedSignals?: number;
  slippageBps?: number;
  commissionPerShare?: number;
};
