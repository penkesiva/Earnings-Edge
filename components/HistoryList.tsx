import Link from 'next/link';
import { formatDayHeader } from '@/lib/earningsDate';
import { isScorableStructure } from '@/lib/historyStats';
import { FinalActionBadge } from '@/components/SignalBadge';

export type HistoryRow = {
  brief_id: string;
  earnings_date: string;
  ticker: string;
  composite_score: number;
  final_action: string | null;
  expected_move_pct: number | null;
  beat_or_miss: string | null;
  surprise_pct: number | null;
  next_day_close_pct: number | null;
  trade_pnl: number | null;
  hit: boolean | null;
};

function ScoreCell({ value }: { value: number }) {
  const color =
    value >= 65 ? 'text-signal-buy font-bold' :
    value >= 40 ? 'text-signal-watch' :
    'text-signal-sell';
  return <span className={`tabular-nums ${color}`}>{value}</span>;
}

function HitCell({
  finalAction,
  hit,
  beatOrMiss,
  nextDayClosePct,
}: {
  finalAction: string | null;
  hit: boolean | null | undefined;
  beatOrMiss?: string | null;
  nextDayClosePct?: number | null;
}) {
  if (!isScorableStructure(finalAction)) {
    return <span className="text-fg-dim text-xs">—</span>;
  }
  if (hit === true) {
    return <span className="text-signal-buy font-bold">✓ HIT</span>;
  }
  if (hit === false) {
    return <span className="text-signal-sell font-bold">✗ MISS</span>;
  }
  if (beatOrMiss && nextDayClosePct == null) {
    return <span className="text-signal-watch text-[10px] tracking-wide">PENDING</span>;
  }
  return <span className="text-fg-dim text-xs">—</span>;
}

function HistoryMobileCard({ r }: { r: HistoryRow }) {
  return (
    <Link
      href={`/briefs/${r.brief_id}?from=history`}
      className="block border border-border bg-bg-elevated p-3 active:opacity-75 touch-manipulation"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[10px] text-fg-dim tracking-widest">{formatDayHeader(r.earnings_date)}</p>
          <p className="font-bold text-lg tracking-tight">{r.ticker}</p>
        </div>
        <ScoreCell value={r.composite_score} />
      </div>

      {r.final_action ? (
        <div className="mb-2 w-full [&_span]:block [&_span]:w-full [&_span]:text-center">
          <FinalActionBadge action={r.final_action} />
        </div>
      ) : (
        <p className="mb-2 text-xs text-fg-dim">—</p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-dim">
        {r.expected_move_pct != null && (
          <span>
            EXP{' '}
            <span className="text-fg-muted font-mono">±{r.expected_move_pct.toFixed(1)}%</span>
          </span>
        )}
        <span>
          EPS{' '}
          {r.beat_or_miss ? (
            <span className={r.beat_or_miss === 'BEAT' ? 'text-signal-buy' : 'text-signal-sell'}>
              {r.beat_or_miss}
              {r.surprise_pct != null &&
                ` (${r.surprise_pct > 0 ? '+' : ''}${r.surprise_pct.toFixed(1)}%)`}
            </span>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </span>
        {r.next_day_close_pct != null && (
          <span>
            DAY{' '}
            <span
              className={`font-mono ${
                r.next_day_close_pct > 0 ? 'text-signal-buy' : 'text-signal-sell'
              }`}
            >
              {r.next_day_close_pct > 0 ? '+' : ''}
              {r.next_day_close_pct.toFixed(2)}%
            </span>
          </span>
        )}
        {r.trade_pnl != null && (
          <span>
            P&L{' '}
            <span className={`font-mono ${r.trade_pnl > 0 ? 'text-signal-buy' : 'text-signal-sell'}`}>
              ${r.trade_pnl.toFixed(2)}
            </span>
          </span>
        )}
        <span>
          <HitCell
            finalAction={r.final_action}
            hit={r.hit}
            beatOrMiss={r.beat_or_miss}
            nextDayClosePct={r.next_day_close_pct}
          />
        </span>
      </div>
    </Link>
  );
}

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  if (!rows.length) {
    return (
      <div className="border border-border bg-bg-elevated px-4 py-8 text-center text-fg-subtle text-sm">
        No history yet — briefs appear here after their earnings date passes.
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden space-y-2">
        {rows.map(r => (
          <HistoryMobileCard key={r.brief_id} r={r} />
        ))}
      </div>

      <div className="hidden md:block border border-border">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
          <div className="col-span-1">DATE</div>
          <div className="col-span-1">TKR</div>
          <div className="col-span-1">SCORE</div>
          <div className="col-span-2">DECISION</div>
          <div className="col-span-1">EXP±</div>
          <div className="col-span-1">EPS</div>
          <div className="col-span-2">NEXT-DAY</div>
          <div className="col-span-2">P&L</div>
          <div className="col-span-1">HIT?</div>
        </div>

        {rows.map(r => (
          <Link
            key={r.brief_id}
            href={`/briefs/${r.brief_id}?from=history`}
            className="terminal-row grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle"
          >
            <div className="col-span-1 text-fg-muted text-xs">{r.earnings_date}</div>
            <div className="col-span-1 font-bold">{r.ticker}</div>
            <div className="col-span-1 text-xs">
              <ScoreCell value={r.composite_score} />
            </div>
            <div className="col-span-2 flex items-center min-w-0">
              {r.final_action ? (
                <FinalActionBadge action={r.final_action} />
              ) : (
                <span className="text-fg-dim text-xs">—</span>
              )}
            </div>
            <div className="col-span-1 text-xs text-fg-muted">
              {r.expected_move_pct != null ? `±${r.expected_move_pct.toFixed(1)}%` : '—'}
            </div>
            <div className="col-span-1 text-xs">
              {r.beat_or_miss ? (
                <span className={r.beat_or_miss === 'BEAT' ? 'text-signal-buy' : 'text-signal-sell'}>
                  {r.beat_or_miss}
                </span>
              ) : (
                <span className="text-fg-dim">—</span>
              )}
              {r.surprise_pct != null && (
                <span className="text-fg-dim ml-1 text-[10px]">
                  ({r.surprise_pct > 0 ? '+' : ''}
                  {r.surprise_pct.toFixed(1)}%)
                </span>
              )}
            </div>
            <div className="col-span-2 text-xs">
              {r.next_day_close_pct != null ? (
                <span className={r.next_day_close_pct > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                  {r.next_day_close_pct > 0 ? '+' : ''}
                  {r.next_day_close_pct.toFixed(2)}%
                </span>
              ) : (
                <span className="text-fg-dim">—</span>
              )}
            </div>
            <div className="col-span-2 text-xs">
              {r.trade_pnl != null ? (
                <span className={r.trade_pnl > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                  ${r.trade_pnl.toFixed(2)}
                </span>
              ) : (
                <span className="text-fg-dim">—</span>
              )}
            </div>
            <div className="col-span-1 text-sm">
              <HitCell
                finalAction={r.final_action}
                hit={r.hit}
                beatOrMiss={r.beat_or_miss}
                nextDayClosePct={r.next_day_close_pct}
              />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
