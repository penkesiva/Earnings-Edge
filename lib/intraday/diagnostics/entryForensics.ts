import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import { priorBarHigh } from '@/lib/intraday/diagnostics/barIndex';
import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { MinuteBar } from '@/lib/intraday/types';

export type EntryForensicsRow = {
  sessionDate: string;
  entryTimeEt: string;
  setupType: string;
  entryPrice: number;
  pnlUsd: number;
  ema9: number;
  ema20: number;
  ema9Slope: number;
  ema20Slope: number;
  emaSpreadPct: number;
  emaSpreadChange: number;
  vwap: number;
  vwapSlope: number;
  distVwapPct: number;
  return1m: number;
  return3m: number;
  return5m: number;
  bodyPct: number;
  closeLocation: number;
  upperWickPct: number;
  lowerWickPct: number;
  relativeVolume: number;
  volumeAcceleration: number;
  priorHigh1: number | null;
  priorHigh2: number | null;
  priorHigh3: number | null;
  brokePrior2BarHigh: boolean;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bandwidth: number | null;
  bandwidthSlope: number | null;
  percentB: number | null;
  distEma9Pct: number;
  distEma20Pct: number;
  emaCrossCount30: number;
  vwapCrossCount30: number;
};

export function buildEntryForensics(
  sessionDate: string,
  bars: MinuteBar[],
  contexts: BarContext[],
  i: number,
  entryTimeEt: string,
  entryPrice: number,
  setupType: string,
  pnlUsd: number,
): EntryForensicsRow {
  const b = bars[i];
  const ctx = contexts[i];
  const ctxPrev = contexts[i - 1] ?? ctx;
  const range = Math.max(b.h - b.l, 1e-9);
  const body = b.c - b.o;
  const upperWick = b.h - Math.max(b.o, b.c);
  const lowerWick = Math.min(b.o, b.c) - b.l;

  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volumeAcceleration = volPrev5 > 0 ? b.v / volPrev5 : 1;
  const vwapSlope = ctxPrev.vwap > 0 ? (ctx.vwap - ctxPrev.vwap) / ctxPrev.vwap : 0;
  const high2 = priorBarHigh(bars, i, 2);
  const bb = bollingerAtBar(bars, i);

  return {
    sessionDate,
    entryTimeEt,
    setupType,
    entryPrice,
    pnlUsd,
    ema9: ctx.ema9,
    ema20: ctx.ema20,
    ema9Slope: ctx.ema9Slope,
    ema20Slope: ctx.ema20Slope,
    emaSpreadPct: ctx.emaSpreadPct,
    emaSpreadChange: ctx.emaSpreadPct - ctxPrev.emaSpreadPct,
    vwap: ctx.vwap,
    vwapSlope,
    distVwapPct: ((b.c - ctx.vwap) / ctx.vwap) * 100,
    return1m: i >= 1 ? b.c / bars[i - 1].c - 1 : 0,
    return3m: i >= 3 ? b.c / bars[i - 3].c - 1 : 0,
    return5m: i >= 5 ? b.c / bars[i - 5].c - 1 : 0,
    bodyPct: (body / range) * 100,
    closeLocation: (b.c - b.l) / range,
    upperWickPct: (upperWick / range) * 100,
    lowerWickPct: (lowerWick / range) * 100,
    relativeVolume: ctx.relVolume,
    volumeAcceleration,
    priorHigh1: priorBarHigh(bars, i, 1),
    priorHigh2: high2,
    priorHigh3: priorBarHigh(bars, i, 3),
    brokePrior2BarHigh: high2 != null && b.c > high2,
    bbUpper: bb?.upper ?? null,
    bbMiddle: bb?.middle ?? null,
    bbLower: bb?.lower ?? null,
    bandwidth: bb?.bandwidth ?? null,
    bandwidthSlope: bb?.bandwidthSlope ?? null,
    percentB: bb?.percentB ?? null,
    distEma9Pct: ((b.c - ctx.ema9) / ctx.ema9) * 100,
    distEma20Pct: ((b.c - ctx.ema20) / ctx.ema20) * 100,
    emaCrossCount30: ctx.emaCrossCount30,
    vwapCrossCount30: ctx.vwapCrossCount30,
  };
}

export type CompareForensicsKey =
  | 'emaSpreadPct'
  | 'emaSpreadChange'
  | 'ema9Slope'
  | 'ema20Slope'
  | 'vwapSlope'
  | 'distVwapPct'
  | 'return1m'
  | 'return3m'
  | 'return5m'
  | 'closeLocation'
  | 'bodyPct'
  | 'relativeVolume'
  | 'volumeAcceleration'
  | 'distEma9Pct'
  | 'emaCrossCount30'
  | 'vwapCrossCount30';

export const COMPARE_NUMERIC_KEYS: CompareForensicsKey[] = [
  'emaSpreadPct',
  'emaSpreadChange',
  'ema9Slope',
  'ema20Slope',
  'vwapSlope',
  'distVwapPct',
  'return1m',
  'return3m',
  'return5m',
  'closeLocation',
  'bodyPct',
  'relativeVolume',
  'volumeAcceleration',
  'distEma9Pct',
  'emaCrossCount30',
  'vwapCrossCount30',
];

export function avgForensics(rows: EntryForensicsRow[], key: CompareForensicsKey): number | null {
  const vals = rows.map(r => r[key]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, x) => a + x, 0) / vals.length;
}
