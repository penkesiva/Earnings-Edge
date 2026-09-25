import type { MinuteBar } from '@/lib/intraday/types';

export type BollingerSnapshot = {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  bandwidthSlope: number;
  percentB: number;
};

const BB_PERIOD = 20;
const BB_STD = 2;

export function bollingerAtBar(bars: MinuteBar[], i: number): BollingerSnapshot | null {
  if (i < BB_PERIOD - 1) return null;
  const slice = bars.slice(i - BB_PERIOD + 1, i + 1);
  const closes = slice.map(b => b.c);
  const middle = closes.reduce((a, x) => a + x, 0) / BB_PERIOD;
  const variance = closes.reduce((a, x) => a + (x - middle) ** 2, 0) / BB_PERIOD;
  const std = Math.sqrt(variance);
  const upper = middle + BB_STD * std;
  const lower = middle - BB_STD * std;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  const bandWidth = upper - lower;
  const percentB = bandWidth > 0 ? (bars[i].c - lower) / bandWidth : 0.5;

  const prev = bollingerAtBar(bars, i - 1);
  const bandwidthSlope = prev ? bandwidth - prev.bandwidth : 0;

  return { upper, middle, lower, bandwidth, bandwidthSlope, percentB };
}
