import { config } from 'dotenv';
config({ path: '.env.local' });

import { macroEventOn } from '@/lib/marketLens/events';
import {
  loadSweepDays,
  mirrorDay,
  runLong,
  SUPPORT_RUNNER,
  VWAP_SCALP,
  type Cfg,
  type Filter,
  type Setup,
  type SweepDay,
  type Trade,
} from '@/lib/marketLens/sweepSim';

/**
 * 1DTE SPY options on MarketLens signals. Bullish signals buy calls; the same rules on a
 * price-mirrored tape buy puts. Premiums are Black-Scholes estimates, not real quotes:
 * IV = max(12%, 1.15 x 20-day realized), expiry at the next session's 4:00 PM ET,
 * trading-minute clock, $1 strikes, $0.02 per share paid on each side for the spread.
 */

const START = '2026-03-20';
const END = '2026-10-19';
const TRAIN_END = '2026-07-31';
const CACHE = '/tmp/marketlens-sweep-cache.json';
const HALF_SPREAD = 0.02;
const YEAR_MIN = 390 * 252;

type Side = 'call' | 'put' | 'both';
type Exit = { kind: 'underlying' } | { kind: 'premium'; tp: number; sl: number };
type OptTrade = { date: string; side: 'call' | 'put'; pnl: number; entryPrem: number; exitPrem: number; reason: string };

function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function bs(kind: 'call' | 'put', s: number, k: number, tYears: number, iv: number): number {
  if (tYears <= 0) return Math.max(0, kind === 'call' ? s - k : k - s);
  const st = iv * Math.sqrt(tYears);
  const d1 = (Math.log(s / k) + 0.5 * iv * iv * tYears) / st;
  const d2 = d1 - st;
  return kind === 'call' ? s * normCdf(d1) - k * normCdf(d2) : k * normCdf(-d2) - s * normCdf(-d1);
}

const yearsLeft = (minuteOfDay: number) => (960 - minuteOfDay + 390) / YEAR_MIN;

function ivByDate(days: SweepDay[]): Map<string, number> {
  const closes = days.map(d => d.prior.close);
  const out = new Map<string, number>();
  for (let i = 0; i < days.length; i++) {
    const window = closes.slice(Math.max(0, i - 20), i + 1);
    const rets = window.slice(1).map((c, j) => Math.log(c / window[j]));
    const mean = rets.reduce((s, r) => s + r, 0) / Math.max(1, rets.length);
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    const rv = Number.isFinite(sd) && rets.length >= 5 ? sd * Math.sqrt(252) : 0.15;
    out.set(days[i].date, Math.max(0.12, 1.15 * rv));
  }
  return out;
}

function priceOption(
  day: SweepDay,
  trade: Trade,
  side: 'call' | 'put',
  strikeOffset: number,
  exit: Exit,
  timeBars: number,
  iv: number,
): OptTrade {
  const real = (px: number) => (side === 'put' ? -px : px);
  const bars = day.bars;
  const entryBar = bars[trade.entryIdx];
  const spot = real(trade.entryPx);
  const atm = Math.round(spot);
  const strike = side === 'call' ? atm + strikeOffset : atm - strikeOffset;
  const value = (s: number, m: number) => bs(side, s, strike, yearsLeft(m), iv);
  const entryPrem = value(spot, entryBar.m) + HALF_SPREAD;

  const done = (exitPrem: number, reason: string): OptTrade => {
    const sold = Math.max(0, exitPrem - HALF_SPREAD);
    return { date: day.date, side, pnl: (sold - entryPrem) * 100, entryPrem, exitPrem: sold, reason };
  };

  if (exit.kind === 'underlying') {
    return done(value(real(trade.exitPx), bars[trade.exitIdx].m), trade.reason);
  }

  const tpPrem = entryPrem * (1 + exit.tp);
  const slPrem = entryPrem * (1 - exit.sl);
  const fomc = macroEventOn(day.date)?.kind === 'fomc';
  for (let i = trade.entryIdx; i < bars.length; i++) {
    const b = bars[i];
    const best = side === 'call' ? b.h : b.l;
    const worst = side === 'call' ? b.l : b.h;
    if (value(worst, b.m) <= slPrem) return done(slPrem, 'premium stop');
    if (value(best, b.m) >= tpPrem) return done(tpPrem, 'premium target');
    const held = i - trade.entryIdx;
    if (b.m >= 950 || held >= timeBars || (fomc && b.m >= 825)) return done(value(b.c, b.m), 'time');
  }
  const last = bars[bars.length - 1];
  return done(value(last.c, last.m), 'time');
}

type Signal = { trade: Trade; side: 'call' | 'put' };

function pickSignal(call: Trade | null, put: Trade | null, side: Side): Signal | null {
  if (side === 'call') return call ? { trade: call, side: 'call' } : null;
  if (side === 'put') return put ? { trade: put, side: 'put' } : null;
  if (call && (!put || call.entryIdx <= put.entryIdx)) return { trade: call, side: 'call' };
  return put ? { trade: put, side: 'put' } : null;
}

function summarize(trades: OptTrade[]) {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  return {
    n,
    winRate: n ? wins.length / n : 0,
    net,
    avg: n ? net / n : 0,
    avgWin: wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0,
  };
}

const fmtS = (x: ReturnType<typeof summarize>) =>
  `${x.n} trades, win ${(x.winRate * 100).toFixed(0)}%, net $${x.net.toFixed(0)}, avg $${x.avg.toFixed(0)} (win $${x.avgWin.toFixed(0)} / loss $${x.avgLoss.toFixed(0)})`;

const cfgName = (c: Cfg) => `${c.setup} stop ${c.stopAtr}ATR target ${c.targetR}R filter ${c.filter} vol ${c.vol ? 'on' : 'off'} time ${c.timeBars}`;
const exitName = (e: Exit) => (e.kind === 'underlying' ? 'exit on SPY stop/target' : `exit +${e.tp * 100}% / -${e.sl * 100}% premium`);
const strikeName = (k: number) => (k === 0 ? 'ATM' : k > 0 ? `${k} OTM` : `${-k} ITM`);

async function main() {
  const days = await loadSweepDays(START, END, CACHE);
  const mirrored = days.map(mirrorDay);
  const iv = ivByDate(days);
  const isTrain = (d: string) => d <= TRAIN_END;
  const ivs = [...iv.values()];
  console.log(`sessions ${days.length}; IV used ${(Math.min(...ivs) * 100).toFixed(0)}%-${(Math.max(...ivs) * 100).toFixed(0)}%`);
  const sample = days[days.length - 1];
  const s0 = sample.bars.find(b => b.m >= 585)!;
  console.log(
    `sample ${sample.date} 9:45 ET SPY ${s0.o.toFixed(2)}: ATM 1DTE call ~$${bs('call', s0.o, Math.round(s0.o), yearsLeft(585), iv.get(sample.date)!).toFixed(2)}, put ~$${bs('put', s0.o, Math.round(s0.o), yearsLeft(585), iv.get(sample.date)!).toFixed(2)} per share`,
  );

  const setups: Setup[] = ['S1', 'RECLAIM', 'VWAP', 'ORB', 'PULLBACK'];
  const stops = [1, 1.5, 2, 3];
  const targets = [0.25, 0.5, 1, 2, 3];
  const filters: Filter[] = ['none', 'ema21up', 'aboveVwap', 'abovePrior', 'gapUp'];
  const sides: Side[] = ['call', 'put', 'both'];
  const strikes = [-2, 0, 2];
  const premiumExits: Exit[] = [];
  for (const tp of [0.1, 0.2, 0.3, 0.5, 1]) for (const sl of [0.15, 0.25, 0.5]) premiumExits.push({ kind: 'premium', tp, sl });

  type Row = { cfg: Cfg; side: Side; strike: number; exit: Exit; tr: ReturnType<typeof summarize>; te: ReturnType<typeof summarize> };

  const evaluate = (cfg: Cfg, signals: Array<Signal | null>, side: Side, strike: number, exit: Exit): Row => {
    const tr: OptTrade[] = [];
    const te: OptTrade[] = [];
    signals.forEach((sig, i) => {
      if (!sig) return;
      const day = days[i];
      const t = priceOption(sig.side === 'put' ? mirrored[i] : day, sig.trade, sig.side, strike, exit, cfg.timeBars, iv.get(day.date)!);
      (isTrain(day.date) ? tr : te).push(t);
    });
    return { cfg, side, strike, exit, tr: summarize(tr), te: summarize(te) };
  };

  const rawCache = new Map<string, { calls: Array<Trade | null>; puts: Array<Trade | null> }>();
  const signalsFor = (cfg: Cfg, side: Side) => {
    const key = cfgName(cfg);
    let raw = rawCache.get(key);
    if (!raw) {
      raw = { calls: days.map(d => runLong(d, cfg)), puts: mirrored.map(d => runLong(d, cfg)) };
      rawCache.set(key, raw);
    }
    return days.map((_, i) => pickSignal(raw!.calls[i], raw!.puts[i], side));
  };

  console.log('\nNAMED STRATEGIES ON 1DTE OPTIONS (exit on SPY stop/target)');
  for (const [name, cfg] of [['VWAP Scalp', VWAP_SCALP], ['Support Runner', SUPPORT_RUNNER]] as const) {
    for (const side of sides) {
      for (const strike of strikes) {
        const r = evaluate(cfg, signalsFor(cfg, side), side, strike, { kind: 'underlying' });
        console.log(`${name} | ${side} ${strikeName(strike)} | TRAIN ${fmtS(r.tr)} | TEST ${fmtS(r.te)}`);
      }
    }
  }

  const stage1: Row[] = [];
  for (const setup of setups)
    for (const stopAtr of stops)
      for (const targetR of targets)
        for (const filter of filters)
          for (const vol of [true, false])
            for (const timeBars of [60, 120]) {
              const cfg: Cfg = { setup, stopAtr, targetR, filter, vol, timeBars };
              for (const side of sides) {
                const sig = signalsFor(cfg, side);
                for (const strike of strikes) stage1.push(evaluate(cfg, sig, side, strike, { kind: 'underlying' }));
              }
            }
  console.log(`\nstage 1 rows: ${stage1.length}`);

  const shortlist = stage1
    .filter(r => r.tr.n >= 25)
    .sort((a, b) => b.tr.avg - a.tr.avg)
    .slice(0, 60);
  const stage2: Row[] = [...stage1];
  const seen = new Set<string>();
  for (const r of shortlist) {
    const key = `${cfgName(r.cfg)}|${r.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sig = signalsFor(r.cfg, r.side);
    for (const strike of strikes) for (const exit of premiumExits) stage2.push(evaluate(r.cfg, sig, r.side, strike, exit));
  }
  const winRateSeed = stage1
    .filter(r => r.tr.n >= 25 && r.tr.avg > 0)
    .sort((a, b) => b.tr.winRate - a.tr.winRate)
    .slice(0, 40);
  for (const r of winRateSeed) {
    const key = `${cfgName(r.cfg)}|${r.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sig = signalsFor(r.cfg, r.side);
    for (const strike of strikes) for (const exit of premiumExits) stage2.push(evaluate(r.cfg, sig, r.side, strike, exit));
  }
  console.log(`stage 2 rows: ${stage2.length}`);

  const line = (r: Row) =>
    `${cfgName(r.cfg)} | ${r.side} ${strikeName(r.strike)} | ${exitName(r.exit)}\n    TRAIN ${fmtS(r.tr)}\n    TEST  ${fmtS(r.te)}`;
  const eligible = stage2.filter(r => r.tr.n >= 25 && r.te.n >= 10);

  console.log('\nTOP 10 BY TRAIN AVG $ PER CONTRACT');
  [...eligible].sort((a, b) => b.tr.avg - a.tr.avg).slice(0, 10).forEach(r => console.log(line(r)));

  console.log('\nTOP 10 BY TRAIN WIN RATE (train avg $ > 0)');
  [...eligible]
    .filter(r => r.tr.avg > 0)
    .sort((a, b) => b.tr.winRate - a.tr.winRate || b.tr.avg - a.tr.avg)
    .slice(0, 10)
    .forEach(r => console.log(line(r)));

  const green = eligible.filter(r => r.tr.avg > 0 && r.te.avg > 0);
  console.log(`\ngreen on both train and test: ${green.length} of ${eligible.length}`);
  const floor = (r: Row) => Math.min(r.tr.avg, r.te.avg);
  console.log('\nMOST ROBUST (ranked by the weaker of train and test avg $)');
  [...green].sort((a, b) => floor(b) - floor(a)).slice(0, 8).forEach(r => console.log(line(r)));
  console.log('\nMOST ROBUST PUT-ONLY');
  [...green].filter(r => r.side === 'put').sort((a, b) => floor(b) - floor(a)).slice(0, 4).forEach(r => console.log(line(r)));
  console.log('\nMOST ROBUST WITH >=85% WIN ON BOTH');
  [...green]
    .filter(r => r.tr.winRate >= 0.85 && r.te.winRate >= 0.85)
    .sort((a, b) => floor(b) - floor(a))
    .slice(0, 5)
    .forEach(r => console.log(line(r)));
}

main();
