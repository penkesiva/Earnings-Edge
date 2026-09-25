import { computeSessionIndicators } from '@/lib/intraday/indicators/engine';
import type { MinuteBar } from '@/lib/intraday/types';

export type BarContext = {
  ema9: number;
  ema20: number;
  vwap: number;
  relVolume: number;
  emaSpreadPct: number;
  ema9Slope: number;
  ema20Slope: number;
  emaCrossCount30: number;
  vwapCrossCount30: number;
};

export function buildBarContexts(bars: MinuteBar[]): BarContext[] {
  const ind = computeSessionIndicators(bars);
  const out: BarContext[] = [];

  for (let i = 0; i < bars.length; i++) {
    const e9 = ind.ema9[i];
    const e20 = ind.ema20[i];
    const vwap = ind.vwap[i];
    if (!Number.isFinite(e9) || !Number.isFinite(e20) || !Number.isFinite(vwap) || e20 === 0) {
      out.push(emptyCtx());
      continue;
    }

    const e9Prev = i > 0 ? ind.ema9[i - 1] : e9;
    const e20Prev = i > 0 ? ind.ema20[i - 1] : e20;
    const ema9Slope = e9Prev !== 0 ? (e9 - e9Prev) / e9Prev : 0;
    const ema20Slope = e20Prev !== 0 ? (e20 - e20Prev) / e20Prev : 0;
    const emaSpreadPct = ((e9 - e20) / e20) * 100;

    let emaCrossCount30 = 0;
    let vwapCrossCount30 = 0;
    const start = Math.max(1, i - 29);
    for (let j = start; j <= i; j++) {
      const a9 = ind.ema9[j - 1];
      const b9 = ind.ema9[j];
      const a20 = ind.ema20[j - 1];
      const b20 = ind.ema20[j];
      if (a9 <= a20 && b9 > b20) emaCrossCount30 += 1;
      if (a9 >= a20 && b9 < b20) emaCrossCount30 += 1;

      const pc = bars[j - 1].c;
      const cc = bars[j].c;
      const pv = ind.vwap[j - 1];
      const cv = ind.vwap[j];
      if (pc <= pv && cc > cv) vwapCrossCount30 += 1;
      if (pc >= pv && cc < cv) vwapCrossCount30 += 1;
    }

    out.push({
      ema9: e9,
      ema20: e20,
      vwap,
      relVolume: ind.relVolume[i] ?? 1,
      emaSpreadPct,
      ema9Slope,
      ema20Slope,
      emaCrossCount30,
      vwapCrossCount30,
    });
  }

  return out;
}

function emptyCtx(): BarContext {
  return {
    ema9: NaN,
    ema20: NaN,
    vwap: NaN,
    relVolume: 1,
    emaSpreadPct: 0,
    ema9Slope: 0,
    ema20Slope: 0,
    emaCrossCount30: 0,
    vwapCrossCount30: 0,
  };
}

export function swingLow(bars: MinuteBar[], endIdx: number, lookback: number): number {
  const start = Math.max(0, endIdx - lookback + 1);
  let low = Infinity;
  for (let i = start; i <= endIdx; i++) low = Math.min(low, bars[i].l);
  return Number.isFinite(low) ? low : bars[endIdx].l;
}
