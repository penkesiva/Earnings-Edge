import Link from 'next/link';
import { Suspense } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { DayPrepHeader } from '@/components/DayPrepHeader';
import { DashboardResultCell } from '@/components/DashboardResultCell';
import { loadConsensusByBriefIds } from '@/lib/loadDashboardConsensus';
import { FearGreedIndex, FearGreedIndexSkeleton } from '@/components/FearGreedIndex';
import { LastScanned } from '@/components/LastScanned';
import { SectionHeader } from '@/components/SectionHeader';
import { UpcomingWeekList } from '@/components/UpcomingWeekList';

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

  // Fetch timing (AMC/BMO) from earnings_events for today + tomorrow
  const { data: todayEvents } = await sb
    .from('earnings_events')
    .select('ticker, timing')
    .eq('earnings_date', today);

  const { data: tomorrowEvents } = await sb
    .from('earnings_events')
    .select('ticker, timing')
    .eq('earnings_date', tomorrow);

  const timingToday    = new Map((todayEvents    ?? []).map(e => [e.ticker, e.timing as string]));
  const timingTomorrow = new Map((tomorrowEvents ?? []).map(e => [e.ticker, e.timing as string]));

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
    .select('id, ticker, earnings_date, final_action, composite_score, updated_at, generated_at, expected_move_dollar, expected_move_pct')
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

  const allBriefIds = [
    ...(todayBriefs ?? []).map(b => b.id as string),
    ...(tomorrowBriefs ?? []).map(b => b.id as string),
    ...(upcomingBriefs ?? []).map(b => b.id as string),
  ];
  const consensusByBriefId = await loadConsensusByBriefIds(sb, allBriefIds);
  const consensusFor = (briefId: string) => consensusByBriefId.get(briefId) ?? null;

  return (
    <div className="space-y-8 sm:space-y-12">
      <Suspense fallback={<FearGreedIndexSkeleton />}>
        <FearGreedIndex />
      </Suspense>

      <section className="space-y-2">
        <DayPrepHeader date={today} />

        {!todayBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-8 text-center text-fg-subtle text-sm">
            No briefs yet — hit <span className="text-fg-muted">PREP</span> when a watchlist name reports today. If dates look stale, go to <span className="text-fg-muted">WATCHLIST → SYNC CALENDAR</span>.
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-2">
              {todayBriefs.map(b => (
                <Link key={b.id} href={`/briefs/${b.id}`} className="block border border-border bg-bg-elevated p-3 sm:p-4 active:opacity-75 touch-manipulation">
                  {/* Row 1: Ticker + conviction + score + timestamp */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xl tracking-tight">{b.ticker}</span>
                      <TimingBadge timing={timingToday.get(b.ticker)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <ScoreCell value={b.composite_score} />
                      <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                    </div>
                  </div>
                  {/* Row 2: Action badge (full width so long labels never overflow) */}
                  <div className="mb-2">
                    <DashboardResultCell
                      compact
                      consensusText={consensusFor(b.id)}
                    />
                  </div>
                  {/* Row 3: Key stats */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-dim">
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
              <div className="col-span-3">VERDICT</div>
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
                <div className="col-span-1 font-bold flex items-center gap-1.5">
                  {b.ticker}
                  <TimingBadge timing={timingToday.get(b.ticker)} />
                </div>
                <div className="col-span-1">
                  <ScoreCell value={b.composite_score} />
                </div>
                <div className="col-span-3 flex items-center min-w-0">
                  <DashboardResultCell
                    consensusText={consensusFor(b.id)}
                  />
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

      <section className="space-y-2">
        <DayPrepHeader date={tomorrow} />

        {!tomorrowBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-5 text-center text-fg-subtle text-sm">
            No tomorrow briefs yet — hit <span className="text-fg-muted">PREP</span> above.
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-2">
              {tomorrowBriefs.map(b => (
                <Link key={b.id} href={`/briefs/${b.id}`} className="block border border-border bg-bg-elevated p-3 sm:p-4 active:opacity-75 touch-manipulation">
                  {/* Row 1: Ticker + conviction + score + timestamp */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xl tracking-tight">{b.ticker}</span>
                      <TimingBadge timing={timingTomorrow.get(b.ticker)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <ScoreCell value={b.composite_score} />
                      <LastScanned updatedAt={b.updated_at ?? b.generated_at ?? null} />
                    </div>
                  </div>
                  {/* Row 2: System / final verdict */}
                  <div className="mb-2">
                    <DashboardResultCell
                      compact
                      consensusText={consensusFor(b.id)}
                    />
                  </div>
                  {/* Row 3: Key stats */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-dim">
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
              <div className="col-span-3">VERDICT</div>
              <div className="col-span-3">EXP MOVE</div>
              <div className="col-span-2">SCANNED</div>
            </div>
            {tomorrowBriefs.map(b => (
              <Link
                key={b.id}
                href={`/briefs/${b.id}`}
                className="terminal-row grid grid-cols-12 gap-4 px-4 py-3 text-sm border-b border-border-subtle"
              >
                <div className="col-span-2 font-bold flex items-center gap-1.5">
                  {b.ticker}
                  <TimingBadge timing={timingTomorrow.get(b.ticker)} />
                </div>
                <div className="col-span-2">
                  <ScoreCell value={b.composite_score} />
                </div>
                <div className="col-span-3 flex items-center min-w-0">
                  <DashboardResultCell
                    consensusText={consensusFor(b.id)}
                  />
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
        <SectionHeader
          title={
            <h2 className="text-lg sm:text-xl font-bold tracking-tight">
              <span className="text-fg-subtle">›</span> NEXT 7 DAYS
            </h2>
          }
        />

        {!upcoming?.length ? (
          <div className="text-fg-subtle text-sm">
            No earnings dates in range — go to{' '}
            <span className="text-fg-muted">WATCHLIST</span> and hit{' '}
            <span className="text-fg-muted">SYNC CALENDAR</span> to pull dates from FMP.
          </div>
        ) : (
          <UpcomingWeekList
            upcomingByDate={upcomingByDate}
            briefByKey={briefByKey}
            consensusFor={consensusFor}
          />
        )}
      </section>
    </div>
  );
}

function TimingBadge({ timing }: { timing: string | undefined }) {
  if (!timing || timing === 'UNK') return <span className="text-[10px] text-fg-dim">UNK</span>;
  const isBmo = timing === 'BMO';
  return (
    <span className={`text-[10px] font-bold tracking-widest px-1 py-0.5 border ${
      isBmo
        ? 'text-sky-400 border-sky-400/40'
        : 'text-signal-watch border-signal-watch/50'
    }`}>
      {timing}
    </span>
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
