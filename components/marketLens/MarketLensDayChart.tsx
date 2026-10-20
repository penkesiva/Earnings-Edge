'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  TickMarkType,
  type CandlestickData,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { CandlePoint } from '@/lib/marketLens/replay';
import type { ClosedTrade } from '@/lib/marketLens/types';

const PT = 'America/Los_Angeles';
const ptClock = new Intl.DateTimeFormat('en-US', {
  timeZone: PT,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function clock(time: Time): string {
  return typeof time === 'number' ? ptClock.format(new Date(time * 1000)) : String(time);
}

function unix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function MarketLensDayChart({
  sessionDate,
  candles,
  trade,
}: {
  sessionDate: string;
  candles: CandlePoint[];
  trade: ClosedTrade | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || candles.length === 0) return;

    const chart: IChartApi = createChart(el, {
      layout: { background: { color: '#18181b' }, textColor: '#b4b4be' },
      grid: { vertLines: { color: '#303036' }, horzLines: { color: '#303036' } },
      rightPriceScale: { borderColor: '#3a3a40' },
      timeScale: {
        borderColor: '#3a3a40',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds ? clock(time) : String(time),
      },
      localization: { timeFormatter: (time: Time) => `${clock(time)} PT` },
      width: el.clientWidth,
      height: 360,
    });

    const series = chart.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#f87171',
      borderUpColor: '#4ade80',
      borderDownColor: '#f87171',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });
    series.setData(candles as CandlestickData<Time>[]);

    if (trade) {
      const snap = (iso: string) => {
        const target = unix(iso);
        return candles.reduce((best, c) =>
          Math.abs(c.time - target) < Math.abs(best - target) ? c.time : best,
        candles[0].time);
      };
      const buy = trade.side === 'long';
      const markers: SeriesMarker<Time>[] = [
        {
          time: snap(trade.entryTime) as Time,
          position: buy ? 'belowBar' : 'aboveBar',
          color: '#38bdf8',
          shape: buy ? 'arrowUp' : 'arrowDown',
          text: `${buy ? 'Buy' : 'Short'} ${trade.entry.toFixed(2)}`,
        },
        {
          time: snap(trade.exitTime) as Time,
          position: buy ? 'aboveBar' : 'belowBar',
          color: trade.rMultiple >= 0 ? '#22c55e' : '#ef4444',
          shape: buy ? 'arrowDown' : 'arrowUp',
          text: `${buy ? 'Sell' : 'Cover'} ${trade.exit.toFixed(2)}`,
        },
      ];
      series.setMarkers(markers);
      series.createPriceLine({
        price: trade.stop,
        color: '#f87171',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop',
      });
      series.createPriceLine({
        price: trade.target,
        color: '#4ade80',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Target',
      });
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [candles, trade]);

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-fg-dim">SPY {sessionDate} · times in PT</p>
      <div ref={ref} className="h-[360px] w-full" />
    </div>
  );
}
