import type { SamEma50200Config } from '@/lib/intraday/types';

/** Baseline params — not optimized. */
export const DEFAULT_SAM_EMA50_200_CONFIG: SamEma50200Config = {
  barMinutes: 5,
  warmupSessions: 4,
  emaFast: 50,
  emaSlow: 200,
  slopeLookbackBars: 3,
  minEma50SlopePct: 0.04,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  rsiPeriod: 14,
  rsiMin: 50,
  rsiMax: 75,
  atrPeriod: 14,
  atrStopMult: 1.5,
  firstEntryEt: '09:40',
  noNewEntriesAfterEt: '15:15',
  forceFlatEt: '15:55',
  maxTradesPerDay: 2,
  cooldownBars: 2,
  slippageBps: 0,
  commissionPerShare: 0,
};
