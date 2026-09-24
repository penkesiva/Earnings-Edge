import Link from 'next/link';
import { requireAuthSession } from '@/lib/authServer';
import { formatDayHeader } from '@/lib/earningsDate';
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
  ] = await Promise.all([
    sb.from('pm_predictions').select('*').eq('session_id', session.id).order('as_of_pt'),
    sb.from('pm_market_snapshots').select('snapshot_kind, as_of_pt').eq('session_id', session.id).order('as_of_pt'),
    sb.from('pm_trade_signals').select('recommended_side, decision_time_pt, reasoning').eq('session_id', session.id),
    sb.from('pm_validation_checkpoints').select('checkpoint_kind, thesis_status, as_of_pt').eq('session_id', session.id),
    sb.from('pm_market_outcomes').select('*').eq('session_id', session.id).maybeSingle(),
  ]);

  const header = formatDayHeader(sessionDate);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/predictmarket" className="text-xs text-accent hover:underline">
          ← PredictMarket
        </Link>
        <h1 className="text-2xl font-bold mt-2 tracking-tight">{header}</h1>
        <p className="text-sm text-fg-subtle">Session timeline (immutable records)</p>
      </div>

      <ul className="border border-border divide-y divide-border-subtle text-sm">
        {(predictions ?? []).map(p => (
          <li key={p.id as string} className="px-4 py-3">
            <span className="text-[10px] text-fg-dim uppercase tracking-widest">
              {p.prediction_type as string}
            </span>
            <p className="font-bold mt-1">
              {p.direction as string} · {p.confidence as number}% · {p.trade_bias as string}
            </p>
          </li>
        ))}
        {(snapshots ?? []).map((s, i) => (
          <li key={`${s.snapshot_kind}-${i}`} className="px-4 py-3 text-fg-subtle">
            Snapshot {s.snapshot_kind as string}
          </li>
        ))}
        {(signals ?? []).map((s, i) => (
          <li key={`sig-${i}`} className="px-4 py-3">
            Entry: {s.recommended_side as string}
          </li>
        ))}
        {(checkpoints ?? []).map(c => (
          <li key={c.checkpoint_kind as string} className="px-4 py-3">
            {c.checkpoint_kind as string}: {c.thesis_status as string}
          </li>
        ))}
        {outcome ? (
          <li className="px-4 py-3 font-bold">
            Final: {outcome.actual_direction as string} · {outcome.daily_return_percent as number}%
          </li>
        ) : (
          <li className="px-4 py-3 text-fg-dim">Final grade pending</li>
        )}
      </ul>
    </div>
  );
}
