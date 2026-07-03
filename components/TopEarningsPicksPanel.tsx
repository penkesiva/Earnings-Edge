import Link from 'next/link';
import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import { formatDayHeader } from '@/lib/earningsDate';
import type { TopPickRow } from '@/lib/topEarningsPicks';

function PickList({
  title,
  direction,
  rows,
  emptyHint,
  showEarningsDate,
}: {
  title: string;
  direction: 'UP' | 'DOWN';
  rows: TopPickRow[];
  emptyHint: string;
  showEarningsDate?: boolean;
}) {
  return (
    <div className="border border-border bg-bg-elevated min-h-[12rem] flex flex-col">
      <div
        className={`px-3 py-2.5 border-b border-border-subtle flex items-center gap-2 ${
          direction === 'UP' ? 'bg-signal-buy/5' : 'bg-signal-sell/5'
        }`}
      >
        <DirectionIndicator direction={direction} />
        <h3 className="text-xs font-bold tracking-widest uppercase">{title}</h3>
        <span className="text-[10px] text-fg-dim ml-auto tabular-nums">{rows.length}/10</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-xs text-fg-subtle text-center flex-1 flex items-center justify-center">
          {emptyHint}
        </p>
      ) : (
        <ol className="divide-y divide-border-subtle">
          {rows.map((row, index) => (
            <li key={row.briefId}>
              <Link
                href={`/briefs/${row.briefId}`}
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-bg-hover transition-colors group"
              >
                <span className="text-[10px] text-fg-dim w-5 tabular-nums shrink-0">
                  {index + 1}
                </span>
                <span className="font-bold text-sm w-14 shrink-0 group-hover:text-accent">
                  {row.ticker}
                </span>
                {showEarningsDate ? (
                  <span className="text-[10px] text-fg-dim shrink-0 hidden sm:inline">
                    {formatDayHeader(row.earningsDate)}
                  </span>
                ) : null}
                <span className="text-xs text-fg-dim tabular-nums shrink-0">
                  {Math.round(row.compositeScore)}
                </span>
                {row.verdict ? (
                  <FinalVerdictBadge verdict={row.verdict} direction={row.direction} />
                ) : (
                  <span className="text-[10px] text-fg-dim tracking-widest">NO VERDICT</span>
                )}
                <span className="ml-auto text-[10px] text-fg-dim tabular-nums hidden sm:inline">
                  {row.expectedMovePct != null ? `±${row.expectedMovePct.toFixed(1)}%` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TopPicksPanel({
  heading,
  subheading,
  footnote,
  bullish,
  bearish,
  emptyHintUp,
  emptyHintDown,
  showEarningsDate = false,
}: {
  heading: string;
  subheading: string;
  footnote?: string;
  bullish: TopPickRow[];
  bearish: TopPickRow[];
  emptyHintUp: string;
  emptyHintDown: string;
  showEarningsDate?: boolean;
}) {
  const total = bullish.length + bearish.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> {heading}
          </h2>
          <p className="text-xs text-fg-subtle mt-1">{subheading}</p>
        </div>
        {footnote && total > 0 ? (
          <p className="text-[10px] text-fg-dim tracking-widest uppercase shrink-0">{footnote}</p>
        ) : null}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <PickList
          title="Top 10 up"
          direction="UP"
          rows={bullish}
          emptyHint={emptyHintUp}
          showEarningsDate={showEarningsDate}
        />
        <PickList
          title="Top 10 down"
          direction="DOWN"
          rows={bearish}
          emptyHint={emptyHintDown}
          showEarningsDate={showEarningsDate}
        />
      </div>
    </section>
  );
}

/** Pre-earnings focus window (next 2 trading days). */
export function TopEarningsPicksPanel({
  focusLabel,
  bullish,
  bearish,
}: {
  focusLabel: string;
  bullish: TopPickRow[];
  bearish: TopPickRow[];
}) {
  return (
    <TopPicksPanel
      heading="PRE-MARKET TOP 10"
      subheading={`Your watchlist reporting ${focusLabel || 'soon'} — ranked by score, scream, consensus`}
      footnote="Analyze only · no auto-trade"
      bullish={bullish}
      bearish={bearish}
      emptyHintUp="No bullish picks yet — run Scan All on upcoming briefs."
      emptyHintDown="No bearish picks yet — run Scan All on upcoming briefs."
    />
  );
}

/** Year-round watchlist picks outside the pre-earnings window. */
export function TopYearRoundPicksPanel({
  focusLabel,
  bullish,
  bearish,
}: {
  focusLabel: string;
  bullish: TopPickRow[];
  bearish: TopPickRow[];
}) {
  return (
    <TopPicksPanel
      heading="YEAR-ROUND TOP 10"
      subheading={`Active watchlist · ${focusLabel} — best brief per ticker`}
      footnote="Analyze only · no auto-trade"
      bullish={bullish}
      bearish={bearish}
      emptyHintUp="No year-round bullish picks — add watchlist names and scan briefs beyond this week."
      emptyHintDown="No year-round bearish picks — add watchlist names and scan briefs beyond this week."
      showEarningsDate
    />
  );
}
