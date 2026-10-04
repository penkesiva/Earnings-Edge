import {
  INTRADAY_STRATEGY_SAM_EMA11_200_V1,
  INTRADAY_STRATEGY_SAM_EMA11_50_V1,
  INTRADAY_STRATEGY_SAM_EMA50_200_V1,
  INTRADAY_STRATEGY_SAM_EMA50_200_V2,
  INTRADAY_STRATEGY_SAM_EMA50_200_V3,
  type SamEma50200Config,
  type SamV3Config,
} from '@/lib/intraday/types';

/** Baseline params — not optimized. */
export const DEFAULT_SAM_EMA50_200_CONFIG: SamEma50200Config = {
  barMinutes: 5,
  warmupSessions: 4,
  emaFast: 50,
  emaSlow: 200,
  slopeLookbackBars: 3,
  crossEntryWindowBars: 3,
  dualSlopeReversalEntry: false,
  reversalLookbackBars: 0,
  reversalMaxTurnBars: 0,
  reversalMinDownBars: 0,
  reversalMaxDeclineSlopePct: 0,
  crossSetupType: 'sam_ema50_200',
  reversalSetupType: 'sam_ema50_200',
  exitSlopeReversalRatio: 2 / 3,
  atrPeriod: 14,
  atrStopMult: 3,
  firstEntryEt: '09:40',
  noNewEntriesAfterEt: '15:15',
  forceFlatEt: '15:55',
  maxTradesPerDay: 2,
  cooldownBars: 2,
  slippageBps: 0,
  commissionPerShare: 0,
  tradeTimeAnchor: 'bar_end',
  chartReferenceEmas: [11],
};

/**
 * v2: 1-minute bars. EMA200 needs ~200 bars (about half a session), so 2 prior sessions is plenty.
 * Slopes use a 5-bar lookback to smooth 1m noise.
 */
export const DEFAULT_SAM_EMA50_200_V2_CONFIG: SamEma50200Config = {
  ...DEFAULT_SAM_EMA50_200_CONFIG,
  barMinutes: 1,
  warmupSessions: 2,
  slopeLookbackBars: 5,
  crossEntryWindowBars: 5,
  dualSlopeReversalEntry: true,
  reversalLookbackBars: 30,
  reversalMaxTurnBars: 30,
  reversalMinDownBars: 10,
  reversalMaxDeclineSlopePct: 0.15,
  crossSetupType: 'sam_v2_cross',
  reversalSetupType: 'sam_v2_reversal',
  firstEntryEt: '09:35',
  maxTradesPerDay: 3,
  cooldownBars: 5,
};

/** v3: v2 triggers + hammer entry, candle-based exits, all decided at the next candle's open. */
export const DEFAULT_SAM_V3_CONFIG: SamV3Config = {
  ...DEFAULT_SAM_EMA50_200_V2_CONFIG,
  crossSetupType: 'sam_v3_cross',
  reversalSetupType: 'sam_v3_reversal',
  hammerSetupType: 'sam_v3_hammer',
  tradeTimeAnchor: 'bar_start',
  wickBodyRatio: 2,
  upperWickRangePct: 0.6,
  trailActivateR: 1,
  trailLookbackBars: 3,
  crossReversalStopLookbackBars: 3,
  minStopAtrMult: 1,
  exitGraceBars: 1,
  cooldownBars: 0,
  maxTradesPerDay: Number.POSITIVE_INFINITY,
  gapExitMinAtr: 0.25,
  ema50BreakBufferAtr: 0.1,
  noNewEntriesAfterEt: '15:54',
  forceFlatEt: '15:59',
};

/** Experiment: v3 rules on EMA11/EMA50. EMA200 is drawn on the chart only. */
export const DEFAULT_SAM_EMA11_50_CONFIG: SamV3Config = {
  ...DEFAULT_SAM_V3_CONFIG,
  emaFast: 11,
  emaSlow: 50,
  crossSetupType: 'sam_11_50_cross',
  reversalSetupType: 'sam_11_50_reversal',
  hammerSetupType: 'sam_11_50_hammer',
  chartReferenceEmas: [200],
};

/** Experiment: v3 rules on EMA11/EMA200. EMA50 is drawn on the chart only. */
export const DEFAULT_SAM_EMA11_200_CONFIG: SamV3Config = {
  ...DEFAULT_SAM_V3_CONFIG,
  emaFast: 11,
  emaSlow: 200,
  crossSetupType: 'sam_11_200_cross',
  reversalSetupType: 'sam_11_200_reversal',
  hammerSetupType: 'sam_11_200_hammer',
  chartReferenceEmas: [50],
};

export function isSamV3Config(config: SamEma50200Config): config is SamV3Config {
  return 'minStopAtrMult' in config;
}

export function samConfigForStrategy(strategyId: string | null | undefined): SamEma50200Config | null {
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA50_200_V1) return DEFAULT_SAM_EMA50_200_CONFIG;
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA50_200_V2) return DEFAULT_SAM_EMA50_200_V2_CONFIG;
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA50_200_V3) return DEFAULT_SAM_V3_CONFIG;
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA11_50_V1) return DEFAULT_SAM_EMA11_50_CONFIG;
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA11_200_V1) return DEFAULT_SAM_EMA11_200_CONFIG;
  return null;
}
