import type { FilterResult, NarrativeOverhang } from '@/lib/screamTest';

const FILTER_LABELS: Record<string, string> = {
  chainConviction: 'Chain conviction',
  skewAlignment: 'IV skew (~25Δ)',
  beatHistory: 'Beat history + ESP',
  setupConfirmation: 'Setup / overhangs',
  sectorTailwind: 'Sector / peers',
};

/** JSON/DB may reorder keys; keep filter rows in design order. */
const FILTER_ROW_ORDER = [
  'chainConviction',
  'skewAlignment',
  'beatHistory',
  'setupConfirmation',
  'sectorTailwind',
] as const;

/** Display labels aligned with beat-score badge (ALL CAPS trade vocabulary). */
function formatScreamGate(rec: string): string {
  const r = rec.toLowerCase();
  if (r === 'skip') return 'SKIP';
  if (r === 'stock-only') return 'STOCK ONLY';
  if (r === 'calls') return 'CALLS';
  if (r === 'puts') return 'PUTS';
  return rec.replace(/-/g, ' ').toUpperCase();
}

/** When we render full narrative rows below, hide duplicate one-line triggers under Setup. */
function triggersForRow(
  key: string,
  f: { triggers?: string[] },
  unresolvedOverhangs: NarrativeOverhang[] | null | undefined
): string[] | undefined {
  const t = f.triggers;
  if (!t?.length) return undefined;
  if (key !== 'setupConfirmation' || !unresolvedOverhangs?.length) return t;
  return t.filter(
    line =>
      line.startsWith('Insider selling') ||
      line.startsWith('Regulatory /') ||
      line.startsWith('Stretched valuation')
  );
}

type Props = {
  scream_score: number | null;
  scream_direction: string | null;
  scream_recommendation: string | null;
  scream_qualifies: boolean | null;
  scream_filters: Record<string, FilterResult> | null;
  scream_notes: string[] | null;
  /** From `raw_fmp.screamUnresolvedOverhangs` after daily scan v2. */
  unresolvedOverhangs?: NarrativeOverhang[] | null;
};

export function ScreamTestCard({
  scream_score,
  scream_direction,
  scream_recommendation,
  scream_qualifies,
  scream_filters,
  scream_notes,
  unresolvedOverhangs,
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
        {FILTER_ROW_ORDER.map(key => {
          const f = scream_filters[key];
          if (!f) return null;
          const rowTriggers = triggersForRow(key, f, unresolvedOverhangs);
          return (
            <div
              key={key}
              className="space-y-1 border-b border-border-subtle pb-2 last:border-0"
            >
              <div className="flex gap-2 items-start">
                <span className={f.passed ? 'text-signal-buy shrink-0' : 'text-fg-dim shrink-0'}>
                  {f.passed ? '✓' : '✗'}
                </span>
                <span className="text-fg-subtle w-40 shrink-0">{FILTER_LABELS[key] ?? key}</span>
                <span className="text-fg-muted flex-1 min-w-0">{f.detail}</span>
              </div>
              {rowTriggers && rowTriggers.length > 0 && (
                <ul className="pl-6 ml-40 text-fg-dim space-y-0.5">
                  {rowTriggers.map((t, j) => (
                    <li key={j} className="text-[10px] leading-snug flex gap-1">
                      <span className="text-fg-dim shrink-0">·</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {unresolvedOverhangs && unresolvedOverhangs.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border-subtle">
          <div className="text-[10px] tracking-widest text-fg-subtle mb-1">
            UNRESOLVED NARRATIVE RISKS
          </div>
          <p className="text-[10px] text-fg-dim mb-2 max-w-xl leading-relaxed">
            From the daily scan: FMP stable stock news (keyword buckets) plus Alpaca daily bars
            to tag same-window drawdowns. “Unresolved” means no matching resolution headline in
            the following ~14 days.
          </p>
          <ul className="space-y-2 text-[11px] text-fg-muted">
            {unresolvedOverhangs.map((o, i) => (
              <li key={i} className="border-l-2 border-signal-sell/40 pl-2">
                <span className="text-fg-subtle uppercase text-[10px]">
                  {o.category.replace(/_/g, ' ')}
                </span>
                <span className="text-fg-dim mx-1">·</span>
                <span>{o.detectedDate}</span>
                {o.drawdownPct != null && (
                  <span className="text-fg-dim"> (−{o.drawdownPct}%)</span>
                )}
                <div className="text-fg-muted mt-0.5 font-normal">{o.description}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scream_notes && scream_notes.length > 0 && (
        <ul className="mt-4 pt-3 border-t border-border-subtle space-y-1">
          {scream_notes.map((n, i) => (
            <li key={i} className="text-[11px] text-fg-dim">
              — {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 pt-3 border-t border-border-subtle">
        <div className="text-[10px] text-fg-dim uppercase tracking-widest mb-1">
          Scream options gate
        </div>
        <div className="font-mono text-xs">
          <span className={`font-bold tracking-wide ${recClass}`}>{formatScreamGate(rec)}</span>
        </div>
        <p className="text-[10px] text-fg-dim mt-1 max-w-md leading-relaxed">
          Separate from the beat-score badge and suggested structure: only whether directional
          options (long call/put) meet the 4/5 filter bar.
        </p>
      </div>
    </section>
  );
}
