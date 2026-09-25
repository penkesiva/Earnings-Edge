import Link from 'next/link';
import { PredictMarketSessionTimeline } from '@/components/predictMarket/PredictMarketSessionTimeline';
import { requireAuthSession } from '@/lib/authServer';
import { formatDayHeader } from '@/lib/earningsDate';
import { nextTradingSessionDate } from '@/lib/predictMarket/sessionCalendar';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function PredictMarketSessionPage({
  params,
}: {
  params: { date: string };
}) {
  const { sb } = await requireAuthSession();
  const sessionDate = params.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) notFound();

  const { data: session, error } = await sb
    .from('pm_market_sessions')
    .select('id, session_date')
    .eq('session_date', sessionDate)
    .maybeSingle();

  if (error && /relation|does not exist/i.test(error.message)) {
    return (
      <p className="text-sm text-fg-subtle">
        Run migration 0022_predict_market.sql first.
      </p>
    );
  }

  if (!session) notFound();

  const [
    { data: predictions },
    { data: snapshots },
    { data: signals },
    { data: checkpoints },
    { data: outcome },
    { data: anchorSnap },
  ] = await Promise.all([
    sb.from('pm_predictions').select('*').eq('session_id', session.id).order('as_of_pt'),
    sb
      .from('pm_market_snapshots')
      .select('snapshot_kind, as_of_pt, payload')
      .eq('session_id', session.id)
      .order('as_of_pt'),
    sb
      .from('pm_trade_signals')
      .select('recommended_side, decision_time_pt, reasoning')
      .eq('session_id', session.id),
    sb
      .from('pm_validation_checkpoints')
      .select('checkpoint_kind, thesis_status, as_of_pt, reasoning')
      .eq('session_id', session.id),
    sb.from('pm_market_outcomes').select('*').eq('session_id', session.id).maybeSingle(),
    sb
      .from('pm_market_snapshots')
      .select('payload')
      .eq('session_id', session.id)
      .order('as_of_pt', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const header = formatDayHeader(sessionDate);
  const next = nextTradingSessionDate();
  const sessionRole =
    sessionDate === next
      ? 'Upcoming NYSE session'
      : outcome
        ? 'Completed session (final grade posted)'
        : 'Session (intraday steps may still run on this date)';

  const payload = anchorSnap?.payload as { technical?: { spx_index_estimate?: number } } | null;
  const spxAnchor = payload?.technical?.spx_index_estimate ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/predictmarket" className="text-xs text-accent hover:underline">
          ← PredictMarket
        </Link>
        <h1 className="text-2xl font-bold mt-2 tracking-tight">{header}</h1>
        <p className="text-sm text-fg-subtle">{sessionRole}</p>
      </div>

      <PredictMarketSessionTimeline
        spxAnchor={spxAnchor}
        predictions={(predictions ?? []) as Record<string, unknown>[]}
        snapshots={(snapshots ?? []) as { snapshot_kind: string; as_of_pt: string; payload?: unknown }[]}
        signals={(signals ?? []) as { recommended_side: string; reasoning?: string | null }[]}
        checkpoints={
          (checkpoints ?? []) as {
            checkpoint_kind: string;
            thesis_status: string;
            reasoning?: string | null;
          }[]
        }
        outcome={
          outcome
            ? {
                actual_direction: outcome.actual_direction as string | null,
                daily_return_percent: outcome.daily_return_percent as number | null,
                previous_close:
                  outcome.previous_close != null ? Number(outcome.previous_close) : null,
                close: outcome.close != null ? Number(outcome.close) : null,
              }
            : null
        }
      />
    </div>
  );
}
