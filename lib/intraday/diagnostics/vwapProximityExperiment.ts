import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import { buildBarContexts } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { BacktestTrade, MinuteBar, SignalLogEntry } from '@/lib/intraday/types';

export type ProximityBucketId =
  | '0-0.05%'
  | '0.05-0.10%'
  | '0.10-0.20%'
  | '0.20-0.30%'
  | '>0.30%';

export type ProximityBucketRow = {
  bucket: ProximityBucketId;
  candidateCount: number;
  tradeCount: number;
  avgReturn5m: number | null;
  avgReturn10m: number | null;
  avgReturn20m: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  winRate: number | null;
  expectancyUsd: number | null;
};

const BUCKET_ORDER: ProximityBucketId[] = [
  '0-0.05%',
  '0.05-0.10%',
  '0.10-0.20%',
  '0.20-0.30%',
  '>0.30%',
];

function bucketId(distVwapPct: number): ProximityBucketId {
  const d = Math.abs(distVwapPct);
  if (d <= 0.05) return '0-0.05%';
  if (d <= 0.1) return '0.05-0.10%';
  if (d <= 0.2) return '0.10-0.20%';
  if (d <= 0.3) return '0.20-0.30%';
  return '>0.30%';
}

function forwardPct(bars: MinuteBar[], i: number, price: number, m: number): number | null {
  const j = i + m;
  if (j >= bars.length) return null;
  return (bars[j].c / price - 1) * 100;
}

function mfeMaePct(
  bars: MinuteBar[],
  i: number,
  price: number,
  horizon: number,
): { mfe: number; mae: number } | null {
  const end = Math.min(bars.length, i + horizon + 1);
  if (i + 1 >= end) return null;
  let mfe = 0;
  let mae = 0;
  for (let j = i + 1; j < end; j++) {
    mfe = Math.max(mfe, ((bars[j].h - price) / price) * 100);
    mae = Math.max(mae, ((price - bars[j].l) / price) * 100);
  }
  return { mfe, mae };
}

function distVwapAt(bars: MinuteBar[], i: number, price: number): number {
  const ctx = buildBarContexts(bars)[i];
  return ctx.vwap > 0 ? ((price - ctx.vwap) / ctx.vwap) * 100 : 0;
}

export function analyzeVwapProximityBuckets(
  candidates: SignalLogEntry[],
  trades: BacktestTrade[],
  barsBySession: Map<string, MinuteBar[]>,
): ProximityBucketRow[] {
  type Acc = {
    candidates: number;
    r5: number[];
    r10: number[];
    r20: number[];
    mfe: number[];
    mae: number[];
    pnls: number[];
  };
  const acc = new Map<ProximityBucketId, Acc>();
  for (const b of BUCKET_ORDER) {
    acc.set(b, { candidates: 0, r5: [], r10: [], r20: [], mfe: [], mae: [], pnls: [] });
  }

  for (const s of candidates) {
    const bars = barsBySession.get(s.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, s.timeEt);
    if (i < 0) continue;
    const dist = distVwapAt(bars, i, s.price);
    const id = bucketId(dist);
    const row = acc.get(id)!;
    row.candidates += 1;
    const r5 = forwardPct(bars, i, s.price, 5);
    const r10 = forwardPct(bars, i, s.price, 10);
    const r20 = forwardPct(bars, i, s.price, 20);
    const mm = mfeMaePct(bars, i, s.price, 20);
    if (r5 != null) row.r5.push(r5);
    if (r10 != null) row.r10.push(r10);
    if (r20 != null) row.r20.push(r20);
    if (mm) {
      row.mfe.push(mm.mfe);
      row.mae.push(mm.mae);
    }
  }

  for (const t of trades) {
    const bars = barsBySession.get(t.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, t.entryTimeEt);
    if (i < 0) continue;
    const dist = distVwapAt(bars, i, t.entryPrice);
    const id = bucketId(dist);
    acc.get(id)!.pnls.push(t.pnlUsd);
  }

  const tradeCounts = new Map<ProximityBucketId, number>();
  for (const t of trades) {
    const bars = barsBySession.get(t.sessionDate);
    if (!bars) continue;
    const i = findBarIndexByTimeEt(bars, t.entryTimeEt);
    if (i < 0) continue;
    const id = bucketId(distVwapAt(bars, i, t.entryPrice));
    tradeCounts.set(id, (tradeCounts.get(id) ?? 0) + 1);
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return BUCKET_ORDER.map(bucket => {
    const row = acc.get(bucket)!;
    const pnls = row.pnls;
    const wins = pnls.filter(p => p > 0);
    return {
      bucket,
      candidateCount: row.candidates,
      tradeCount: tradeCounts.get(bucket) ?? 0,
      avgReturn5m: avg(row.r5),
      avgReturn10m: avg(row.r10),
      avgReturn20m: avg(row.r20),
      avgMfePct: avg(row.mfe),
      avgMaePct: avg(row.mae),
      winRate: pnls.length ? (wins.length / pnls.length) * 100 : null,
      expectancyUsd: pnls.length ? avg(pnls) : null,
    };
  });
}
