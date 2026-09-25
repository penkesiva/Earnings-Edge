import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import type { SignalLogEntry } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type RejectionBucket =
  | 'CHOP'
  | 'VWAP'
  | 'MOMENTUM'
  | 'EMA_SLOPE'
  | 'EMA_SPREAD'
  | 'PRICE_EXTENSION'
  | 'VOLUME'
  | 'COOLDOWN'
  | 'TIME'
  | 'OTHER';

export type RejectionBucketStats = {
  bucket: RejectionBucket;
  count: number;
  pct: number;
  avgReturn5m: number | null;
  avgReturn10m: number | null;
  avgReturn20m: number | null;
  avgMfePct: number | null;
};

function bucketForSignal(s: SignalLogEntry): RejectionBucket {
  const r = s.rejectionReason ?? '';
  if (r === 'CHOP_OR_NON_BULL_REGIME') return 'CHOP';
  if (r === 'PRICE_EXTENDED') return 'PRICE_EXTENSION';
  if (r === 'VOLUME_FILTER') return 'VOLUME';
  if (r === 'MOMENTUM_SCORE_LOW' || r === 'NO_MICRO_BREAKOUT' || r === 'WEAK_CANDLE_CLOSE') {
    return 'MOMENTUM';
  }
  if (r === 'DELAYED_CONFIRMATION') return 'OTHER';
  if (r === 'SCORE_BELOW_MIN') {
    const lines = s.scoreLines.join(' ');
    if (lines.includes('below VWAP')) return 'VWAP';
    if (lines.includes('tight EMA spread')) return 'EMA_SPREAD';
    if (lines.includes('- EMA9')) return 'EMA_SLOPE';
    if (lines.includes('CHOP')) return 'CHOP';
    return 'OTHER';
  }
  return 'OTHER';
}

function forwardFromBar(bars: MinuteBar[], i: number, price: number, mins: number): number | null {
  const j = i + mins;
  if (j >= bars.length) return null;
  return (bars[j].c / price - 1) * 100;
}

function mfeFromBar(bars: MinuteBar[], i: number, price: number, horizon: number): number | null {
  const end = Math.min(bars.length, i + horizon + 1);
  if (i + 1 >= end) return null;
  let maxUp = 0;
  for (let j = i + 1; j < end; j++) {
    maxUp = Math.max(maxUp, ((bars[j].h - price) / price) * 100);
  }
  return maxUp;
}

export function analyzeRejections(
  signalLog: SignalLogEntry[],
  barsBySession: Map<string, MinuteBar[]>,
): RejectionBucketStats[] {
  const rejected = signalLog.filter(s => !s.accepted);
  const totals = new Map<
    RejectionBucket,
    { n: number; r5: number[]; r10: number[]; r20: number[]; mfe: number[] }
  >();

  for (const s of rejected) {
    const bucket = bucketForSignal(s);
    const bars = barsBySession.get(s.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, s.timeEt);
    if (i < 0) continue;
    const price = s.price;
    const row = totals.get(bucket) ?? { n: 0, r5: [], r10: [], r20: [], mfe: [] };
    row.n += 1;
    const r5 = forwardFromBar(bars, i, price, 5);
    const r10 = forwardFromBar(bars, i, price, 10);
    const r20 = forwardFromBar(bars, i, price, 20);
    const mfe = mfeFromBar(bars, i, price, 20);
    if (r5 != null) row.r5.push(r5);
    if (r10 != null) row.r10.push(r10);
    if (r20 != null) row.r20.push(r20);
    if (mfe != null) row.mfe.push(mfe);
    totals.set(bucket, row);
  }

  const allBuckets: RejectionBucket[] = [
    'CHOP',
    'VWAP',
    'MOMENTUM',
    'EMA_SLOPE',
    'EMA_SPREAD',
    'PRICE_EXTENSION',
    'VOLUME',
    'COOLDOWN',
    'TIME',
    'OTHER',
  ];
  const totalN = rejected.length || 1;

  return allBuckets.map(bucket => {
    const row = totals.get(bucket);
    const count = row?.n ?? 0;
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : null);
    return {
      bucket,
      count,
      pct: (count / totalN) * 100,
      avgReturn5m: row ? avg(row.r5) : null,
      avgReturn10m: row ? avg(row.r10) : null,
      avgReturn20m: row ? avg(row.r20) : null,
      avgMfePct: row ? avg(row.mfe) : null,
    };
  });
}

export function analyzeAcceptedForward(
  signalLog: SignalLogEntry[],
  barsBySession: Map<string, MinuteBar[]>,
): { avgReturn5m: number | null; avgReturn10m: number | null; avgMfe20: number | null; n: number } {
  const accepted = signalLog.filter(s => s.accepted);
  const r5: number[] = [];
  const r10: number[] = [];
  const mfe: number[] = [];
  for (const s of accepted) {
    const bars = barsBySession.get(s.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, s.timeEt);
    if (i < 0) continue;
    const f5 = forwardFromBar(bars, i, s.price, 5);
    const f10 = forwardFromBar(bars, i, s.price, 10);
    const m = mfeFromBar(bars, i, s.price, 20);
    if (f5 != null) r5.push(f5);
    if (f10 != null) r10.push(f10);
    if (m != null) mfe.push(m);
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : null);
  return { avgReturn5m: avg(r5), avgReturn10m: avg(r10), avgMfe20: avg(mfe), n: accepted.length };
}
