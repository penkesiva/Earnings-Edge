import Link from 'next/link';
import { Suspense } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { FinalActionBadge, ConvictionArrows } from '@/components/SignalBadge';
import { DashboardRefresh } from '@/components/DashboardRefresh';
import { FearGreedIndex, FearGreedIndexSkeleton } from '@/components/FearGreedIndex';
import { LastScanned } from '@/components/LastScanned';
import { PrepDateButton } from '@/components/PrepDateButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const sb = supabaseAdmin();
  const today = earningsSessionDate();
  const tomorrow = addCalendarDays(today, 1);

  // Today's briefs
  const { data: todayBriefs } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('earnings_date', today)
    .order('composite_score', { ascending: false });

  const { data: tomorrowBriefs } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('earnings_date', tomorrow)
    .order('composite_score', { ascending: false });

  // Upcoming events (next 7 days, excluding today/tomorrow which have their own sections)
  const in7 = addCalendarDays(today, 7);
  const { data: upcoming } = await sb
    .from('earnings_events')
    .select('*')
    .gt('earnings_date', tomorrow)
    .lte('earnings_date', in7)
    .order('earnings_date', { ascending: true });

  // Existing briefs for the same window (so we can show links + badge + staleness)
  const { data: upcomingBriefs } = await sb
    .from('earnings_briefs')
    .select('id, ticker, earnings_date, final_action, composite_score, updated_at, generated_at')
    .gt('earnings_date', tomorrow)
    .lte('earnings_date', in7)
    .order('composite_score', { ascending: false });

  // Index briefs by date+ticker for quick lookup
  const briefByKey = new Map(
    (upcomingBriefs ?? []).map(b => [`${b.earnings_date}:${b.ticker}`, b])
  );

  // Group upcoming events by date
  const upcomingByDate = (upcoming ?? []).reduce<Record<string, typeof upcoming>>((acc, e) => {
    (acc[e.earnings_date] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-12">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <DashboardRefresh />
        <Suspense fallback={<FearGreedIndexSkeleton />}>
          <FearGreedIndex />
        </Suspense>
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            <span className="text-fg-subtle">›</span> TODAY
          </h1>
          <div className="text-xs text-fg-subtle">
            {todayBriefs?.length ?? 0} BRIEF{todayBriefs?.length === 1 ? '' : 'S'}
          </div>
        </div>

        {!todayBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-8 text-center text-fg-subtle text-sm">
            No briefs for today yet — run daily scan when a watchlist name reports, or use Sync
            calendar above if dates are stale.
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-2">
              {todayBriefs.map(b => (
                <Link key={b.id} href={`/briefs/${b.id}`} className="block border border-border bg-bg-elevated p-3 active:opacity-75">
                  {/* Row 1: Ticker + conviction + score + timestamp */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xl tracking-tight">{b.ticker}</span>
                      <ConvictionArrows action={b.final_action ?? null} />
                    </div>
                    <div className="flex items-center gap-2">
                      <ScoreCell value={b.composite_score} />
                      <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                    </div>
                  </div>
                  {/* Row 2: Action badge (full width so long labels never overflow) */}
                  <div className="mb-2">
                    <FinalActionBadge action={b.final_action ?? null} />
                  </div>
                  {/* Row 3: Key stats */}
                  <div className="flex gap-4 text-[11px] text-fg-dim">
                    <span>SPOT <span className="text-fg-muted font-mono">${b.spot_price?.toFixed(2)}</span></span>
                    <span>MOVE <span className="text-fg-muted font-mono">±${b.expected_move_dollar?.toFixed(2)}</span></span>
                    <span>IVR <span className="text-fg-muted font-mono">{b.iv_rank}</span></span>
                  </div>
                </Link>
              ))}
            </div>

            <div className="hidden md:block border border-border">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
              <div className="col-span-1">TKR</div>
              <div className="col-span-1">SCORE</div>
              <div className="col-span-3">ACTION</div>
              <div className="col-span-2">SPOT</div>
              <div className="col-span-2">EXP MOVE</div>
              <div className="col-span-1">IV RANK</div>
              <div className="col-span-2">SCANNED</div>
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
                <div className="col-span-3 flex items-center gap-2">
                  <ConvictionArrows action={b.final_action ?? null} />
                  <FinalActionBadge action={b.final_action ?? null} />
                </div>
                <div className="col-span-2 text-fg-muted">
                  ${b.spot_price?.toFixed(2)}
                </div>
                <div className="col-span-2 text-fg-muted">
                  ±${b.expected_move_dollar?.toFixed(2)} ({b.expected_move_pct?.toFixed(1)}%)
                </div>
                <div className="col-span-1 text-fg-muted">{b.iv_rank}</div>
                <div className="col-span-2">
                  <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                </div>
              </Link>
            ))}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">
            <span className="text-fg-subtle">›</span> TOMORROW PREP
          </h2>
          <div className="text-xs text-fg-subtle">
            {tomorrowBriefs?.length ?? 0} BRIEF{tomorrowBriefs?.length === 1 ? '' : 'S'} · {tomorrow}
          </div>
        </div>
        {!tomorrowBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-5 text-center text-fg-subtle text-sm">
            No tomorrow briefs yet — click <span className="text-fg-muted">PREP TOMORROW</span> above.
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-2">
              {tomorrowBriefs.map(b => (
                <Link key={b.id} href={`/briefs/${b.id}`} className="block border border-border bg-bg-elevated p-3 active:opacity-75">
                  {/* Row 1: Ticker + conviction + score + timestamp */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xl tracking-tight">{b.ticker}</span>
                      <ConvictionArrows action={b.final_action ?? null} />
                    </div>
                    <div className="flex items-center gap-2">
                      <ScoreCell value={b.composite_score} />
                      <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                    </div>
                  </div>
                  {/* Row 2: Action badge */}
                  <div className="mb-2">
                    <FinalActionBadge action={b.final_action ?? null} />
                  </div>
                  {/* Row 3: Key stats */}
                  <div className="flex gap-4 text-[11px] text-fg-dim">
                    <span>SPOT <span className="text-fg-muted font-mono">${b.spot_price?.toFixed(2)}</span></span>
                    <span>MOVE <span className="text-fg-muted font-mono">±${b.expected_move_dollar?.toFixed(2)}</span></span>
                  </div>
                </Link>
              ))}
            </div>

            <div className="hidden md:block border border-border">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-bg-elevated text-xs text-fg-subtle uppercase tracking-widest border-b border-border">
              <div className="col-span-2">TKR</div>
              <div className="col-span-2">SCORE</div>
              <div className="col-span-3">ACTION</div>
              <div className="col-span-3">EXP MOVE</div>
              <div className="col-span-2">SCANNED</div>
            </div>
            {tomorrowBriefs.map(b => (
              <Link
                key={b.id}
                href={`/briefs/${b.id}`}
                className="terminal-row grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle"
              >
                <div className="col-span-2 font-bold">{b.ticker}</div>
                <div className="col-span-2">
                  <ScoreCell value={b.composite_score} />
                </div>
                <div className="col-span-3 flex items-center gap-2">
                  <ConvictionArrows action={b.final_action ?? null} />
                  <FinalActionBadge action={b.final_action ?? null} />
                </div>
                <div className="col-span-3 text-fg-muted">
                  ±${b.expected_move_dollar?.toFixed(2)} ({b.expected_move_pct?.toFixed(1)}%)
                </div>
                <div className="col-span-2">
                  <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                </div>
              </Link>
            ))}
            </div>
          </>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4 sm:mb-6">
          <h2 className="text-xl font-bold tracking-tight">
            <span className="text-fg-subtle">›</span> NEXT 7 DAYS
          </h2>
        </div>

        {!upcoming?.length ? (
          <div className="text-fg-subtle text-sm">
            No earnings dates in range — try{' '}
            <span className="text-fg-muted">SYNC CALENDAR</span> above (needs FMP + watchlist).
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(upcomingByDate).map(([date, events]) => (
              <div key={date} className="border border-border">
                {/* Date header row */}
                <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border text-xs tracking-widest">
                  <span className="text-fg font-bold">
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    }).toUpperCase()}
                  </span>
                  <PrepDateButton date={date} />
                </div>

                {/* Ticker rows */}
                <div className="divide-y divide-border-subtle">
                  {events!.map(e => {
                    const brief = briefByKey.get(`${date}:${e.ticker}`);
                    return (
                      <div key={e.id} className="px-4 py-2.5 text-sm">
                        {/* Row 1: Ticker · timing · source badge  +  VIEW link */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold shrink-0">{e.ticker}</span>
                            <span className="text-[10px] text-fg-subtle shrink-0">{e.timing}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.5 border tracking-widest shrink-0 ${
                                e.source === 'MANUAL'
                                  ? 'text-signal-watch border-signal-watch/50'
                                  : 'text-fg-dim border-border-subtle'
                              }`}
                            >
                              {e.source || 'UNK'}
                            </span>
                          </div>
                          {brief ? (
                            <Link
                              href={`/briefs/${brief.id}`}
                              className="text-[10px] text-fg-subtle hover:text-fg tracking-widest underline underline-offset-2 shrink-0"
                            >
                              VIEW →
                            </Link>
                          ) : (
                            <span className="text-[10px] text-fg-dim tracking-widest shrink-0">NO BRIEF</span>
                          )}
                        </div>
                        {/* Row 2: Action badge + scanned timestamp (only when brief exists) */}
                        {brief && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <ConvictionArrows action={brief.final_action ?? null} />
                            <FinalActionBadge action={brief.final_action ?? null} />
                            <LastScanned updatedAt={brief.updated_at ?? brief.generated_at ?? null} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
