import { config } from 'dotenv';
config({ path: '.env.local' });

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { addCalendarDays } from '@/lib/earningsDate';
import { getHistoricalBarsAll } from '@/lib/alpaca';
import { isTradingDay } from '@/lib/usMarketCalendar';
import { macroEventOn } from '@/lib/marketLens/events';
import { etStamp } from '@/lib/marketLens/sessionTime';

type Bar = { t: string; o: number; h: number; l: number; c: number; v: number; m: number };
type Day = { date: string; bars: Bar[]; prior: { high: number; low: number; close: number } };

const START = '2026-03-20';
const END = '2026-10-19';
const TRAIN_END = '2026-07-31';
const CACHE = '/tmp/marketlens-sweep-cache.json';

function asBar(raw: Record<string, unknown>): Omit<Bar, 'm'> | null {
  const t = raw.t;
  const o = Number(raw.o), h = Number(raw.h), l = Number(raw.l), c = Number(raw.c), v = Number(raw.v ?? 0);
  if (typeof t !== 'string' || ![o, h, l, c].every(Number.isFinite)) return null;
  return { t, o, h, l, c, v };
}

async function load(): Promise<Day[]> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  const dailyRaw = await getHistoricalBarsAll('SPY', START, END, '1Day');
  const daily = dailyRaw.map(asBar).filter((b): b is Omit<Bar, 'm'> => b != null);
  const minutes: Omit<Bar, 'm'>[] = [];
  let cursor = START;
  while (cursor <= END) {
    const next = addCalendarDays(cursor, 14);
    const raw = await getHistoricalBarsAll('SPY', `${cursor}T00:00:00Z`, `${next}T00:00:00Z`, '1Min');
    minutes.push(...raw.map(asBar).filter((b): b is Omit<Bar, 'm'> => b != null));
    cursor = next;
  }
  const byDate = new Map<string, Bar[]>();
  for (const b of minutes) {
    const et = etStamp(b.t);
    if (et.minutes < 9 * 60 + 30 || et.minutes >= 16 * 60) continue;
    const list = byDate.get(et.date) ?? [];
    list.push({ ...b, m: et.minutes });
    byDate.set(et.date, list);
  }
  const days: Day[] = [];
  for (let i = 1; i < daily.length; i++) {
    const date = daily[i].t.slice(0, 10);
    const bars = (byDate.get(date) ?? []).sort((a, b) => (a.t < b.t ? -1 : 1));
    if (!isTradingDay(date) || bars.length < 300) continue;
    const p = daily[i - 1];
    days.push({ date, bars, prior: { high: p.h, low: p.l, close: p.c } });
  }
  writeFileSync(CACHE, JSON.stringify(days));
  return days;
}

type Setup = 'S1' | 'RECLAIM' | 'VWAP' | 'ORB' | 'PULLBACK';
type Filter = 'none' | 'ema21up' | 'aboveVwap' | 'abovePrior' | 'gapUp';
type Cfg = { setup: Setup; stopAtr: number; targetR: number; filter: Filter; vol: boolean; timeBars: number };
type Trade = { date: string; r: number; reason: string; usd: number };

const SLIP = 0.01;

function run(day: Day, cfg: Cfg): Trade | null {
  const { bars, prior } = day;
  const event = macroEventOn(day.date);
  const earliest = event?.kind === 'morning_print' ? 600 : 585;
  let orH = -Infinity, orL = Infinity;
  let atr: number | null = null, prevC: number | null = null;
  let e21: number | null = null;
  const e21Hist: number[] = [];
  let vn = 0, vd = 0;
  const vols: number[] = [];
  const recent: Bar[] = [];
  let prevBelowVwap = false;
  let lowBroken = false, flush = Infinity;
  let pending: { stop: number } | null = null;
  let pos: { entry: number; stop: number; target: number; risk: number; held: number } | null = null;
  let done = false;

  const finish = (exit: number, reason: string): Trade => {
    const p = pos!;
    return { date: day.date, r: (exit - p.entry) / p.risk, reason, usd: exit - p.entry };
  };

  for (const bar of bars) {
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
      if (bar.l <= pos.stop) return finish(Math.min(pos.stop, bar.o) - SLIP, 'stop');
      if (bar.h >= pos.target) return finish(pos.target, 'target');
      if (bar.m >= 950 || pos.held >= cfg.timeBars) return finish(bar.c - SLIP, 'time');
      if (event?.kind === 'fomc' && bar.m >= 825) return finish(bar.c - SLIP, 'fomc');
    }

    if (pending && !pos) {
      const entry = bar.o + SLIP;
      const risk = entry - pending.stop;
      pending = null;
      if (risk > 0.03) {
        const target = entry + cfg.targetR * risk;
        pos = { entry, stop: entry - risk, target, risk, held: 0 };
        done = true;
        if (bar.l <= pos.stop) return finish(pos.stop - SLIP, 'stop');
        if (bar.h >= pos.target) return finish(pos.target, 'target');
      }
    }

    const lowLevels = [prior.low, ...(bar.m >= 585 ? [orL] : [])];
    if (bar.m >= 585) {
      if (!lowBroken && bar.c < orL) {
        lowBroken = true;
        flush = bar.l;
      } else if (lowBroken) flush = Math.min(flush, bar.l);
    }

    const canEnter = !done && !pos && !pending && atr && bar.m >= earliest && bar.m <= 945 && !(event?.kind === 'fomc' && bar.m >= 825);
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
        const touched = bar.l <= e21 && bar.c > e21 && green && e21Up;
        if (touched) stopBase = bar.l;
      }

      if (stopBase != null && filterOk && volOk) pending = { stop: stopBase - cfg.stopAtr * atr };
    }

    prevBelowVwap = bar.c < vwap;
    prevC = bar.c;
  }
  if (pos) return finish(bars[bars.length - 1].c - SLIP, 'time');
  return null;
}

function stats(trades: Trade[]) {
  const n = trades.length;
  const wins = trades.filter(t => t.r > 0).length;
  const total = trades.reduce((s, t) => s + t.r, 0);
  return { n, wins, winRate: n ? wins / n : 0, totalR: total, avgR: n ? total / n : 0 };
}

async function detail() {
  const days = await load();
  const picks: Array<[string, Cfg]> = [
    ['A best payoff', { setup: 'S1', stopAtr: 1.5, targetR: 3, filter: 'none', vol: true, timeBars: 120 }],
    ['B high win rate', { setup: 'VWAP', stopAtr: 2, targetR: 0.25, filter: 'gapUp', vol: true, timeBars: 60 }],
    ['live now', { setup: 'S1', stopAtr: 1, targetR: 2, filter: 'none', vol: true, timeBars: 60 }],
  ];
  for (const [name, cfg] of picks) {
    const out = days.map(d => run(d, cfg)).filter((t): t is Trade => t != null);
    const byMonth = new Map<string, Trade[]>();
    for (const t of out) {
      const k = t.date.slice(0, 7);
      byMonth.set(k, [...(byMonth.get(k) ?? []), t]);
    }
    const s = stats(out);
    const wins = out.filter(t => t.r > 0);
    const losses = out.filter(t => t.r <= 0);
    console.log(`\n${name}: ${s.n} trades, win ${(s.winRate * 100).toFixed(0)}%, total ${s.totalR.toFixed(2)}R, avg win ${(wins.reduce((a, t) => a + t.r, 0) / Math.max(1, wins.length)).toFixed(2)}R, avg loss ${(losses.reduce((a, t) => a + t.r, 0) / Math.max(1, losses.length)).toFixed(2)}R, net $${(out.reduce((a, t) => a + t.usd, 0) * 100).toFixed(0)} per 100 shares, avg win $${((wins.reduce((a, t) => a + t.usd, 0) / Math.max(1, wins.length)) * 100).toFixed(0)}, avg loss $${((losses.reduce((a, t) => a + t.usd, 0) / Math.max(1, losses.length)) * 100).toFixed(0)}`);
    for (const [m, list] of byMonth) {
      const ms = stats(list);
      console.log(`  ${m}: ${ms.n} trades, win ${(ms.winRate * 100).toFixed(0)}%, ${ms.totalR.toFixed(2)}R`);
    }
    const last20 = days.slice(-20).map(d => run(d, cfg)).filter((t): t is Trade => t != null);
    const l = stats(last20);
    console.log(`  last 20 sessions: ${l.n} trades, win ${(l.winRate * 100).toFixed(0)}%, ${l.totalR.toFixed(2)}R`);
  }
}

async function main() {
  if (process.argv.includes('--detail')) return detail();
  const days = await load();
  const train = days.filter(d => d.date <= TRAIN_END);
  const test = days.filter(d => d.date > TRAIN_END);
  console.log(`sessions ${days.length} (${days[0].date} to ${days[days.length - 1].date}); train ${train.length}, test ${test.length}`);

  const hold = (set: Day[]) => {
    const rets = set.map(d => {
      const entryBar = d.bars.find(b => b.m >= 585)!;
      const exitBar = [...d.bars].reverse().find(b => b.m <= 950)!;
      return (exitBar.c - entryBar.o) / entryBar.o;
    });
    const up = rets.filter(r => r > 0).length;
    return { upDays: up, days: rets.length, sumPct: +(rets.reduce((s, r) => s + r, 0) * 100).toFixed(2) };
  };
  console.log('baseline buy 9:45 ET, sell 3:50 ET', { train: hold(train), test: hold(test) });

  const setups: Setup[] = ['S1', 'RECLAIM', 'VWAP', 'ORB', 'PULLBACK'];
  const stops = [0.5, 1, 1.5, 2, 3];
  const targets = [0.25, 0.5, 1, 1.5, 2, 3];
  const filters: Filter[] = ['none', 'ema21up', 'aboveVwap', 'abovePrior', 'gapUp'];
  const vols = [true, false];
  const times = [30, 60, 120];

  const rows: Array<{ cfg: Cfg; tr: ReturnType<typeof stats>; te: ReturnType<typeof stats> }> = [];
  for (const setup of setups)
    for (const stopAtr of stops)
      for (const targetR of targets)
        for (const filter of filters)
          for (const vol of vols)
            for (const timeBars of times) {
              const cfg: Cfg = { setup, stopAtr, targetR, filter, vol, timeBars };
              const trT = train.map(d => run(d, cfg)).filter((t): t is Trade => t != null);
              const teT = test.map(d => run(d, cfg)).filter((t): t is Trade => t != null);
              rows.push({ cfg, tr: stats(trT), te: stats(teT) });
            }
  console.log('configs', rows.length);

  const fmt = (r: (typeof rows)[number]) => {
    const c = r.cfg;
    const s = (x: ReturnType<typeof stats>) => `${x.n} trades, win ${(x.winRate * 100).toFixed(0)}%, total ${x.totalR.toFixed(2)}R, avg ${x.avgR.toFixed(3)}R`;
    return `${c.setup} stop ${c.stopAtr}ATR target ${c.targetR}R filter ${c.filter} vol ${c.vol ? 'on' : 'off'} time ${c.timeBars} | TRAIN ${s(r.tr)} | TEST ${s(r.te)}`;
  };

  const eligible = rows.filter(r => r.tr.n >= 25);
  console.log('\nTOP 10 BY TRAIN AVG R (min 25 train trades)');
  [...eligible].sort((a, b) => b.tr.avgR - a.tr.avgR).slice(0, 10).forEach(r => console.log(fmt(r)));

  console.log('\nTOP 10 BY TRAIN WIN RATE (min 25 train trades)');
  [...eligible].sort((a, b) => b.tr.winRate - a.tr.winRate || b.tr.avgR - a.tr.avgR).slice(0, 10).forEach(r => console.log(fmt(r)));

  const both = eligible.filter(r => r.te.n >= 10 && r.tr.avgR > 0 && r.te.avgR > 0);
  console.log(`\nconfigs green on BOTH train and test (min 25/10 trades): ${both.length} of ${eligible.length}`);
  [...both].sort((a, b) => Math.min(a.tr.avgR, a.te.avgR) < Math.min(b.tr.avgR, b.te.avgR) ? 1 : -1).slice(0, 15).forEach(r => console.log(fmt(r)));

  const hi = eligible.filter(r => r.tr.winRate >= 0.9);
  console.log(`\nconfigs with >=90% train win rate: ${hi.length}`);
  hi.slice(0, 5).forEach(r => console.log(fmt(r)));

  writeFileSync('/tmp/marketlens-sweep.json', JSON.stringify(rows));
}

main();
