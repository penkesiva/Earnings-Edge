import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { earningsSessionDate } from '@/lib/earningsDate';
import { FinalActionBadge } from '@/components/SignalBadge';
import { LogOutcomesButton } from './LogOutcomesButton';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const sb = supabaseAdmin();
  const today = earningsSessionDate();

  const { data: rows } = await sb
    .from('v_brief_outcomes')
    .select('*')
    .lt('earnings_date', today)
    .order('earnings_date', { ascending: false })
    .limit(100);

  // Hit rate: only count non-SKIP rows that have an outcome
  const withOutcomes = rows?.filter(r => r.beat_or_miss && r.final_action !== 'SKIP') ?? [];
  const hits = withOutcomes.filter(r => r.hit === true);
  const hitRate = withOutcomes.length ? (hits.length / withOutcomes.length) * 100 : 0;

  // Pending: past briefs with no outcome yet
  const pending = rows?.filter(r => !r.beat_or_miss).length ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            <span className="text-fg-subtle">›</span> HISTORY
          </h1>
          <p className="text-sm text-fg-subtle">
            {rows?.length ?? 0} past briefs · {withOutcomes.length} with outcomes ·{' '}
            <span className={hitRate >= 55 ? 'text-signal-buy' : hitRate >= 40 ? 'text-signal-watch' : 'text-signal-sell'}>
              {hitRate.toFixed(0)}% hit rate
            </span>
            {pending > 0 && (
              <span className="ml-2 text-fg-dim">· {pending} pending outcomes</span>
            )}
          </p>
        </div>
        <LogOutcomesButton pendingCount={pending} />
      </div>

      <div className="border border-border">
        {/* Desktop */}
        <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
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

        {rows?.map((r, i) => (
          <Link
            key={i}
            href={`/briefs/${r.brief_id}`}
            className="grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle hover:bg-bg-elevated transition-colors"
          >
            <div className="col-span-1 text-fg-muted text-xs">{r.earnings_date}</div>
            <div className="col-span-1 font-bold">{r.ticker}</div>
            <div className="col-span-1 text-xs">
              <span className={
                r.composite_score >= 65 ? 'text-signal-buy font-bold' :
                r.composite_score >= 40 ? 'text-signal-watch' :
                'text-signal-sell'
              }>{r.composite_score}</span>
            </div>
            <div className="col-span-2">
              <FinalActionBadge action={r.final_action ?? null} />
            </div>
            <div className="col-span-1 text-xs text-fg-muted">
              ±{r.expected_move_pct?.toFixed(1)}%
            </div>
            <div className="col-span-1 text-xs">
              {r.beat_or_miss ? (
                <span className={r.beat_or_miss === 'BEAT' ? 'text-signal-buy' : 'text-signal-sell'}>
                  {r.beat_or_miss}
                </span>
              ) : <span className="text-fg-dim">—</span>}
              {r.surprise_pct != null && (
                <span className="text-fg-dim ml-1 text-[10px]">
                  ({r.surprise_pct > 0 ? '+' : ''}{r.surprise_pct.toFixed(1)}%)
                </span>
              )}
            </div>
            <div className="col-span-2 text-xs">
              {r.next_day_close_pct != null ? (
                <span className={r.next_day_close_pct > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                  {r.next_day_close_pct > 0 ? '+' : ''}{r.next_day_close_pct.toFixed(2)}%
                </span>
              ) : <span className="text-fg-dim">—</span>}
            </div>
            <div className="col-span-2 text-xs">
              {r.trade_pnl != null ? (
                <span className={r.trade_pnl > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                  ${r.trade_pnl.toFixed(2)}
                </span>
              ) : <span className="text-fg-dim">—</span>}
            </div>
            <div className="col-span-1 text-sm">
              {r.final_action === 'SKIP' || r.hit === null || r.hit === undefined
                ? <span className="text-fg-dim text-xs">—</span>
                : r.hit
                  ? <span className="text-signal-buy font-bold">✓</span>
                  : <span className="text-signal-sell font-bold">✗</span>}
            </div>
          </Link>
        ))}

        {!rows?.length && (
          <div className="px-4 py-8 text-center text-fg-subtle text-sm">
            No history yet — briefs appear here after their earnings date passes.
          </div>
        )}
      </div>
    </div>
  );
}
