import { config } from 'dotenv';
config({ path: '.env.local' });

import { writeFileSync } from 'fs';
import {
  loadSweepDays,
  runLong as run,
  stats,
  SUPPORT_RUNNER,
  VWAP_SCALP,
  type Cfg,
  type Filter,
  type Setup,
  type SweepDay as Day,
  type Trade,
} from '@/lib/marketLens/sweepSim';

const START = '2026-03-20';
const END = '2026-10-19';
const TRAIN_END = '2026-07-31';
const CACHE = '/tmp/marketlens-sweep-cache.json';
const load = () => loadSweepDays(START, END, CACHE);

async function detail() {
  const days = await load();
  const picks: Array<[string, Cfg]> = [
    ['Support Runner', SUPPORT_RUNNER],
    ['VWAP Scalp', VWAP_SCALP],
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
