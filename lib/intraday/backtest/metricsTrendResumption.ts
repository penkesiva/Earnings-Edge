import { aggregateBacktestMetrics } from '@/lib/intraday/backtest/metrics';
import type { BacktestMetrics, BacktestTrade } from '@/lib/intraday/types';

export type TrendResumptionCompareMetrics = BacktestMetrics & {
  expectancyPerTrade: number | null;
  avgMfeUsd: number | null;
  avgMaeUsd: number | null;
  medianMfeUsd: number | null;
  medianMaeUsd: number | null;
  vwapBuckets?: Record<string, { trades: number; pnlUsd: number }>;
  percentBBuckets?: Record<string, { trades: number; pnlUsd: number }>;
  timeBuckets?: Record<string, { trades: number; pnlUsd: number }>;
};

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function aggregateTrendResumptionMetrics(
  trades: BacktestTrade[],
  tradingDays: number,
  enriched: {
    trade: BacktestTrade;
    distVwap: number;
    percentB: number | null;
    timeBucket: string;
  }[],
): TrendResumptionCompareMetrics {
  const base = aggregateBacktestMetrics(trades, tradingDays);
  const pnls = trades.map(t => t.pnlUsd);
  const mfe = trades.map(t => t.mfeUsd).filter((n): n is number => n != null);
  const mae = trades.map(t => t.maeUsd).filter((n): n is number => n != null);

  const vwapBuckets: Record<string, { trades: number; pnlUsd: number }> = {};
  const percentBBuckets: Record<string, { trades: number; pnlUsd: number }> = {};
  const timeBuckets: Record<string, { trades: number; pnlUsd: number }> = {};

  for (const e of enriched) {
    const vb = bucketVwap(e.distVwap);
    vwapBuckets[vb] = vwapBuckets[vb] ?? { trades: 0, pnlUsd: 0 };
    vwapBuckets[vb].trades += 1;
    vwapBuckets[vb].pnlUsd += e.trade.pnlUsd;

    const pb = e.percentB != null ? bucketPb(e.percentB) : 'na';
    percentBBuckets[pb] = percentBBuckets[pb] ?? { trades: 0, pnlUsd: 0 };
    percentBBuckets[pb].trades += 1;
    percentBBuckets[pb].pnlUsd += e.trade.pnlUsd;

    timeBuckets[e.timeBucket] = timeBuckets[e.timeBucket] ?? { trades: 0, pnlUsd: 0 };
    timeBuckets[e.timeBucket].trades += 1;
    timeBuckets[e.timeBucket].pnlUsd += e.trade.pnlUsd;
  }

  return {
    ...base,
    expectancyPerTrade: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null,
    avgMfeUsd: mfe.length ? mfe.reduce((a, b) => a + b, 0) / mfe.length : null,
    avgMaeUsd: mae.length ? mae.reduce((a, b) => a + b, 0) / mae.length : null,
    medianMfeUsd: median(mfe),
    medianMaeUsd: median(mae),
    vwapBuckets,
    percentBBuckets,
    timeBuckets,
  };
}

function bucketVwap(dist: number): string {
  const d = Math.abs(dist);
  if (d <= 0.05) return '0-0.05%';
  if (d <= 0.1) return '0.05-0.10%';
  if (d <= 0.2) return '0.10-0.20%';
  if (d <= 0.3) return '0.20-0.30%';
  return '>0.30%';
}

function bucketPb(p: number): string {
  if (p < 0.5) return '<0.50';
  if (p < 0.75) return '0.50-0.75';
  if (p < 0.9) return '0.75-0.90';
  if (p <= 1) return '0.90-1.00';
  return '>1.00';
}
