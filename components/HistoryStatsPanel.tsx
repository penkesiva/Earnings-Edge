import Link from 'next/link';
import {
  computeHistoryStats,
  hitRateColor,
  isSkipAction,
  type HistoryStatsRow,
} from '@/lib/historyStats';
import { FinalActionBadge } from '@/components/SignalBadge';

export function HistoryStatsPanel({ rows }: { rows: HistoryStatsRow[] }) {
  const s = computeHistoryStats(rows);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3">
        <StatCard label="BRIEFS" value={String(s.totalBriefs)} />
        <StatCard label="EPS LOGGED" value={String(s.epsLogged)} sub={s.pendingEps ? `${s.pendingEps} pending` : undefined} />
        <StatCard
          label="STRUCTURE HIT"
          value={s.structureHitRate != null ? `${s.structureHitRate.toFixed(0)}%` : '—'}
          valueClass={hitRateColor(s.structureHitRate)}
          sub={s.scored ? `${s.hits}✓ · ${s.misses}✗ of ${s.scored} scored` : 'No scored trades yet'}
          accent="hit"
        />
        <StatCard
          label="FINAL DIR HIT"
          value={s.consensusHitRate != null ? `${s.consensusHitRate.toFixed(0)}%` : '—'}
          valueClass={hitRateColor(s.consensusHitRate)}
          sub={s.consensusScored ? `${s.consensusHits}✓ · ${s.consensusMisses}✗ of ${s.consensusScored} scored` : 'No final verdicts yet'}
          accent="hit"
        />
        <StatCard label="SKIPPED" value={String(s.skipped)} sub="NO-GO / skip verdicts" />
        <StatCard label="AWAIT PRICE" value={String(s.awaitingPrice)} sub={s.awaitingPrice ? 'Re-run log outcomes' : undefined} accent="warn" />
        <StatCard label="PENDING EPS" value={String(s.pendingEps)} />
      </div>

      <p className="text-[11px] text-fg-dim leading-relaxed max-w-3xl">
        <span className="text-fg-muted">Structure hit rate</span> scores only system trade setups (spreads, condors)
        against next-day price — not EPS beat/miss. Skip and watch rows are excluded. A HIT means the
        structure matched the move; it does not mean you should have traded if final verdict was NO-GO.
        <span className="text-fg-muted"> Final dir hit</span> scores saved AI Final Verdict UP/DOWN calls separately.
      </p>

      {s.recentMisses.length > 0 && (
        <div className="border border-border-subtle bg-bg-elevated p-3 sm:p-4 space-y-2">
          <h2 className="text-xs tracking-widest text-fg-subtle uppercase">Recent structure misses</h2>
          <ul className="space-y-2">
            {s.recentMisses.map(r => (
              <li key={r.brief_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <Link
                  href={`/briefs/${r.brief_id}?from=history`}
                  className="font-bold hover:text-signal-buy"
                >
                  {r.ticker}
                </Link>
                <span className="text-fg-dim">{r.earnings_date}</span>
                {r.final_action && !isSkipAction(r.final_action) ? (
                  <FinalActionBadge action={r.final_action} />
                ) : null}
                {r.next_day_close_pct != null && (
                  <span className="font-mono text-signal-sell">
                    DAY {r.next_day_close_pct > 0 ? '+' : ''}
                    {r.next_day_close_pct.toFixed(2)}%
                  </span>
                )}
                {r.beat_or_miss && (
                  <span className="text-fg-dim">EPS {r.beat_or_miss}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  valueClass = 'text-fg',
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  accent?: 'hit' | 'warn';
}) {
  const accentClass =
    accent === 'hit' ? 'stat-card-hit' : accent === 'warn' ? 'stat-card-warn' : '';
  return (
    <div className={`border border-border bg-bg-elevated px-3 py-2.5 min-w-0 ${accentClass}`}>
      <div className="text-[10px] text-fg-dim tracking-widest uppercase truncate">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${valueClass}`}>{value}</div>
      {sub ? <div className="text-[10px] text-fg-dim mt-0.5 leading-snug">{sub}</div> : null}
    </div>
  );
}
