import type { MinuteBar } from '@/lib/intraday/types';

export function filterRegularSessionBars(bars: MinuteBar[], sessionDate: string): MinuteBar[] {
  return bars
    .filter(b => barSessionDateEt(b.t) === sessionDate)
    .filter(b => {
      const et = barEtHHMM(b.t);
      return et >= '09:30' && et <= '16:00';
    })
    .sort((a, b) => a.t.localeCompare(b.t));
}

function barSessionDateEt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function barEtHHMM(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find(p => p.type === 'hour')?.value ?? '00';
  const m = parts.find(p => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

export function computeSessionIndicators(bars: MinuteBar[]) {
  const vwap: number[] = [];
  const ema9: number[] = [];
  const ema20: number[] = [];
  const relVolume: number[] = [];
  let cumVol = 0;
  let cumPv = 0;
  let ema9v: number | null = null;
  let ema20v: number | null = null;
  const vols: number[] = [];

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    cumVol += b.v;
    cumPv += ((b.h + b.l + b.c) / 3) * b.v;
    vwap.push(cumVol > 0 ? cumPv / cumVol : b.c);
    ema9v = ema(ema9v, b.c, 9);
    ema20v = ema(ema20v, b.c, 20);
    ema9.push(ema9v);
    ema20.push(ema20v);
    vols.push(b.v);
    const avg =
      vols.length >= 20
        ? vols.slice(-20).reduce((a, x) => a + x, 0) / 20
        : vols.reduce((a, x) => a + x, 0) / vols.length;
    relVolume.push(avg > 0 ? b.v / avg : 1);
  }

  return { vwap, ema9, ema20, relVolume };
}

function ema(prev: number | null, value: number, period: number): number {
  const k = 2 / (period + 1);
  if (prev == null) return value;
  return value * k + prev * (1 - k);
}

export function openingRange(bars: MinuteBar[], minutes: number): { orh: number; orl: number } | null {
  if (bars.length < minutes) return null;
  const slice = bars.slice(0, minutes);
  return {
    orh: Math.max(...slice.map(b => b.h)),
    orl: Math.min(...slice.map(b => b.l)),
  };
}
