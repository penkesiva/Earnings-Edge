'use client';

import {
  loadIntradayBacktestChartDayAction,
  type IntradayChartDayPayload,
} from '@/lib/intradayPageActions';
import {
  uniqueTradeSessionDates,
  type ChartMarkerPoint as ChartMarker,
} from '@/lib/intraday/chart/chartDayPayload';
import type { BacktestTrade } from '@/lib/intraday/types';
import {
  createChart,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type CandlestickData,
  type LineData,
} from 'lightweight-charts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CHART_TZ = 'America/Los_Angeles';
const ptClock = new Intl.DateTimeFormat('en-US', {
  timeZone: CHART_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const ptDay = new Intl.DateTimeFormat('en-US', { timeZone: CHART_TZ, month: 'short', day: 'numeric' });

function formatPtClock(time: Time): string {
  return typeof time === 'number' ? ptClock.format(new Date(time * 1000)) : String(time);
}

/** ET and PT switch DST on the same local date, so during RTH they are always 3h apart. */
function etHHMMToPt(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const mins = (h * 60 + m - 180 + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

const BUY_COLOR = '#38bdf8';
const TRADE_WIN = '#22c55e';
const TRADE_LOSS = '#ef4444';

type Props = {
  open: boolean;
  onClose: () => void;
  symbol: string;
  strategyId?: string | null;
  strategyLabel: string;
  trades: BacktestTrade[];
  initialSessionDate?: string;
};

export function IntradayBacktestChartModal({
  open,
  onClose,
  symbol,
  strategyId,
  strategyLabel,
  trades,
  initialSessionDate,
}: Props) {
  const dates = useMemo(() => uniqueTradeSessionDates(trades), [trades]);
  const [dayIndex, setDayIndex] = useState(0);
  const sessionDate = dates[dayIndex] ?? dates[0] ?? '';
  const [payload, setPayload] = useState<IntradayChartDayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!open) return;
    const idx = initialSessionDate ? dates.indexOf(initialSessionDate) : 0;
    setDayIndex(idx >= 0 ? idx : 0);
  }, [open, initialSessionDate, dates]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const fetchDay = useCallback(async () => {
    if (!open || !sessionDate) return;
    setLoading(true);
    setError(null);
    setPayload(null);
    const res = await loadIntradayBacktestChartDayAction(
      symbol,
      sessionDate,
      trades,
      strategyId ?? undefined,
    );
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setPayload(res.data ?? null);
  }, [open, sessionDate, symbol, trades, strategyId]);

  useEffect(() => {
    fetchDay();
  }, [fetchDay]);

  useEffect(() => {
    if (!open || !payload || !containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleRef.current = null;
    }

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { color: '#18181b' },
        textColor: '#b4b4be',
      },
      grid: {
        vertLines: { color: '#303036' },
        horzLines: { color: '#303036' },
      },
      rightPriceScale: { borderColor: '#3a3a40' },
      timeScale: {
        borderColor: '#3a3a40',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) =>
          type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds
            ? formatPtClock(time)
            : typeof time === 'number'
              ? ptDay.format(new Date(time * 1000))
              : String(time),
      },
      localization: {
        timeFormatter: (time: Time) => `${formatPtClock(time)} PT`,
      },
      crosshair: { vertLine: { labelBackgroundColor: '#3a3a40' } },
    });
    chartRef.current = chart;

    const candles = chart.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#f87171',
      borderUpColor: '#4ade80',
      borderDownColor: '#f87171',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });
    candleRef.current = candles;
    candles.setData(payload.candles as CandlestickData<Time>[]);

    for (const line of payload.lines) {
      const s = chart.addLineSeries({
        color: line.color,
        lineWidth: 2,
        title: line.label,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      s.setData(line.points as LineData<Time>[]);
    }

    const byTrade = new Map<number, { entry?: ChartMarker; exit?: ChartMarker }>();
    for (const m of payload.markers) {
      const pair = byTrade.get(m.tradeIndex) ?? {};
      pair[m.kind] = m;
      byTrade.set(m.tradeIndex, pair);
    }
    for (const { entry, exit } of byTrade.values()) {
      if (!entry || !exit || exit.time <= entry.time) continue;
      const seg = chart.addLineSeries({
        color: exit.pnlUsd >= 0 ? TRADE_WIN : TRADE_LOSS,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      seg.setData([
        { time: entry.time as Time, value: entry.price },
        { time: exit.time as Time, value: exit.price },
      ]);
    }

    const seriesMarkers: SeriesMarker<Time>[] = payload.markers.map(m => ({
      time: m.time as Time,
      position: m.kind === 'entry' ? 'belowBar' : 'aboveBar',
      color: m.kind === 'entry' ? BUY_COLOR : m.pnlUsd >= 0 ? TRADE_WIN : TRADE_LOSS,
      shape: m.kind === 'entry' ? 'arrowUp' : 'arrowDown',
      size: 2,
      text: m.text,
    }));
    candles.setMarkers(seriesMarkers);

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  }, [open, payload]);

  if (!open) return null;

  const dayTrades = trades.filter(t => t.sessionDate === sessionDate);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-bg/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Backtest session chart"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-wide truncate">
            {symbol} · {sessionDate || '—'} · {strategyLabel}
          </p>
          <p className="text-[10px] text-fg-dim">
            {payload?.barLabel ?? 'RTH'} · {payload?.lines.map(l => l.label).join(' / ')}
            {payload ? ' · ' : ''}
            {dayTrades.length} simulated trade(s) this session · times in Pacific (PT)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={dayIndex <= 0 || loading}
            onClick={() => setDayIndex(i => Math.max(0, i - 1))}
            className="h-9 px-3 border border-border text-xs font-bold hover:bg-bg-hover disabled:opacity-40"
          >
            ← Prev
          </button>
          <select
            value={sessionDate}
            onChange={e => {
              const i = dates.indexOf(e.target.value);
              if (i >= 0) setDayIndex(i);
            }}
            className="h-9 max-w-[10rem] border border-border bg-bg px-2 text-xs font-mono"
          >
            {dates.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={dayIndex >= dates.length - 1 || loading}
            onClick={() => setDayIndex(i => Math.min(dates.length - 1, i + 1))}
            className="h-9 px-3 border border-border text-xs font-bold hover:bg-bg-hover disabled:opacity-40"
          >
            Next →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 border border-accent text-xs font-bold tracking-widest text-accent hover:bg-accent-muted"
          >
            Close
          </button>
        </div>
      </header>

      {error ? (
        <p className="px-4 py-3 text-sm text-signal-sell border-b border-signal-sell/30">{error}</p>
      ) : null}
      {loading ? (
        <p className="px-4 py-3 text-xs text-fg-dim">Loading Alpaca bars…</p>
      ) : null}

      <div ref={containerRef} className="flex-1 min-h-[240px] w-full" />

      {dayTrades.length > 0 ? (
        <div className="shrink-0 max-h-28 overflow-auto border-t border-border-subtle px-4 py-2 text-[10px] font-mono text-fg-subtle divide-y divide-border-subtle">
          {dayTrades.map((t, i) => (
            <p key={i} className="py-0.5">
              <span style={{ color: BUY_COLOR }} className="font-bold">
                BUY {etHHMMToPt(t.entryTimeEt)} PT @ {t.entryPrice.toFixed(2)}
              </span>
              {' → '}
              <span
                style={{ color: t.pnlUsd >= 0 ? TRADE_WIN : TRADE_LOSS }}
                className="font-bold"
              >
                SELL {etHHMMToPt(t.exitTimeEt)} PT @ {t.exitPrice.toFixed(2)} {t.pnlUsd >= 0 ? '+' : '-'}$
                {Math.abs(t.pnlUsd).toFixed(2)}
              </span>
              {t.exitReason ? ` (${t.exitReason})` : ''}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ExpandChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path
        d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  );
}

export { ExpandChartIcon };
