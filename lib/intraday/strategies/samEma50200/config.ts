import {
  INTRADAY_STRATEGY_SAM_EMA50_200_V1,
  INTRADAY_STRATEGY_SAM_EMA50_200_V2,
  type SamEma50200Config,
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

export function samConfigForStrategy(strategyId: string | null | undefined): SamEma50200Config | null {
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA50_200_V1) return DEFAULT_SAM_EMA50_200_CONFIG;
  if (strategyId === INTRADAY_STRATEGY_SAM_EMA50_200_V2) return DEFAULT_SAM_EMA50_200_V2_CONFIG;
  return null;
}
