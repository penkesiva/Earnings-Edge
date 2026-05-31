import Link from 'next/link';
import { DayPrepHeader } from '@/components/DayPrepHeader';
import { DashboardResultCell } from '@/components/DashboardResultCell';
import { HomeBriefLink, HomeScanAllCell } from '@/components/HomeScanAllCell';
import { ScanAgeLabel } from '@/components/scanAll/ScanAllPipeline';
import type { DashboardBriefAiMeta } from '@/lib/loadDashboardBriefAi';
import type { UpcomingSession } from '@/lib/usMarketCalendar';

type EarningsEvent = {
  id: string;
  ticker: string;
  timing: string | null;
};

type BriefRow = {
  id: string;
  ticker: string;
  composite_score: number;
  updated_at: string | null;
  generated_at: string | null;
  expected_move_dollar: number | null;
  expected_move_pct: number | null;
};

function TimingBadge({ timing }: { timing: string | undefined | null }) {
  if (!timing || timing === 'UNK') {
    return <span className="text-[10px] text-fg-dim">UNK</span>;
  }
  const isBmo = timing === 'BMO';
  return (
    <span
      className={`text-[10px] font-bold tracking-widest px-1 py-0.5 border ${
        isBmo
          ? 'text-sky-400 border-sky-400/40'
          : 'text-signal-watch border-signal-watch/50'
      }`}
    >
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
  return <span className={`font-bold tabular-nums ${color}`}>{value}</span>;
}

function UpcomingMobileCard({
  event,
  brief,
  earningsDate,
  aiMeta,
}: {
  event: EarningsEvent;
  brief: BriefRow | undefined;
  earningsDate: string;
  aiMeta: DashboardBriefAiMeta | null;
}) {
  return (
    <div className="border border-border bg-bg-elevated p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {brief ? (
              <Link
                href={`/briefs/${brief.id}`}
                className="font-bold text-lg tracking-tight hover:text-signal-buy"
              >
                {event.ticker}
              </Link>
            ) : (
              <span className="font-bold text-lg tracking-tight">{event.ticker}</span>
            )}
            <TimingBadge timing={event.timing} />
          </div>
          {brief ? (
            <div className="flex items-center gap-2 mt-1">
              <ScoreCell value={brief.composite_score} />
              {brief.expected_move_dollar != null && (
                <span className="text-[11px] text-fg-dim font-mono">
                  ±${brief.expected_move_dollar.toFixed(2)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-fg-dim tracking-widest mt-1 block">NO BRIEF YET</span>
          )}
        </div>
        <div className="shrink-0">
          <DashboardResultCell compact consensusText={aiMeta?.consensusText} />
        </div>
      </div>

      <HomeScanAllCell
        ticker={event.ticker}
        earningsDate={earningsDate}
        briefId={brief?.id}
        lastAiScanAt={aiMeta?.lastAiScanAt}
        lastConsensusAt={aiMeta?.lastConsensusAt}
        consensusText={aiMeta?.consensusText}
        compact
      />

      {brief && (
        <div className="flex justify-end pt-1 border-t border-border-subtle">
          <HomeBriefLink briefId={brief.id} />
        </div>
      )}
    </div>
  );
}

export function UpcomingWeekList({
  sessions,
  upcomingByDate,
  briefByKey,
  aiMetaFor,
}: {
  sessions: UpcomingSession[];
  upcomingByDate: Record<string, EarningsEvent[] | null | undefined>;
  briefByKey: Map<string, BriefRow | undefined>;
  aiMetaFor: (briefId: string | undefined) => DashboardBriefAiMeta | null;
}) {
  return (
    <div className="space-y-6 md:space-y-4">
      {sessions.map(({ date, marketOpen }) => {
        const events = upcomingByDate[date] ?? [];
        return (
          <section key={date} className="space-y-2">
            <DayPrepHeader date={date} marketOpen={marketOpen} />

            {marketOpen ? (
              events.length === 0 ? (
                <p className="text-xs text-fg-dim tracking-wide px-0.5">
                  No watchlist earnings — add tickers on{' '}
                  <span className="text-fg-muted">WATCHLIST</span> or{' '}
                  <span className="text-fg-muted">SYNC CALENDAR</span>.
                </p>
              ) : (
                <>
                  <div className="md:hidden space-y-2">
                    {events.map(e => {
                      const brief = briefByKey.get(`${date}:${e.ticker}`);
                      return (
                        <UpcomingMobileCard
                          key={e.id}
                          event={e}
                          brief={brief}
                          earningsDate={date}
                          aiMeta={aiMetaFor(brief?.id)}
                        />
                      );
                    })}
                  </div>

                  <div className="hidden md:block border border-border">
                    <div className="grid grid-cols-12 gap-3 px-4 py-2 text-xs text-fg-subtle uppercase tracking-widest border-b border-border-subtle bg-bg">
                      <div className="col-span-2">TKR</div>
                      <div className="col-span-1">SCORE</div>
                      <div className="col-span-2">VERDICT</div>
                      <div className="col-span-2">EXP MOVE</div>
                      <div className="col-span-3">SCAN ALL</div>
                      <div className="col-span-2 text-right">SCANNED</div>
                    </div>
                    <div className="divide-y divide-border-subtle">
                      {events.map(e => {
                        const brief = briefByKey.get(`${date}:${e.ticker}`);
                        const aiMeta = aiMetaFor(brief?.id);
                        return (
                          <div
                            key={e.id}
                            className="grid grid-cols-12 gap-3 px-4 py-3 text-sm items-center"
                          >
                            <div className="col-span-2 font-bold flex items-center gap-1.5 min-w-0">
                              {brief ? (
                                <Link
                                  href={`/briefs/${brief.id}`}
                                  className="hover:text-signal-buy truncate"
                                >
                                  {e.ticker}
                                </Link>
                              ) : (
                                <span>{e.ticker}</span>
                              )}
                              <TimingBadge timing={e.timing} />
                            </div>
                            <div className="col-span-1">
                              {brief ? (
                                <ScoreCell value={brief.composite_score} />
                              ) : (
                                <span className="text-fg-dim">—</span>
                              )}
                            </div>
                            <div className="col-span-2 flex items-center min-w-0">
                              <DashboardResultCell consensusText={aiMeta?.consensusText} />
                            </div>
                            <div className="col-span-2 text-fg-muted text-xs">
                              {brief?.expected_move_dollar != null
                                ? `±$${brief.expected_move_dollar.toFixed(2)} (${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`
                                : '—'}
                            </div>
                            <div className="col-span-3 min-w-0">
                              <HomeScanAllCell
                                ticker={e.ticker}
                                earningsDate={date}
                                briefId={brief?.id}
                                lastAiScanAt={aiMeta?.lastAiScanAt}
                                lastConsensusAt={aiMeta?.lastConsensusAt}
                                consensusText={aiMeta?.consensusText}
                              />
                            </div>
                            <div className="col-span-2 text-right">
                              <ScanAgeLabel
                                at={aiMeta?.lastConsensusAt ?? aiMeta?.lastAiScanAt ?? null}
                                neverLabel="—"
                                align="end"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
