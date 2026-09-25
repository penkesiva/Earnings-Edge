import type { ReactNode } from 'react';
import Link from 'next/link';
import { directionTextCls } from '@/lib/predictMarket/enrichForecastRange';
import { formatTargetLabel } from '@/lib/predictMarket/priceTarget/derivePremarketTarget';
import type {
  PredictMarketCalendarCell,
  PredictMarketCalendarMonth,
} from '@/lib/predictMarket/loadSessionCalendarMonth';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function cellShell(cell: PredictMarketCalendarCell): string {
  const base =
    'min-h-[6.25rem] p-2 border flex flex-col gap-1.5 transition-colors text-left w-full';
  if (!cell.tradingDay) {
    return `${base} border-transparent bg-bg-elevated/25 opacity-45`;
  }
  if (!cell.hasSession) {
    return `${base} border-border-subtle/80 bg-bg hover:border-fg-dim/40`;
  }
  if (cell.priceTargetHit === true) {
    return `${base} border-signal-buy/45 bg-signal-buy/[0.08] hover:border-signal-buy/70 border-l-[3px] border-l-signal-buy`;
  }
  if (cell.priceTargetHit === false) {
    return `${base} border-signal-sell/45 bg-signal-sell/[0.08] hover:border-signal-sell/70 border-l-[3px] border-l-signal-sell`;
  }
  if (cell.morningThesisHit === true) {
    return `${base} border-signal-buy/25 bg-bg hover:border-signal-buy/40 border-l-[3px] border-l-signal-buy/50`;
  }
  if (!cell.graded) {
    return `${base} border-signal-watch/30 bg-bg-elevated/40 hover:border-signal-watch/50`;
  }
  return `${base} border-border-subtle bg-bg hover:border-fg-dim/30`;
}

function PrimaryBadge({ cell }: { cell: PredictMarketCalendarCell }) {
  if (!cell.hasSession) return null;
  if (cell.priceTargetHit != null) {
    return (
      <span
        className={`text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 border ${
          cell.priceTargetHit
            ? 'border-signal-buy/50 text-signal-buy bg-signal-buy/10'
            : 'border-signal-sell/50 text-signal-sell bg-signal-sell/10'
        }`}
      >
        ${cell.priceTargetHit ? 'Hit' : 'Miss'}
      </span>
    );
  }
  if (cell.morningThesisHit === true) {
    return (
      <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 border border-signal-buy/30 text-signal-buy/90 bg-signal-buy/5">
        Dir ok
      </span>
    );
  }
  if (cell.hasSession && !cell.graded) {
    return (
      <span className="text-[9px] tracking-widest uppercase px-1.5 py-0.5 border border-border-subtle text-fg-dim">
        Live
      </span>
    );
  }
  return null;
}

function MetricRow({
  label,
  children,
  muted,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-1 leading-none ${muted ? 'opacity-60' : ''}`}>
      <span className="text-[8px] uppercase tracking-wider text-fg-dim shrink-0">{label}</span>
      <span className="text-[10px] font-medium tabular-nums text-right truncate">{children}</span>
    </div>
  );
}

function directionPill(direction: string) {
  return (
    <span className={`font-bold ${directionTextCls(direction)}`}>{direction}</span>
  );
}

function DayCell({ cell }: { cell: PredictMarketCalendarCell }) {
  const hasData = cell.hasSession;
  const targetText =
    cell.targetSpx != null && cell.targetSide
      ? formatTargetLabel(cell.targetSpx, cell.targetSide)
      : null;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-1">
        <span
          className={`text-xs font-bold tabular-nums ${hasData ? 'text-fg' : 'text-fg-dim'}`}
        >
          {cell.dayNum}
        </span>
        {hasData ? <PrimaryBadge cell={cell} /> : null}
      </div>

      {hasData ? (
        <div className="space-y-1 mt-auto">
          <MetricRow label="6am">
            {cell.premarketPredicted ? directionPill(cell.premarketPredicted) : '—'}
          </MetricRow>
          <MetricRow label="Target">
            {targetText ? (
              <span className="font-mono text-[9px] text-fg-subtle">{targetText}</span>
            ) : (
              <span className="text-fg-dim text-[9px]">Pending</span>
            )}
          </MetricRow>
          <MetricRow label="Morning">
            {cell.morningThesisHit === true ? (
              <span className="text-signal-buy font-bold">✓</span>
            ) : cell.morningThesisHit === false ? (
              <span className="text-signal-sell">✗</span>
            ) : (
              <span className="text-fg-dim">—</span>
            )}
          </MetricRow>
          <MetricRow label="Close" muted>
            {cell.graded && cell.actualDirection ? (
              directionPill(cell.actualDirection)
            ) : (
              <span className="text-fg-dim">—</span>
            )}
          </MetricRow>
        </div>
      ) : null}
    </>
  );

  const title = hasData ? cellTitle(cell) : cell.tradingDay ? 'No session' : 'Weekend';

  if (hasData) {
    return (
      <Link
        href={`/predictmarket/sessions/${cell.date}`}
        className={`${cellShell(cell)} focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
        title={title}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={cellShell(cell)} title={title}>
      {inner}
    </div>
  );
}

function cellTitle(cell: PredictMarketCalendarCell): string {
  const parts = [`${cell.date}`];
  if (cell.premarketPredicted) parts.push(`Premarket ${cell.premarketPredicted}`);
  if (cell.targetSpx != null) {
    parts.push(`Target ${cell.targetSpx.toFixed(0)} ${cell.targetSide ?? ''}`);
  }
  if (cell.priceTargetHit != null) {
    parts.push(`Price ${cell.priceTargetHit ? 'HIT' : 'MISS'} (6:30–8:30 AM PT)`);
  }
  if (cell.morningThesisHit != null) {
    parts.push(`Morning thesis ${cell.morningThesisHit ? 'ok' : 'failed'}`);
  }
  if (cell.actualDirection) parts.push(`Close ${cell.actualDirection}`);
  return parts.join(' · ');
}

export function PredictMarketAccuracyCalendar({ calendar }: { calendar: PredictMarketCalendarMonth }) {
  return (
    <section className="border border-border">
      <div className="px-4 py-3 border-b border-border-subtle flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> Accuracy calendar
          </h3>
          <p className="text-[11px] text-fg-dim mt-1 max-w-xl">
            Each trading day shows premarket direction, SPX target ($ Hit/Miss when scored), morning
            thesis, and close reference. Click a day for the full timeline.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs shrink-0">
          <Link
            href={`/predictmarket?month=${calendar.prevMonth}`}
            className="px-2 py-1 border border-border-subtle hover:border-fg-dim"
          >
            ←
          </Link>
          <span className="font-bold tracking-wide min-w-[8rem] text-center">{calendar.monthLabel}</span>
          <Link
            href={`/predictmarket?month=${calendar.nextMonth}`}
            className="px-2 py-1 border border-border-subtle hover:border-fg-dim"
          >
            →
          </Link>
        </div>
      </div>

      <div className="px-2 py-3 sm:px-4">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-[9px] text-center text-fg-dim tracking-widest uppercase">
              {d}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {calendar.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map((cell, ci) =>
                cell ? (
                  <DayCell key={cell.date} cell={cell} />
                ) : (
                  <div key={`empty-${wi}-${ci}`} className="min-h-[6.25rem]" aria-hidden />
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-[10px] text-fg-dim border-t border-border-subtle pt-3">
          <span>
            <span className="inline-block w-1 h-3 bg-signal-buy/70 mr-1.5 align-middle" />
            $ price target hit
          </span>
          <span>
            <span className="inline-block w-1 h-3 bg-signal-sell/70 mr-1.5 align-middle" />
            $ price target miss
          </span>
          <span>
            <span className="text-fg-subtle">6am</span> = premarket ·{' '}
            <span className="text-fg-subtle">Close</span> = full session (reference)
          </span>
        </div>
      </div>
    </section>
  );
}
