import type { MinuteBar } from '@/lib/intraday/types';

export type CandleParts = {
  /** Body size, floored so doji candles don't make every wick look infinite. */
  body: number;
  upperWick: number;
  lowerWick: number;
  range: number;
  bodyMid: number;
};

export function candleParts(b: MinuteBar): CandleParts {
  const top = Math.max(b.o, b.c);
  const bottom = Math.min(b.o, b.c);
  return {
    body: Math.max(top - bottom, b.c * 0.0001),
    upperWick: b.h - top,
    lowerWick: bottom - b.l,
    range: b.h - b.l,
    bodyMid: (top + bottom) / 2,
  };
}

/** Long lower wick (buyers rejected the lows). */
export function isHammer(b: MinuteBar, wickBodyRatio: number): boolean {
  const p = candleParts(b);
  return p.range > 0 && p.lowerWick >= wickBodyRatio * p.body;
}

/** Long upper wick that dominates the candle (sellers rejected the highs). */
export function isUpperWickRejection(
  b: MinuteBar,
  wickBodyRatio: number,
  upperWickRangePct: number,
): boolean {
  const p = candleParts(b);
  return p.range > 0 && p.upperWick >= wickBodyRatio * p.body && p.upperWick >= upperWickRangePct * p.range;
}
