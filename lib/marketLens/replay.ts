/**
 * Closed-bar SPY replay. A signal on this bar can fill only on the next bar's open.
 * If stop and target are both inside one bar, the stop is taken.
 */

import { macroEventOn } from '@/lib/marketLens/events';
import { etStamp } from '@/lib/marketLens/sessionTime';
import type { ClosedTrade, DayReplay, RejectReason, SetupId, Side, TradeExit } from '@/lib/marketLens/types';

export type SpyBar = { t: string; o: number; h: number; l: number; c: number; v: number };

export type PriorSession = { high: number; low: number; close: number };

const OPEN = 9 * 60 + 30;
const OR_END = 9 * 60 + 45;
const ENTRY_LATEST = 15 * 60 + 45;
const FLAT_AT = 15 * 60 + 50;
const FOMC_FLAT = 13 * 60 + 45;
const SLIP = 0.01;
const MIN_RR = 2;
const TIME_STOP_BARS = 60;

type Pending = {
  setup: SetupId;
  side: Side;
  stop: number;
  signalTime: string;
};

type OpenPos = Pending & {
  entry: number;
  target: number;
  entryTime: string;
  barsHeld: number;
  risk: number;
};

function bump(rejects: DayReplay['rejects'], reason: RejectReason) {
  rejects[reason] = (rejects[reason] ?? 0) + 1;
}

function levelsAbove(price: number, vals: Array<number | null>): number | null {
  const above = vals.filter((v): v is number => v != null && v > price + 0.01);
  if (!above.length) return null;
  return Math.min(...above);
}

function levelsBelow(price: number, vals: Array<number | null>): number | null {
  const below = vals.filter((v): v is number => v != null && v < price - 0.01);
  if (!below.length) return null;
  return Math.max(...below);
}

export function replaySession(sessionDate: string, bars: SpyBar[], prior: PriorSession): DayReplay {
  const rth = bars
    .filter(b => {
      const et = etStamp(b.t);
      return et.date === sessionDate && et.minutes >= OPEN && et.minutes < 16 * 60;
    })
    .sort((a, b) => (a.t < b.t ? -1 : 1));

  const rejects: DayReplay['rejects'] = {};
  const trades: ClosedTrade[] = [];
  if (rth.length < 20) {
    return {
      sessionDate,
      priorClose: prior.close,
      priorHigh: prior.high,
      priorLow: prior.low,
      trades,
      rejects,
      status: 'WAIT',
      note: 'Not enough regular-session bars.',
    };
  }

  const event = macroEventOn(sessionDate);
  let orHigh: number | null = null;
  let orLow: number | null = null;
  let orLocked = false;
  let vwapNum = 0;
  let vwapDen = 0;
  let ema: number | null = null;
  let atr: number | null = null;
  let prevClose: number | null = null;
  const volWindow: number[] = [];
  let pending: Pending | null = null;
  let pos: OpenPos | null = null;
  let tookSignal = false;
  let last5Close: number | null = null;
  let fomcNoted = false;
  const bucket: SpyBar[] = [];

  const closeTrade = (bar: SpyBar, exit: number, reason: TradeExit, ambiguous: boolean) => {
    if (!pos) return;
    const signed = pos.side === 'long' ? exit - pos.entry : pos.entry - exit;
    trades.push({
      setup: pos.setup,
      side: pos.side,
      signalTime: pos.signalTime,
      entryTime: pos.entryTime,
      exitTime: bar.t,
      entry: pos.entry,
      stop: pos.stop,
      target: pos.target,
      exit,
      exitReason: reason,
      rMultiple: pos.risk > 0 ? signed / pos.risk : 0,
      ambiguousBar: ambiguous,
    });
    pos = null;
  };

  for (const bar of rth) {
    const et = etStamp(bar.t);
    const typical = (bar.h + bar.l + bar.c) / 3;
    vwapNum += typical * Math.max(bar.v, 0);
    vwapDen += Math.max(bar.v, 0);
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : bar.c;

    const tr =
      prevClose == null
        ? bar.h - bar.l
        : Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
    atr = atr == null ? tr : atr + (tr - atr) / 14;
    ema = ema == null ? bar.c : ema + (2 / 21) * (bar.c - ema);
    volWindow.push(bar.v);
    if (volWindow.length > 20) volWindow.shift();
    const volAvg = volWindow.reduce((s, v) => s + v, 0) / volWindow.length;

    if (!orLocked && et.minutes < OR_END) {
      orHigh = orHigh == null ? bar.h : Math.max(orHigh, bar.h);
      orLow = orLow == null ? bar.l : Math.min(orLow, bar.l);
    }
    if (!orLocked && et.minutes >= OR_END) orLocked = true;

    if (pos) {
      pos.barsHeld += 1;
      const stopHit = pos.side === 'long' ? bar.l <= pos.stop : bar.h >= pos.stop;
      const targetHit = pos.side === 'long' ? bar.h >= pos.target : bar.l <= pos.target;
      if (stopHit && targetHit) closeTrade(bar, pos.stop, 'stop', true);
      else if (stopHit) closeTrade(bar, pos.stop, 'stop', false);
      else if (targetHit) closeTrade(bar, pos.target, 'target', false);
      else if (event?.kind === 'fomc' && et.minutes >= FOMC_FLAT) closeTrade(bar, bar.c, 'fomc_flat', false);
      else if (et.minutes >= FLAT_AT) closeTrade(bar, bar.c, 'session_end', false);
      else if (pos.barsHeld >= TIME_STOP_BARS) closeTrade(bar, bar.c, 'time', false);
    }

    if (pending && !pos && !tookSignal) {
      const entry = pending.side === 'long' ? bar.o + SLIP : bar.o - SLIP;
      const risk = Math.abs(entry - pending.stop);
      const room =
        pending.side === 'long'
          ? levelsAbove(entry, [prior.high, orHigh])
          : levelsBelow(entry, [prior.low, orLow]);
      const target = pending.side === 'long' ? entry + MIN_RR * risk : entry - MIN_RR * risk;
      const wrongWay = pending.side === 'long' ? entry <= pending.stop : entry >= pending.stop;
      const noRoom = room != null && (pending.side === 'long' ? room < target : room > target);
      if (wrongWay) bump(rejects, 'adverse_gap');
      else if (!(risk > 0.02) || noRoom) bump(rejects, 'no_room');
      else {
        pos = { ...pending, entry, target, entryTime: bar.t, barsHeld: 0, risk };
        tookSignal = true;
        const stopHit = pos.side === 'long' ? bar.l <= pos.stop : bar.h >= pos.stop;
        const targetHit = pos.side === 'long' ? bar.h >= pos.target : bar.l <= pos.target;
        if (stopHit) closeTrade(bar, pos.stop, 'stop', targetHit);
        else if (targetHit) closeTrade(bar, pos.target, 'target', false);
      }
      pending = null;
    }

    bucket.push(bar);
    if (bucket.length > 5) bucket.shift();
    const fiveClosed = bucket.length === 5 && (et.minutes - OPEN) % 5 === 4;

    const earliest = event?.kind === 'morning_print' ? 10 * 60 : OR_END;
    const fomcBlocked = event?.kind === 'fomc' && et.minutes >= FOMC_FLAT;
    const canEnter =
      !pos &&
      !pending &&
      !tookSignal &&
      orLocked &&
      atr != null &&
      atr > 0 &&
      et.minutes >= earliest &&
      et.minutes <= ENTRY_LATEST &&
      !fomcBlocked;

    if (fomcBlocked && !pos && !tookSignal && orLocked && !fomcNoted) {
      bump(rejects, 'event_window');
      fomcNoted = true;
    }

    if (canEnter && atr != null) {
      const zone = Math.max(0.05, atr * 0.25);
      const supports = [prior.low, orLow].filter((v): v is number => v != null);
      const resistances = [prior.high, orHigh].filter((v): v is number => v != null);
      const support = supports.find(level => bar.l <= level + zone && bar.c > level && bar.c > bar.o);
      const resistance = resistances.find(level => bar.h >= level - zone && bar.c < level && bar.c < bar.o);
      let vwapSide: Pending | null = null;
      if (!support && !resistance && fiveClosed && last5Close != null && ema != null) {
        const fiveLow = Math.min(...bucket.map(b => b.l));
        const fiveHigh = Math.max(...bucket.map(b => b.h));
        if (last5Close < vwap && bar.c > vwap && bar.c > ema && fiveLow <= vwap + zone) {
          vwapSide = {
            setup: 'S3_VWAP_RECLAIM',
            side: 'long',
            stop: fiveLow - atr,
            signalTime: bar.t,
          };
        } else if (last5Close > vwap && bar.c < vwap && bar.c < ema && fiveHigh >= vwap - zone) {
          vwapSide = {
            setup: 'S3_VWAP_REJECT',
            side: 'short',
            stop: fiveHigh + atr,
            signalTime: bar.t,
          };
        }
      }
      const touched = support != null || resistance != null || vwapSide != null;
      if (touched && bar.v < volAvg) bump(rejects, 'weak_volume');
      else if (support != null) {
        pending = {
          setup: 'S1_SUPPORT_BOUNCE',
          side: 'long',
          stop: Math.min(bar.l, support) - atr,
          signalTime: bar.t,
        };
      } else if (resistance != null) {
        pending = {
          setup: 'S2_RESISTANCE_REJECT',
          side: 'short',
          stop: Math.max(bar.h, resistance) + atr,
          signalTime: bar.t,
        };
      } else if (vwapSide) pending = vwapSide;
    }

    if (fiveClosed) last5Close = bar.c;
    prevClose = bar.c;
  }

  if (pos) {
    const last = rth[rth.length - 1];
    closeTrade(last, last.c, 'session_end', false);
  }

  const note = trades.length
    ? `${trades.length} paper trade. Probability is not claimed.`
    : 'No setup cleared the gates. WAIT is a result.';

  return {
    sessionDate,
    priorClose: prior.close,
    priorHigh: prior.high,
    priorLow: prior.low,
    trades,
    rejects,
    status: trades.length ? 'SIGNAL' : 'NO_TRADE',
    note,
  };
}

/** Tiny path so a broken fill rule fails before any Alpaca call. */
export function assertReplaySmoke(): void {
  const prior = { high: 110, low: 99, close: 100 };
  const bars: SpyBar[] = [];
  const start = Date.parse('2026-10-16T13:30:00Z');
  for (let i = 0; i < 40; i++) {
    const t = new Date(start + i * 60_000).toISOString();
    const base = { t, o: 100.2, h: 100.35, l: 100.1, c: 100.2, v: 1000 };
    if (i === 0) bars.push({ ...base, h: 103 });
    else if (i === 20) bars.push({ t, o: 100.15, h: 100.25, l: 100.02, c: 100.22, v: 8000 });
    else if (i > 21) bars.push({ t, o: 100.3, h: 101.2, l: 100.25, c: 101, v: 1000 });
    else bars.push(base);
  }
  const day = replaySession('2026-10-16', bars, prior);
  if (day.trades.length !== 1 || day.trades[0].setup !== 'S1_SUPPORT_BOUNCE') {
    throw new Error(`MarketLens smoke failed: ${day.trades.length} trades`);
  }
  if (!(day.trades[0].rMultiple > 0)) {
    throw new Error(`MarketLens smoke lost R: ${day.trades[0].rMultiple}`);
  }
}
