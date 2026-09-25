import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import type { BacktestTrade, MinuteBar, SignalLogEntry } from '@/lib/intraday/types';

export type PercentBBucket = '<0.50' | '0.50-0.75' | '0.75-0.90' | '0.90-1.00' | '>1.00';
export type BandwidthRegime = 'contracting' | 'flat' | 'expanding';

export type BollingerBucketRow = {
  bucket: string;
  candidateCount: number;
  tradeCount: number;
  loserCount: number;
  winnerCount: number;
};

function percentBBucket(p: number): PercentBBucket {
  if (p < 0.5) return '<0.50';
  if (p < 0.75) return '0.50-0.75';
  if (p < 0.9) return '0.75-0.90';
  if (p <= 1) return '0.90-1.00';
  return '>1.00';
}

function bandwidthRegime(slope: number): BandwidthRegime {
  if (slope < -0.02) return 'contracting';
  if (slope > 0.02) return 'expanding';
  return 'flat';
}

export function analyzeBollingerBuckets(
  candidates: SignalLogEntry[],
  trades: BacktestTrade[],
  barsBySession: Map<string, MinuteBar[]>,
): { percentB: BollingerBucketRow[]; bandwidth: BollingerBucketRow[] } {
  const pbAcc = new Map<string, BollingerBucketRow>();
  const bwAcc = new Map<string, BollingerBucketRow>();

  const ensure = (map: Map<string, BollingerBucketRow>, key: string) => {
    if (!map.has(key)) {
      map.set(key, { bucket: key, candidateCount: 0, tradeCount: 0, loserCount: 0, winnerCount: 0 });
    }
    return map.get(key)!;
  };

  const tradeKeys = new Set(trades.map(t => `${t.sessionDate}|${t.entryTimeEt}`));
  const tradePnl = new Map(trades.map(t => [`${t.sessionDate}|${t.entryTimeEt}`, t.pnlUsd]));

  for (const s of candidates) {
    const bars = barsBySession.get(s.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, s.timeEt);
    if (i < 0) continue;
    const bb = bollingerAtBar(bars, i);
    if (!bb) continue;
    const pb = percentBBucket(bb.percentB);
    const bw = bandwidthRegime(bb.bandwidthSlope);
    ensure(pbAcc, pb).candidateCount += 1;
    ensure(bwAcc, bw).candidateCount += 1;
    const key = `${s.sessionDate}|${s.timeEt}`;
    if (tradeKeys.has(key)) {
      ensure(pbAcc, pb).tradeCount += 1;
      ensure(bwAcc, bw).tradeCount += 1;
      const pnl = tradePnl.get(key) ?? 0;
      if (pnl > 0) {
        ensure(pbAcc, pb).winnerCount += 1;
        ensure(bwAcc, bw).winnerCount += 1;
      } else {
        ensure(pbAcc, pb).loserCount += 1;
        ensure(bwAcc, bw).loserCount += 1;
      }
    }
  }

  return {
    percentB: ['<0.50', '0.50-0.75', '0.75-0.90', '0.90-1.00', '>1.00'].map(
      k => pbAcc.get(k) ?? { bucket: k, candidateCount: 0, tradeCount: 0, loserCount: 0, winnerCount: 0 },
    ),
    bandwidth: ['contracting', 'flat', 'expanding'].map(
      k => bwAcc.get(k) ?? { bucket: k, candidateCount: 0, tradeCount: 0, loserCount: 0, winnerCount: 0 },
    ),
  };
}
