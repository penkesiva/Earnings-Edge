import Link from 'next/link';
import { formatDayHeader } from '@/lib/earningsDate';
import { DashboardResultCell } from '@/components/DashboardResultCell';
import { LastScanned } from '@/components/LastScanned';
import { PrepDateButton } from '@/components/PrepDateButton';

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
  consensusText,
}: {
  event: EarningsEvent;
  brief: BriefRow | undefined;
  consensusText: string | null;
}) {
  if (!brief) {
    return (
      <div className="border border-border-subtle bg-bg px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-lg tracking-tight">{event.ticker}</span>
            <TimingBadge timing={event.timing} />
          </div>
          <span className="text-[10px] text-fg-dim tracking-widest shrink-0">NO BRIEF</span>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/briefs/${brief.id}`}
      className="block border border-border bg-bg-elevated p-3 active:opacity-75 touch-manipulation"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-lg tracking-tight">{event.ticker}</span>
          <TimingBadge timing={event.timing} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreCell value={brief.composite_score} />
          <LastScanned updatedAt={brief.updated_at ?? brief.generated_at} />
        </div>
      </div>
      <div className="mb-2">
        <DashboardResultCell compact consensusText={consensusText} />
      </div>
      {brief.expected_move_dollar != null && (
        <p className="text-[11px] text-fg-dim">
          MOVE{' '}
          <span className="text-fg-muted font-mono">
            ±${brief.expected_move_dollar.toFixed(2)}
            {brief.expected_move_pct != null
              ? ` (${brief.expected_move_pct.toFixed(1)}%)`
              : ''}
          </span>
        </p>
      )}
    </Link>
  );
}

export function UpcomingWeekList({
  upcomingByDate,
  briefByKey,
  consensusFor,
}: {
  upcomingByDate: Record<string, EarningsEvent[] | null | undefined>;
  briefByKey: Map<string, BriefRow | undefined>;
  consensusFor: (briefId: string) => string | null;
}) {
  return (
    <div className="space-y-6 md:space-y-4">
      {Object.entries(upcomingByDate).map(([date, events]) => (
        <section key={date} className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-0.5">
            <h3 className="text-sm font-bold tracking-wide text-fg">{formatDayHeader(date)}</h3>
            <PrepDateButton date={date} />
          </div>

          <div className="md:hidden space-y-2">
            {(events ?? []).map(e => {
              const brief = briefByKey.get(`${date}:${e.ticker}`);
              return (
                <UpcomingMobileCard
                  key={e.id}
                  event={e}
                  brief={brief}
                  consensusText={brief ? consensusFor(brief.id) : null}
                />
              );
            })}
          </div>

          <div className="hidden md:block border border-border">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs text-fg-subtle uppercase tracking-widest border-b border-border-subtle bg-bg">
              <div className="col-span-2">TKR</div>
              <div className="col-span-2">SCORE</div>
              <div className="col-span-3">VERDICT</div>
              <div className="col-span-3">EXP MOVE</div>
              <div className="col-span-2">SCANNED</div>
            </div>
            <div className="divide-y divide-border-subtle">
              {(events ?? []).map(e => {
                const brief = briefByKey.get(`${date}:${e.ticker}`);
                const inner = (
                  <div className="grid grid-cols-12 gap-4 px-4 py-3 text-sm items-center">
                    <div className="col-span-2 font-bold flex items-center gap-1.5">
                      {e.ticker}
                      <TimingBadge timing={e.timing} />
                    </div>
                    <div className="col-span-2">
                      {brief ? (
                        <ScoreCell value={brief.composite_score} />
                      ) : (
                        <span className="text-fg-dim">—</span>
                      )}
                    </div>
                    <div className="col-span-3 flex items-center min-w-0">
                      {brief ? (
                        <DashboardResultCell consensusText={consensusFor(brief.id)} />
                      ) : (
                        <span className="text-xs text-fg-dim tracking-widest">NO BRIEF</span>
                      )}
                    </div>
                    <div className="col-span-3 text-fg-muted">
                      {brief?.expected_move_dollar != null
                        ? `±$${brief.expected_move_dollar.toFixed(2)} (${brief.expected_move_pct?.toFixed(1) ?? '—'}%)`
                        : '—'}
                    </div>
                    <div className="col-span-2">
                      {brief ? (
                        <LastScanned updatedAt={brief.updated_at ?? brief.generated_at} />
                      ) : (
                        <span className="text-fg-dim">—</span>
                      )}
                    </div>
                  </div>
                );
                return brief ? (
                  <Link key={e.id} href={`/briefs/${brief.id}`} className="block terminal-row">
                    {inner}
                  </Link>
                ) : (
                  <div key={e.id}>{inner}</div>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
