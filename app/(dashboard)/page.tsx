import Link from 'next/link';
import { Suspense } from 'react';
import { supabaseAdmin } from '@/lib/supabase';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { DashboardResultCell } from '@/components/DashboardResultCell';
import { loadConsensusByBriefIds } from '@/lib/loadDashboardConsensus';
import { FearGreedIndex, FearGreedIndexSkeleton } from '@/components/FearGreedIndex';
import { LastScanned } from '@/components/LastScanned';
import { PrepDateButton } from '@/components/PrepDateButton';
import { ScanButton } from '@/components/ScanButton';
import { SectionHeader } from '@/components/SectionHeader';

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

      <section>
        <SectionHeader
          title={
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight">
              <span className="text-fg-subtle">›</span> HOME
            </h1>
          }
        >
          <ScanButton mode="today" />
          <span className="text-xs text-fg-subtle whitespace-nowrap">
            {todayBriefs?.length ?? 0} BRIEF{todayBriefs?.length === 1 ? '' : 'S'}
          </span>
        </SectionHeader>

        {!todayBriefs?.length ? (
          <div className="border border-border bg-bg-elevated p-8 text-center text-fg-subtle text-sm">
            No briefs yet — hit <span className="text-fg-muted">RUN SCAN</span> when a watchlist name reports today. If dates look stale, go to <span className="text-fg-muted">WATCHLIST → SYNC CALENDAR</span>.
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
                      systemAction={b.final_action ?? null}
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
              <div className="col-span-3">RESULT</div>
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
                    systemAction={b.final_action ?? null}
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

      <section>
        <SectionHeader
          title={
            <h2 className="text-lg sm:text-xl font-bold tracking-tight">
              <span className="text-fg-subtle">›</span> TOMORROW PREP
            </h2>
          }
        >
          <ScanButton mode="tomorrow" />
          <span className="text-xs text-fg-subtle whitespace-nowrap">
            {tomorrowBriefs?.length ?? 0} BRIEF{tomorrowBriefs?.length === 1 ? '' : 'S'} · {tomorrow}
          </span>
        </SectionHeader>
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
                      systemAction={b.final_action ?? null}
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
              <div className="col-span-3">RESULT</div>
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
                    systemAction={b.final_action ?? null}
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
          <div className="space-y-4">
            {Object.entries(upcomingByDate).map(([date, events]) => (
              <div key={date} className="border border-border">
                {/* Date header row */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 bg-bg-elevated border-b border-border text-xs tracking-widest">
                  <span className="text-fg font-bold">
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    }).toUpperCase()}
                  </span>
                  <PrepDateButton date={date} />
                </div>

                {/* Column header — desktop only */}
                <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs text-fg-subtle uppercase tracking-widest border-b border-border-subtle bg-bg">
                  <div className="col-span-2">TKR</div>
                  <div className="col-span-2">SCORE</div>
                  <div className="col-span-3">RESULT</div>
                  <div className="col-span-3">EXP MOVE</div>
                  <div className="col-span-2">SCANNED</div>
                </div>

                {/* Ticker rows */}
                <div className="divide-y divide-border-subtle">
                  {events!.map(e => {
                    const brief = briefByKey.get(`${date}:${e.ticker}`);
                    const RowWrapper = brief
                      ? ({ children }: { children: React.ReactNode }) => (
                          <Link href={`/briefs/${brief.id}`} className="block terminal-row">
                            {children}
                          </Link>
                        )
                      : ({ children }: { children: React.ReactNode }) => (
                          <div>{children}</div>
                        );

                    return (
                      <RowWrapper key={e.id}>
                        {/* ── Mobile: 2-line layout ── */}
                        <div className="md:hidden px-4 py-2.5 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-bold shrink-0">{e.ticker}</span>
                              <TimingBadge timing={e.timing} />
                            </div>
                            {brief ? (
                              <span className="text-[10px] text-fg-subtle tracking-widest shrink-0">VIEW →</span>
                            ) : (
                              <span className="text-[10px] text-fg-dim tracking-widest shrink-0">NO BRIEF</span>
                            )}
                          </div>
                          {brief && (
                            <div className="mt-1.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <ScoreCell value={brief.composite_score} />
                                <LastScanned updatedAt={brief.updated_at ?? brief.generated_at ?? null} />
                              </div>
                              <DashboardResultCell
                                compact
                                systemAction={brief.final_action ?? null}
                                consensusText={consensusFor(brief.id)}
                              />
                            </div>
                          )}
                        </div>

                        {/* ── Desktop: aligned grid columns (mirrors TOMORROW PREP) ── */}
                        <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 text-sm items-center">
                          <div className="col-span-2 font-bold flex items-center gap-1.5">
                            {e.ticker}
                            <TimingBadge timing={e.timing} />
                          </div>
                          <div className="col-span-2">
                            {brief ? <ScoreCell value={brief.composite_score} /> : <span className="text-fg-dim">—</span>}
                          </div>
                          <div className="col-span-3 flex items-center min-w-0">
                            {brief ? (
                              <DashboardResultCell
                                systemAction={brief.final_action ?? null}
                                consensusText={consensusFor(brief.id)}
                              />
                            ) : (
                              <span className="text-xs text-fg-dim tracking-widest">NO BRIEF</span>
                            )}
                          </div>
                          <div className="col-span-3 text-fg-muted">
                            {brief?.expected_move_dollar != null
                              ? `±$${(brief.expected_move_dollar as number).toFixed(2)} (${(brief.expected_move_pct as number).toFixed(1)}%)`
                              : <span className="text-fg-dim">—</span>}
                          </div>
                          <div className="col-span-2">
                            {brief ? (
                              <LastScanned updatedAt={brief.updated_at ?? brief.generated_at ?? null} />
                            ) : (
                              <span className="text-fg-dim">—</span>
                            )}
                          </div>
                        </div>
                      </RowWrapper>
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
