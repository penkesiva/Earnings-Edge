import type { EmaTrendDayV2Config, EmaV2EntryMode } from '@/lib/intraday/types';

/** Baseline v2 — not optimized; for comparison vs ema_trend_day_v1. */
export const DEFAULT_EMA_TREND_DAY_V2_CONFIG: EmaTrendDayV2Config = {
  warmupBars: 25,
  cooldownMinutes: 12,
  maxTradesPerDay: 3,
  noNewEntriesAfterEt: '15:30',
  forceFlatEt: '15:50',

  emaInitialization: 'SESSION_ONLY',
  minScoreToEnter: 58,

  minEmaSpreadPctBull: 0.04,
  minEmaSpreadPctChop: 0.025,
  maxEmaCrossCount30: 3,
  maxVwapCrossCount30: 5,
  flatSlopeAbsMax: 0.00015,

  pullbackZonePct: 0.15,
  allowPullbackEntry: true,

  maxExtensionFromEma9Pct: 0.35,
  maxExtensionFromVwapPct: 0.45,

  volumeFilterMode: 'PREFER',
  minRelativeVolumePrefer: 1.1,
  minRelativeVolumeRequire: 1.25,

  structuralStopLookbackBars: 5,
  maxLossPctGuard: 2.5,
  slippageBps: 0,
  commissionPerShare: 0,

  profitProtectMode: 'PROFIT_GIVEBACK',
  profitGivebackActivatePct: 1.5,
  profitGivebackRetracePct: 40,

  exitOnBearCross: true,
  exitOnEma9Close: false,
  exitOnEma20Close: false,
  exitOnVwapClose: false,
  exitOnSwingLowBreak: false,

  consecutiveLossHalt: 2,
  requireStrongerAfterLoss: true,
  minScoreAfterLoss: 68,

  marketContextFilter: 'OFF',

  entryMode: 'EMA_REGIME_MOMENTUM',
  minMomentumScore: 60,
  minCloseLocation: 0.65,
  microBreakoutBars: 2,
  microBreakRequiredForPullback: false,
  emaOnlyPullbackTouchPct: 0.05,
  volumeMomentumMode: 'SCORE_ONLY',
  momentumWeightPrice: 20,
  momentumWeightCandle: 15,
  momentumWeightMicroBreak: 20,
  momentumWeightVolume: 15,
  momentumWeightEma: 20,
  momentumWeightVwap: 10,
};

export function emaV2ConfigWithEntryMode(
  entryMode: EmaV2EntryMode,
  overrides: Partial<EmaTrendDayV2Config> = {},
): EmaTrendDayV2Config {
  return { ...DEFAULT_EMA_TREND_DAY_V2_CONFIG, entryMode, ...overrides };
}
