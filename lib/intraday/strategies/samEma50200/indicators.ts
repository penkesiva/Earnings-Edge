import { barEtHHMM, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
import type { MinuteBar } from '@/lib/intraday/types';

export type AggBar = MinuteBar & {
  sessionDate: string;
  /** Bar close time (bucket start + barMinutes), ET HH:MM. */
  endEt: string;
};

function sessionDateEt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Bucket RTH 1m bars (09:30–16:00 ET) into N-minute bars, never crossing sessions. */
export function aggregateBars(bars: MinuteBar[], barMinutes: number): AggBar[] {
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  const out: AggBar[] = [];
  let key = '';
  let cur: AggBar | null = null;

  const sorted = [...bars].sort((a, b) => a.t.localeCompare(b.t));
  for (const b of sorted) {
    const mins = etHHMMToMinutes(barEtHHMM(b.t));
    if (mins < open || mins >= close) continue;
    const session = sessionDateEt(b.t);
    const bucketStart = open + Math.floor((mins - open) / barMinutes) * barMinutes;
    const k = `${session}|${bucketStart}`;
    if (k !== key || !cur) {
      if (cur) out.push(cur);
      key = k;
      cur = {
        t: b.t,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
        sessionDate: session,
        endEt: minutesToHHMM(bucketStart + barMinutes),
      };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** EMA seeded with SMA of the first `period` finite values. NaN before seed. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let count = 0;
  let sum = 0;
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (!Number.isFinite(prev)) {
      sum += v;
      count += 1;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder ATR. */
export function atr(bars: MinuteBar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= period) return out;
  const tr = bars.map((b, i) =>
    i === 0
      ? b.h - b.l
      : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)),
  );
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function slopePct(series: number[], i: number, lookback: number): number {
  const a = series[i - lookback];
  const b = series[i];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return NaN;
  return ((b - a) / a) * 100;
}
