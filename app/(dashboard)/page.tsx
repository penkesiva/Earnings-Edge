import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { SignalBadge } from '@/components/SignalBadge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const sb = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Today's briefs
  const { data: todayBriefs } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('earnings_date', today)
    .order('composite_score', { ascending: false });

  // Upcoming events (next 7 days)
  const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: upcoming } = await sb
    .from('earnings_events')
    .select('*')
    .gt('earnings_date', today)
    .lte('earnings_date', in7)
    .order('earnings_date', { ascending: true });

  return (
    <div className="space-y-12">
      <section>
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-fg-subtle">›</span> TODAY
          </h1>
          <div className="text-xs text-fg-subtle">
            {todayBriefs?.length ?? 0} BRIEF{todayBriefs?.length === 1 ? '' : 'S'}
          </div>
        </div>

        {!todayBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-8 text-center text-fg-subtle text-sm">
            No earnings reporting today. Cron runs 6am PT weekdays.
          </div>
        ) : (
          <div className="border border-border">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
              <div className="col-span-1">TKR</div>
              <div className="col-span-1">SCORE</div>
              <div className="col-span-2">SIGNAL</div>
              <div className="col-span-2">SPOT</div>
              <div className="col-span-2">EXP MOVE</div>
              <div className="col-span-1">IV RANK</div>
              <div className="col-span-3">REASONING</div>
            </div>
            {todayBriefs.map(b => (
              <Link
                key={b.id}
                href={`/briefs/${b.id}`}
                className="terminal-row grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle"
              >
                <div className="col-span-1 font-bold">{b.ticker}</div>
                <div className="col-span-1">
                  <ScoreCell value={b.composite_score} />
                </div>
                <div className="col-span-2">
                  <SignalBadge signal={b.signal} />
                </div>
                <div className="col-span-2 text-fg-muted">
                  ${b.spot_price?.toFixed(2)}
                </div>
                <div className="col-span-2 text-fg-muted">
                  ±${b.expected_move_dollar?.toFixed(2)} ({b.expected_move_pct?.toFixed(1)}%)
                </div>
                <div className="col-span-1 text-fg-muted">{b.iv_rank}</div>
                <div className="col-span-3 text-xs text-fg-subtle truncate">
                  {b.reasoning || '—'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-xl font-bold tracking-tight">
            <span className="text-fg-subtle">›</span> NEXT 7 DAYS
          </h2>
        </div>

        {!upcoming?.length ? (
          <div className="text-fg-subtle text-sm">No upcoming earnings on watchlist.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {upcoming.map(e => (
              <div
                key={e.id}
                className="border border-border bg-bg-elevated px-3 py-2 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-bold">{e.ticker}</span>
                  <span className="text-xs text-fg-subtle">{e.timing}</span>
                </div>
                <div className="text-xs text-fg-muted mt-1">{e.earnings_date}</div>
                {e.consensus_eps && (
                  <div className="text-xs text-fg-subtle mt-1">
                    Cons EPS: ${e.consensus_eps.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ScoreCell({ value }: { value: number }) {
  const color =
    value >= 85 ? 'text-signal-buy' :
    value >= 65 ? 'text-signal-buy' :
    value >= 40 ? 'text-signal-watch' :
    'text-signal-sell';

  return <span className={`font-bold ${color}`}>{value}</span>;
}
