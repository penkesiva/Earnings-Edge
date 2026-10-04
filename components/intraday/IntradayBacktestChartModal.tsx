'use client';

import {
  loadIntradayBacktestChartDayAction,
  type IntradayChartDayPayload,
} from '@/lib/intradayPageActions';
import {
  uniqueTradeSessionDates,
  type ChartLineSeries,
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

const OVERLAY_GROUPS: { id: string; label: string }[] = [
  { id: 'stops', label: 'Stop / trail' },
  { id: 'atr', label: 'ATR' },
  { id: 'atrBands', label: 'ATR stop range' },
  { id: 'exitLevels', label: 'Exit levels' },
  { id: 'slope', label: 'EMA slopes' },
];
const DEFAULT_OVERLAYS = ['stops', 'atr'];
const OVERLAY_STORAGE_KEY = 'intraday-chart-overlays-v1';

function loadOverlays(): Set<string> {
  try {
    const raw = window.localStorage.getItem(OVERLAY_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set(DEFAULT_OVERLAYS);
}

const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };

type DrawnLine = { line: ChartLineSeries; series: ISeriesApi<'Line'> };
type HoverRow = { label: string; color: string; value: string };
type Hover = { time: string; ohlc: string; rows: HoverRow[] };

function lineVisible(line: ChartLineSeries, on: Set<string>): boolean {
  return !line.group || on.has(line.group);
}

/** Stack the price pane above the visible indicator panes. */
function applyPaneLayout(chart: IChartApi, drawn: DrawnLine[], on: Set<string>) {
  const hasPane = (pane: string) => drawn.some(d => d.line.pane === pane && lineVisible(d.line, on));
  const showAtr = hasPane('atr');
  const showSlope = hasPane('slope');
  const lower = (showAtr ? 1 : 0) + (showSlope ? 1 : 0);
  chart.priceScale('right').applyOptions({
    scaleMargins: { top: 0.05, bottom: lower === 0 ? 0.05 : lower === 1 ? 0.26 : 0.42 },
  });
  if (drawn.some(d => d.line.pane === 'atr')) {
    chart.priceScale('atr').applyOptions({
      scaleMargins: showSlope ? { top: 0.6, bottom: 0.22 } : { top: 0.77, bottom: 0.02 },
    });
  }
  if (drawn.some(d => d.line.pane === 'slope')) {
    chart.priceScale('slope').applyOptions({
      scaleMargins: showAtr ? { top: 0.8, bottom: 0.02 } : { top: 0.77, bottom: 0.02 },
    });
  }
}

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
  const drawnRef = useRef<DrawnLine[]>([]);
  const [overlays, setOverlays] = useState<Set<string>>(() => new Set(DEFAULT_OVERLAYS));
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    setOverlays(loadOverlays());
  }, []);

  const toggleOverlay = (id: string) => {
    setOverlays(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

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

    const drawn: DrawnLine[] = [];
    let zeroLineDone = false;
    for (const line of payload.lines) {
      const pane = line.pane ?? 'price';
      const s = chart.addLineSeries({
        color: line.color,
        lineWidth: line.width ?? 2,
        lineStyle: LINE_STYLE[line.style ?? 'solid'],
        priceScaleId: pane === 'price' ? 'right' : pane,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: pane !== 'price' || !line.group,
        visible: lineVisible(line, overlaysRef.current),
      });
      s.setData(line.points as LineData<Time>[]);
      if (pane === 'slope' && !zeroLineDone) {
        s.createPriceLine({
          price: 0,
          color: '#52525b',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: false,
          title: '',
        });
        zeroLineDone = true;
      }
      drawn.push({ line, series: s });
    }
    drawnRef.current = drawn;
    applyPaneLayout(chart, drawn, overlaysRef.current);

    chart.subscribeCrosshairMove(param => {
      if (param.time == null) {
        setHover(null);
        return;
      }
      const c = param.seriesData.get(candles) as CandlestickData<Time> | undefined;
      const rows: HoverRow[] = [];
      for (const d of drawnRef.current) {
        if (!lineVisible(d.line, overlaysRef.current)) continue;
        const v = param.seriesData.get(d.series) as LineData<Time> | undefined;
        if (!v || !Number.isFinite(v.value)) continue;
        rows.push({ label: d.line.label, color: d.line.color, value: v.value.toFixed(d.line.precision ?? 2) });
      }
      setHover({
        time: `${formatPtClock(param.time)} PT`,
        ohlc: c ? `O ${c.open.toFixed(2)} H ${c.high.toFixed(2)} L ${c.low.toFixed(2)} C ${c.close.toFixed(2)}` : '',
        rows,
      });
    });

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
      drawnRef.current = [];
      setHover(null);
    };
  }, [open, payload]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const d of drawnRef.current) d.series.applyOptions({ visible: lineVisible(d.line, overlays) });
    applyPaneLayout(chart, drawnRef.current, overlays);
  }, [overlays, payload]);

  if (!open) return null;

  const dayTrades = trades.filter(t => t.sessionDate === sessionDate);
  const availableGroups = OVERLAY_GROUPS.filter(g => payload?.lines.some(l => l.group === g.id));

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
            {payload?.barLabel ?? 'RTH'} ·{' '}
            {payload?.lines
              .filter(l => !l.group)
              .map(l => l.label)
              .join(' / ')}
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

      {availableGroups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2 shrink-0">
          <span className="text-[10px] font-bold tracking-widest text-fg-dim mr-1">OVERLAYS</span>
          {availableGroups.map(g => {
            const on = overlays.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleOverlay(g.id)}
                className={`h-7 px-2.5 border text-[11px] font-bold transition-colors ${
                  on
                    ? 'border-accent bg-accent-muted text-accent'
                    : 'border-border text-fg-dim hover:bg-bg-hover'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="relative flex-1 min-h-[240px] w-full">
        <div ref={containerRef} className="absolute inset-0" />
        {hover ? (
          <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[22rem] border border-border bg-bg/85 px-2 py-1.5 text-[10px] font-mono leading-tight backdrop-blur-sm">
            <p className="font-bold text-fg">
              {hover.time} <span className="font-normal text-fg-subtle">{hover.ohlc}</span>
            </p>
            {hover.rows.map(r => (
              <p key={r.label} className="flex justify-between gap-3">
                <span style={{ color: r.color }}>{r.label}</span>
                <span className="text-fg">{r.value}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

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
