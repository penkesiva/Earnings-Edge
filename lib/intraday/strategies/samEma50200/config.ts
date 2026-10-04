import type { SamEma50200Config } from '@/lib/intraday/types';

/** Baseline params — not optimized. */
export const DEFAULT_SAM_EMA50_200_CONFIG: SamEma50200Config = {
  barMinutes: 5,
  warmupSessions: 4,
  emaFast: 50,
  emaSlow: 200,
  slopeLookbackBars: 3,
  crossEntryWindowBars: 3,
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
