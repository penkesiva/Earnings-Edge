/**
 * Research simulator for MarketLens sweeps. Long-only on the bars it is given;
 * bearish setups run on `mirrorDay` bars so the same rules buy puts instead of shorting.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { addCalendarDays } from '@/lib/earningsDate';
import { getHistoricalBarsAll } from '@/lib/alpaca';
import { isTradingDay } from '@/lib/usMarketCalendar';
import { macroEventOn } from '@/lib/marketLens/events';
import { etStamp } from '@/lib/marketLens/sessionTime';

export type SweepBar = { t: string; o: number; h: number; l: number; c: number; v: number; m: number };
export type SweepDay = {
  date: string;
  bars: SweepBar[];
  prior: { high: number; low: number; close: number };
};

export type Setup = 'S1' | 'RECLAIM' | 'VWAP' | 'ORB' | 'PULLBACK';
export type Filter = 'none' | 'ema21up' | 'aboveVwap' | 'abovePrior' | 'gapUp';
export type Cfg = { setup: Setup; stopAtr: number; targetR: number; filter: Filter; vol: boolean; timeBars: number };
export type Trade = {
  date: string;
  r: number;
  reason: string;
  usd: number;
  entryIdx: number;
  exitIdx: number;
  entryPx: number;
  exitPx: number;
};

/** Gap-up VWAP reclaim, tiny target, wide stop. Was "B". */
export const VWAP_SCALP: Cfg = { setup: 'VWAP', stopAtr: 2, targetR: 0.25, filter: 'gapUp', vol: true, timeBars: 60 };
/** Support bounce with a wide stop and a 3R target. Was "A". */
export const SUPPORT_RUNNER: Cfg = { setup: 'S1', stopAtr: 1.5, targetR: 3, filter: 'none', vol: true, timeBars: 120 };

const SLIP = 0.01;

function asBar(raw: Record<string, unknown>): Omit<SweepBar, 'm'> | null {
  const t = raw.t;
  const o = Number(raw.o), h = Number(raw.h), l = Number(raw.l), c = Number(raw.c), v = Number(raw.v ?? 0);
  if (typeof t !== 'string' || ![o, h, l, c].every(Number.isFinite)) return null;
  return { t, o, h, l, c, v };
}

export async function loadSweepDays(start: string, end: string, cache: string): Promise<SweepDay[]> {
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const dailyRaw = await getHistoricalBarsAll('SPY', start, end, '1Day');
  const daily = dailyRaw.map(asBar).filter((b): b is Omit<SweepBar, 'm'> => b != null);
  const minutes: Omit<SweepBar, 'm'>[] = [];
  let cursor = start;
  while (cursor <= end) {
    const next = addCalendarDays(cursor, 14);
    const raw = await getHistoricalBarsAll('SPY', `${cursor}T00:00:00Z`, `${next}T00:00:00Z`, '1Min');
    minutes.push(...raw.map(asBar).filter((b): b is Omit<SweepBar, 'm'> => b != null));
    cursor = next;
  }
  const byDate = new Map<string, SweepBar[]>();
  for (const b of minutes) {
    const et = etStamp(b.t);
    if (et.minutes < 9 * 60 + 30 || et.minutes >= 16 * 60) continue;
    const list = byDate.get(et.date) ?? [];
    list.push({ ...b, m: et.minutes });
    byDate.set(et.date, list);
  }
  const days: SweepDay[] = [];
  for (let i = 1; i < daily.length; i++) {
    const date = daily[i].t.slice(0, 10);
    const bars = (byDate.get(date) ?? []).sort((a, b) => (a.t < b.t ? -1 : 1));
    if (!isTradingDay(date) || bars.length < 300) continue;
    const p = daily[i - 1];
    days.push({ date, bars, prior: { high: p.h, low: p.l, close: p.c } });
  }
  writeFileSync(cache, JSON.stringify(days));
  return days;
}

/** Price-negated copy: a long on this day is a bearish trade on the real tape. */
export function mirrorDay(day: SweepDay): SweepDay {
  return {
    date: day.date,
    bars: day.bars.map(b => ({ ...b, o: -b.o, h: -b.l, l: -b.h, c: -b.c })),
    prior: { high: -day.prior.low, low: -day.prior.high, close: -day.prior.close },
  };
}

export function runLong(day: SweepDay, cfg: Cfg): Trade | null {
  const { bars, prior } = day;
  const event = macroEventOn(day.date);
  const earliest = event?.kind === 'morning_print' ? 600 : 585;
  let orH = -Infinity, orL = Infinity;
  let atr: number | null = null, prevC: number | null = null;
  let e21: number | null = null;
  const e21Hist: number[] = [];
  let vn = 0, vd = 0;
  const vols: number[] = [];
  const recent: SweepBar[] = [];
  let prevBelowVwap = false;
  let lowBroken = false, flush = Infinity;
  let pending: { stop: number } | null = null;
  let pos: { entry: number; stop: number; target: number; risk: number; held: number; idx: number } | null = null;
  let done = false;

  const finish = (exit: number, reason: string, i: number): Trade => {
    const p = pos!;
    return {
      date: day.date,
      r: (exit - p.entry) / p.risk,
      reason,
      usd: exit - p.entry,
      entryIdx: p.idx,
      exitIdx: i,
      entryPx: p.entry,
      exitPx: exit,
    };
  };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const tr = prevC == null ? bar.h - bar.l : Math.max(bar.h - bar.l, Math.abs(bar.h - prevC), Math.abs(bar.l - prevC));
    atr = atr == null ? tr : atr + (tr - atr) / 14;
    e21 = e21 == null ? bar.c : e21 + (2 / 22) * (bar.c - e21);
    e21Hist.push(e21);
    vn += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    vd += bar.v;
    const vwap = vd > 0 ? vn / vd : bar.c;
    vols.push(bar.v);
    if (vols.length > 20) vols.shift();
    const volAvg = vols.reduce((s, v) => s + v, 0) / vols.length;
    recent.push(bar);
    if (recent.length > 10) recent.shift();
    if (bar.m < 585) {
      orH = Math.max(orH, bar.h);
      orL = Math.min(orL, bar.l);
    }

    if (pos) {
      pos.held++;
      if (bar.l <= pos.stop) return finish(Math.min(pos.stop, bar.o) - SLIP, 'stop', i);
      if (bar.h >= pos.target) return finish(pos.target, 'target', i);
      if (bar.m >= 950 || pos.held >= cfg.timeBars) return finish(bar.c - SLIP, 'time', i);
      if (event?.kind === 'fomc' && bar.m >= 825) return finish(bar.c - SLIP, 'fomc', i);
    }

    if (pending && !pos) {
      const entry = bar.o + SLIP;
      const risk = entry - pending.stop;
      pending = null;
      if (risk > 0.03) {
        pos = { entry, stop: entry - risk, target: entry + cfg.targetR * risk, risk, held: 0, idx: i };
        done = true;
        if (bar.l <= pos.stop) return finish(pos.stop - SLIP, 'stop', i);
        if (bar.h >= pos.target) return finish(pos.target, 'target', i);
      }
    }

    const lowLevels = [prior.low, ...(bar.m >= 585 ? [orL] : [])];
    if (bar.m >= 585) {
      if (!lowBroken && bar.c < orL) {
        lowBroken = true;
        flush = bar.l;
      } else if (lowBroken) flush = Math.min(flush, bar.l);
    }

    const canEnter =
      !done && !pos && !pending && atr && bar.m >= earliest && bar.m <= 945 && !(event?.kind === 'fomc' && bar.m >= 825);
    if (canEnter && atr) {
      const e21Up = e21Hist.length > 4 && e21 > e21Hist[e21Hist.length - 4];
      const filterOk =
        cfg.filter === 'none' ||
        (cfg.filter === 'ema21up' && e21Up && bar.c > e21) ||
        (cfg.filter === 'aboveVwap' && bar.c > vwap) ||
        (cfg.filter === 'abovePrior' && bar.c > prior.close) ||
        (cfg.filter === 'gapUp' && bars[0].o > prior.close);
      const volOk = !cfg.vol || bar.v >= volAvg;
      const green = bar.c > bar.o;
      let stopBase: number | null = null;

      if (cfg.setup === 'S1') {
        const zone = Math.max(0.05, atr * 0.25);
        const lvl = lowLevels.find(L => bar.l <= L + zone && bar.c > L && green);
        if (lvl != null) stopBase = Math.min(bar.l, lvl);
      } else if (cfg.setup === 'RECLAIM') {
        if (lowBroken && prevC != null && prevC <= orL && bar.c > orL && green) {
          stopBase = flush;
          lowBroken = false;
          flush = Infinity;
        }
      } else if (cfg.setup === 'VWAP') {
        if (prevBelowVwap && bar.c > vwap && green) stopBase = Math.min(...recent.slice(-5).map(b => b.l));
      } else if (cfg.setup === 'ORB') {
        if (prevC != null && prevC <= orH && bar.c > orH && green) stopBase = Math.min(...recent.slice(-5).map(b => b.l));
      } else if (cfg.setup === 'PULLBACK') {
        if (bar.l <= e21 && bar.c > e21 && green && e21Up) stopBase = bar.l;
      }

      if (stopBase != null && filterOk && volOk) pending = { stop: stopBase - cfg.stopAtr * atr };
    }

    prevBelowVwap = bar.c < vwap;
    prevC = bar.c;
  }
  if (pos) {
    const last = bars.length - 1;
    return finish(bars[last].c - SLIP, 'time', last);
  }
  return null;
}

export function stats(trades: Array<{ r: number }>) {
  const n = trades.length;
  const wins = trades.filter(t => t.r > 0).length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  return { n, wins, winRate: n ? wins / n : 0, totalR: total, avgR: n ? total / n : 0 };
}
