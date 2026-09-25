import type { TrendResumptionV1Config } from '@/lib/intraday/types';

export const DEFAULT_TREND_RESUMPTION_V1_BASE: Omit<TrendResumptionV1Config, 'triggerMode'> = {
  warmupBars: 25,
  cooldownMinutes: 15,
  maxTradesPerDay: 3,
  noNewEntriesAfterEt: '15:30',
  forceFlatEt: '15:50',
  minCloseLocation: 0.65,
  maxDistVwapExtendedPct: 0.3,
  maxDistEma9ExtendedPct: 0.35,
  maxPercentBExtended: 1.0,
  maxRet1ExtendedPct: 0.35,
  maxRet3ExtendedPct: 0.55,
  volumeSpikeAccel: 1.85,
  resetZoneVwapPct: 0.2,
  resetZoneEma9Pct: 0.2,
  pullbackMinBars: 2,
  structuralStopLookbackBars: 5,
  maxLossPctGuard: 2.5,
  slippageBps: 0,
  commissionPerShare: 0,
  exitOnBearCross: true,
};

export function trendResumptionV1Config(
  triggerMode: TrendResumptionV1Config['triggerMode'],
): TrendResumptionV1Config {
  return { ...DEFAULT_TREND_RESUMPTION_V1_BASE, triggerMode };
}
