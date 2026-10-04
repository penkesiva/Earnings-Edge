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

export type ChartPane = 'price' | 'atr' | 'slope';

export type ChartLineSeries = {
  label: string;
  color: string;
  points: ChartLinePoint[];
  /** Defaults to 'price' (drawn over the candles). Other panes get their own scale below. */
  pane?: ChartPane;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: 1 | 2;
  /** Overlay toggle group; lines without a group are always shown. */
  group?: string;
  /** Legend decimals. */
  precision?: number;
};

export type ChartMarkerPoint = {
  time: number;
  kind: 'entry' | 'exit';
  price: number;
  text: string;
  /** Pairs an entry with its exit (index in the session's trade list). */
  tradeIndex: number;
  pnlUsd: number;
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
  findBar: (bars: MinuteBar[], hhmm: string) => MinuteBar | null = findBarByEt,
): ChartMarkerPoint[] {
  const markers: ChartMarkerPoint[] = [];
  const dayTrades = trades.filter(t => t.sessionDate === sessionDate);
  dayTrades.forEach((t, tradeIndex) => {
    const entryBar = findBar(bars, t.entryTimeEt);
    const exitBar = findBar(bars, t.exitTimeEt);
    const pnl = t.pnlUsd;
    if (entryBar) {
      markers.push({
        time: barUnixSeconds(entryBar.t),
        kind: 'entry',
        price: t.entryPrice,
        text: `BUY ${t.entryPrice.toFixed(2)}`,
        tradeIndex,
        pnlUsd: pnl,
      });
    }
    if (exitBar) {
      const sign = pnl >= 0 ? '+' : '-';
      const exitTag = t.exitReason ? ` · ${t.exitReason}` : '';
      markers.push({
        time: barUnixSeconds(exitBar.t),
        kind: 'exit',
        price: t.exitPrice,
        text: `SELL ${t.exitPrice.toFixed(2)} ${sign}$${Math.abs(pnl).toFixed(0)}${exitTag}`,
        tradeIndex,
        pnlUsd: pnl,
      });
    }
  });
  return markers.sort((a, b) => a.time - b.time);
}

export function uniqueTradeSessionDates(trades: BacktestTrade[]): string[] {
  return [...new Set(trades.map(t => t.sessionDate))].sort();
}
