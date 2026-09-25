import Link from 'next/link';
import { directionTextCls } from '@/lib/predictMarket/enrichForecastRange';
import { formatTargetLabel } from '@/lib/predictMarket/priceTarget/derivePremarketTarget';
import type {
  PredictMarketCalendarCell,
  PredictMarketCalendarMonth,
} from '@/lib/predictMarket/loadSessionCalendarMonth';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function cellClasses(cell: PredictMarketCalendarCell): string {
  const base =
    'min-h-[5rem] p-1.5 border border-border-subtle flex flex-col gap-0.5 transition-colors';
  if (!cell.tradingDay) {
    return `${base} bg-bg-elevated/30 opacity-50`;
  }
  if (!cell.hasSession) {
    return `${base} bg-bg hover:border-fg-dim/30`;
  }
  if (cell.priceTargetHit != null) {
    return cell.priceTargetHit
      ? `${base} bg-signal-buy/10 border-signal-buy/40 hover:border-signal-buy/60`
      : `${base} bg-signal-sell/10 border-signal-sell/40 hover:border-signal-sell/60`;
  }
  if (cell.morningThesisHit === true) {
    return `${base} bg-signal-buy/5 border-signal-buy/25 hover:border-signal-buy/40`;
  }
  if (!cell.graded) {
    return `${base} bg-bg border-signal-watch/30 hover:border-signal-watch/50`;
  }
  return `${base} bg-bg border-border-subtle`;
}

function DayCell({ cell }: { cell: PredictMarketCalendarCell }) {
  const inner = (
    <>
      <span className="text-[10px] text-fg-dim tabular-nums">{cell.dayNum}</span>
      {cell.targetSpx != null && cell.targetSide ? (
        <span className="text-[10px] font-bold leading-tight text-fg-subtle">
          {formatTargetLabel(cell.targetSpx, cell.targetSide)}
        </span>
      ) : cell.premarketPredicted ? (
        <span
          className={`text-[10px] font-bold leading-tight ${directionTextCls(cell.premarketPredicted)}`}
        >
          {cell.premarketPredicted.slice(0, 1)}
        </span>
      ) : null}
      {cell.priceTargetHit != null ? (
        <span
          className={`text-[9px] font-bold tracking-wide ${
            cell.priceTargetHit ? 'text-signal-buy' : 'text-signal-sell'
          }`}
        >
          ${cell.priceTargetHit ? 'HIT' : 'MISS'}
        </span>
      ) : null}
      {cell.morningThesisHit === true ? (
        <span className="text-[8px] text-fg-dim tracking-wide">Dir ✓</span>
      ) : null}
      {cell.graded && cell.actualDirection ? (
        <span className={`text-[9px] ${directionTextCls(cell.actualDirection)} opacity-70`}>
          →{cell.actualDirection.slice(0, 1)}
        </span>
      ) : null}
    </>
  );

  if (cell.hasSession) {
    return (
      <Link
        href={`/predictmarket/sessions/${cell.date}`}
        className={`${cellClasses(cell)} focus:outline-none focus:border-accent`}
        title={cellTitle(cell)}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={cellClasses(cell)} title={cell.tradingDay ? 'No session data' : 'Non-trading day'}>
      {inner}
    </div>
  );
}

function cellTitle(cell: PredictMarketCalendarCell): string {
  const parts = [`${cell.date}`];
  if (cell.targetSpx != null) {
    parts.push(`Target ${cell.targetSpx.toFixed(0)} ${cell.targetSide ?? ''}`);
  }
  if (cell.priceTargetHit != null) {
    parts.push(`$ ${cell.priceTargetHit ? 'HIT' : 'MISS'} (6:30–8:30 AM PT)`);
  }
  if (cell.morningThesisHit != null) {
    parts.push(`Morning thesis ${cell.morningThesisHit ? 'validated' : 'not validated'}`);
  }
  if (cell.premarketPredicted) parts.push(`Premarket: ${cell.premarketPredicted}`);
  if (cell.actualDirection) parts.push(`Close ref: ${cell.actualDirection}`);
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
          <p className="text-[11px] text-fg-dim mt-1 max-w-lg">
            <strong className="text-fg-subtle">$ HIT / MISS</strong> = premarket SPX target touched
            6:30–8:30 AM PT. <strong className="text-fg-subtle">Dir ✓</strong> = entry + 7 AM thesis.
            <strong className="text-fg-subtle"> →R/G</strong> = full-day close (reference).
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
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-[9px] text-center text-fg-dim tracking-widest uppercase">
              {d}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {calendar.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1">
              {week.map((cell, ci) =>
                cell ? (
                  <DayCell key={cell.date} cell={cell} />
                ) : (
                  <div key={`empty-${wi}-${ci}`} className="min-h-[5rem]" aria-hidden />
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-fg-dim">
          <span>
            <span className="inline-block w-3 h-3 border border-signal-buy/50 bg-signal-buy/10 mr-1 align-middle" />
            $ target HIT
          </span>
          <span>
            <span className="inline-block w-3 h-3 border border-signal-sell/50 bg-signal-sell/10 mr-1 align-middle" />
            $ target MISS
          </span>
          <span>
            <span className="font-bold text-fg-subtle">T7580↓</span> = SPX touch target (PUT low /
            CALL high)
          </span>
        </div>
      </div>
    </section>
  );
}
