import type { FilterResult } from '@/lib/screamTest';

const FILTER_LABELS: Record<string, string> = {
  chainConviction: 'Chain conviction',
  skewAlignment: 'IV skew (~25Δ)',
  beatHistory: 'Beat history + ESP',
  setupConfirmation: 'Setup / overhangs',
  sectorTailwind: 'Sector / peers',
};

type Props = {
  scream_score: number | null;
  scream_direction: string | null;
  scream_recommendation: string | null;
  scream_qualifies: boolean | null;
  scream_filters: Record<string, FilterResult> | null;
  scream_notes: string[] | null;
};

export function ScreamTestCard({
  scream_score,
  scream_direction,
  scream_recommendation,
  scream_qualifies,
  scream_filters,
  scream_notes,
}: Props) {
  if (
    scream_score == null ||
    !scream_filters ||
    scream_recommendation == null ||
    scream_direction == null
  ) {
    return (
      <section className="border border-border bg-bg-elevated p-6 border-dashed">
        <h2 className="text-xs tracking-widest text-fg-subtle mb-2">SCREAM TEST</h2>
        <p className="text-xs text-fg-muted">
          No scream test snapshot for this brief. Re-run{' '}
          <span className="text-fg-subtle font-bold">daily scan</span> after migrating the DB (
          <code className="text-fg-dim">0002_scream_test.sql</code>).
        </p>
      </section>
    );
  }

  const rec = scream_recommendation;
  const recClass =
    rec === 'calls'
      ? 'text-signal-buy'
      : rec === 'puts'
        ? 'text-signal-sell'
        : rec === 'stock-only'
          ? 'text-signal-watch'
          : 'text-fg-muted';

  return (
    <section className="border border-border bg-bg-elevated p-6">
      <div className="flex justify-between items-start gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-xs tracking-widest text-fg-subtle mb-1">SCREAM TEST</h2>
          <p className="text-[11px] text-fg-muted max-w-md">
            Separate from beat score: asks whether the{' '}
            <span className="text-fg-subtle">options chain</span> is directional enough to trade.
          </p>
        </div>
        <div className="text-right">
          <div
            className={`font-bold text-2xl tabular-nums ${
              scream_qualifies ? 'text-signal-buy' : 'text-fg-muted'
            }`}
          >
            {scream_score}/5
          </div>
          <div className="text-[11px] text-fg-dim capitalize mt-0.5">
            {scream_direction} · {scream_qualifies ? 'QUALIFIES' : 'below bar'}
          </div>
        </div>
      </div>

      <div className="space-y-2 text-xs font-mono">
        {(Object.entries(scream_filters) as [string, FilterResult][]).map(([key, f]) => (
          <div key={key} className="flex gap-2 items-start border-b border-border-subtle pb-2 last:border-0">
            <span className={f.passed ? 'text-signal-buy shrink-0' : 'text-fg-dim shrink-0'}>
              {f.passed ? '✓' : '✗'}
            </span>
            <span className="text-fg-subtle w-40 shrink-0">{FILTER_LABELS[key] ?? key}</span>
            <span className="text-fg-muted flex-1 min-w-0">{f.detail}</span>
          </div>
        ))}
      </div>

      {scream_notes && scream_notes.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-border-subtle space-y-1">
          {scream_notes.map((n, i) => (
            <li key={i} className="text-[11px] text-fg-dim">
              — {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-border-subtle font-mono text-xs">
        <span className="text-fg-dim uppercase tracking-widest">Recommendation </span>
        <span className={`font-bold tracking-wide ${recClass}`}>{rec.replace(/-/g, ' ')}</span>
      </div>
    </section>
  );
}
