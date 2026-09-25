import { barEtHHMM } from '@/lib/intraday/indicators/engine';
import type { MinuteBar } from '@/lib/intraday/types';

export function findBarIndexByTimeEt(bars: MinuteBar[], timeEt: string): number {
  for (let i = 0; i < bars.length; i++) {
    if (barEtHHMM(bars[i].t) === timeEt) return i;
  }
  return -1;
}

export function priorBarHigh(bars: MinuteBar[], i: number, lookback: number): number | null {
  if (i < lookback) return null;
  let h = -Infinity;
  for (let j = i - lookback; j < i; j++) h = Math.max(h, bars[j].h);
  return Number.isFinite(h) ? h : null;
}
