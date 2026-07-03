import Link from 'next/link';
import { FinalVerdictBadge } from '@/components/FinalVerdictBadge';
import { DirectionIndicator } from '@/components/DirectionIndicator';
import type { TopPickRow } from '@/lib/topEarningsPicks';

function PickList({
  title,
  direction,
  rows,
  emptyHint,
}: {
  title: string;
  direction: 'UP' | 'DOWN';
  rows: TopPickRow[];
  emptyHint: string;
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

export function TopEarningsPicksPanel({
  focusLabel,
  bullish,
  bearish,
}: {
  focusLabel: string;
  bullish: TopPickRow[];
  bearish: TopPickRow[];
}) {
  const total = bullish.length + bearish.length;

  return (
    <section className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold tracking-wide">
            <span className="page-chevron">›</span> PRE-MARKET TOP 10
          </h2>
          <p className="text-xs text-fg-subtle mt-1">
            Your watchlist reporting {focusLabel || 'soon'} — ranked by score, scream, consensus
          </p>
        </div>
        {total > 0 ? (
          <p className="text-[10px] text-fg-dim tracking-widest uppercase shrink-0">
            Analyze only · no auto-trade
          </p>
        ) : null}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <PickList
          title="Top 10 up"
          direction="UP"
          rows={bullish}
          emptyHint="No bullish picks yet — run Scan All on upcoming briefs."
        />
        <PickList
          title="Top 10 down"
          direction="DOWN"
          rows={bearish}
          emptyHint="No bearish picks yet — run Scan All on upcoming briefs."
        />
      </div>
    </section>
  );
}
