import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { SignalBadge } from '@/components/SignalBadge';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const sb = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows } = await sb
    .from('v_brief_outcomes')
    .select('*')
    .lt('earnings_date', today)
    .limit(100);

  // Compute hit rate
  const withOutcomes = rows?.filter(r => r.beat_or_miss) || [];
  const hits = withOutcomes.filter(r => {
    const expectedDirection = r.composite_score >= 65;
    const actualPositive = r.next_day_close_pct > 0;
    return expectedDirection === actualPositive;
  });
  const hitRate = withOutcomes.length ? (hits.length / withOutcomes.length) * 100 : 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">
          <span className="text-fg-subtle">›</span> HISTORY
        </h1>
        <p className="text-sm text-fg-subtle">
          {rows?.length ?? 0} past briefs · {withOutcomes.length} with outcomes · {hitRate.toFixed(0)}% hit rate
        </p>
      </div>

      <div className="border border-border">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
          <div className="col-span-1">DATE</div>
          <div className="col-span-1">TKR</div>
          <div className="col-span-1">SCORE</div>
          <div className="col-span-2">SIGNAL</div>
          <div className="col-span-1">EXP</div>
          <div className="col-span-1">RESULT</div>
          <div className="col-span-2">NEXT-DAY</div>
          <div className="col-span-2">P&L</div>
          <div className="col-span-1">HIT?</div>
        </div>
        {rows?.map((r, i) => {
          const expectedDirection = r.composite_score >= 65;
          const actualPositive = r.next_day_close_pct > 0;
          const hit = r.beat_or_miss && expectedDirection === actualPositive;

          return (
            <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle">
              <div className="col-span-1 text-fg-muted text-xs">{r.earnings_date}</div>
              <div className="col-span-1 font-bold">{r.ticker}</div>
              <div className="col-span-1">{r.composite_score}</div>
              <div className="col-span-2"><SignalBadge signal={r.signal} /></div>
              <div className="col-span-1 text-xs text-fg-muted">{r.expected_move_pct?.toFixed(1)}%</div>
              <div className="col-span-1 text-xs">
                {r.beat_or_miss ? (
                  <span className={r.beat_or_miss === 'BEAT' ? 'text-signal-buy' : 'text-signal-sell'}>
                    {r.beat_or_miss}
                  </span>
                ) : <span className="text-fg-dim">—</span>}
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
              <div className="col-span-1 text-xs">
                {hit === undefined || hit === null ? <span className="text-fg-dim">—</span> :
                 hit ? <span className="text-signal-buy">✓</span> :
                 <span className="text-signal-sell">✗</span>}
              </div>
            </div>
          );
        })}
        {!rows?.length && (
          <div className="px-4 py-8 text-center text-fg-subtle text-sm">
            No history yet. Run a few earnings cycles and log outcomes.
          </div>
        )}
      </div>
    </div>
  );
}
