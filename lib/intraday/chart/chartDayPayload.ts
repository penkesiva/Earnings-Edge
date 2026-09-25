import type { BacktestTrade, MinuteBar } from '@/lib/intraday/types';
import { barEtHHMM } from '@/lib/intraday/indicators/engine';

export type ChartBarPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type ChartLinePoint = { time: number; value: number };

export type ChartMarkerPoint = {
  time: number;
  kind: 'entry' | 'exit';
  price: number;
  text: string;
};

export function barUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function findBarByEt(bars: MinuteBar[], hhmm: string): MinuteBar | null {
  for (const b of bars) {
    if (barEtHHMM(b.t) === hhmm) return b;
  }
  return null;
}

export function toCandlePoints(bars: MinuteBar[]): ChartBarPoint[] {
  return bars.map(b => ({
    time: barUnixSeconds(b.t),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
  }));
}

export function toLinePoints(bars: MinuteBar[], values: number[]): ChartLinePoint[] {
  const out: ChartLinePoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    out.push({ time: barUnixSeconds(bars[i].t), value: v });
  }
  return out;
}

export function markersForSessionTrades(
  sessionDate: string,
  bars: MinuteBar[],
  trades: BacktestTrade[],
): ChartMarkerPoint[] {
  const markers: ChartMarkerPoint[] = [];
  for (const t of trades) {
    if (t.sessionDate !== sessionDate) continue;
    const entryBar = findBarByEt(bars, t.entryTimeEt);
    const exitBar = findBarByEt(bars, t.exitTimeEt);
    const pnl = t.pnlUsd;
    if (entryBar) {
      markers.push({
        time: barUnixSeconds(entryBar.t),
        kind: 'entry',
        price: t.entryPrice,
        text: `E ${t.setupType}`,
      });
    }
    if (exitBar) {
      const exitTag = t.exitReason ? ` · ${t.exitReason}` : '';
      markers.push({
        time: barUnixSeconds(exitBar.t),
        kind: 'exit',
        price: t.exitPrice,
        text: `X $${pnl.toFixed(0)}${exitTag}`,
      });
    }
  }
  return markers.sort((a, b) => a.time - b.time);
}

export function uniqueTradeSessionDates(trades: BacktestTrade[]): string[] {
  return [...new Set(trades.map(t => t.sessionDate))].sort();
}
