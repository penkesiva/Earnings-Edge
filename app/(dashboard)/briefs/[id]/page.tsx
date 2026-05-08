import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { FinalActionBadge, SignalBadge } from '@/components/SignalBadge';
import { ScreamTestCard } from '@/components/ScreamTestCard';
import { ScanDiffBanner } from '@/components/ScanDiffBanner';
import type { FilterResult, NarrativeOverhang } from '@/lib/screamTest';
import type { BriefScanRow } from '@/lib/scanDiff';

export const dynamic = 'force-dynamic';

const COMPONENT_LABELS: Record<string, string> = {
  beat_streak_score: 'Beat Frequency (last 4Q)',
  surprise_magnitude_score: 'Surprise Magnitude',
  revision_trend_score: 'Analyst Revisions (30d)',
  whisper_delta_score: 'Whisper vs Consensus',
  iv_rank_score: 'IV Rank (inverted)',
  sector_momentum_score: 'Sector Momentum (5d)',
  insider_score: 'Insider Buying (90d)',
};

export default async function BriefPage({ params }: { params: { id: string } }) {
  const sb = supabaseAdmin();
  const { data: brief } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!brief) notFound();

  const { data: outcome } = await sb
    .from('earnings_outcomes')
    .select('*')
    .eq('brief_id', params.id)
    .maybeSingle();

  // Two most recent scans for this ticker (for flip detection)
  const { data: scans } = await sb
    .from('brief_scans')
    .select('id, ticker, scan_timestamp, reconciled_action, scream_score, iv_rank, directional_bias')
    .eq('ticker', brief.ticker)
    .order('scan_timestamp', { ascending: false })
    .limit(2);
  const scanRows = (scans ?? []) as BriefScanRow[];

  const components = [
    'beat_streak_score',
    'surprise_magnitude_score',
    'revision_trend_score',
    'whisper_delta_score',
    'iv_rank_score',
    'sector_momentum_score',
    'insider_score',
  ];

  const reasoning = brief.reasoning?.split(' · ') || [];
  const structure = brief.suggested_structure as any;
  const rawFmp = brief.raw_fmp as { screamUnresolvedOverhangs?: NarrativeOverhang[] } | null;
  const screamUnresolved = rawFmp?.screamUnresolvedOverhangs ?? null;

  const finalAction: string | null = brief.final_action ?? null;
  const finalRationale: string | null = brief.final_action_rationale ?? null;
  // Older briefs predate reconcile — fall back gracefully to old structure action
  const legacyFallback = !finalAction;

  return (
    <div className="space-y-8">
      <Link href="/" className="text-xs text-fg-subtle hover:text-fg">
        ← BACK
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-l-4 border-signal-buy pl-4 sm:pl-6">
        <div className="text-xs text-fg-subtle tracking-widest mb-2">
          EARNINGS BRIEF · {brief.earnings_date}
        </div>
        <div className="flex flex-wrap items-baseline gap-3 sm:gap-6 mb-4">
          <h1 className="text-4xl sm:text-5xl font-bold">{brief.ticker}</h1>
          <div className="text-2xl sm:text-3xl text-fg-muted">
            ${brief.spot_price?.toFixed(2)}
          </div>
        </div>
        <div className="text-2xl font-bold">
          SCORE <span className={scoreColor(brief.composite_score)}>{brief.composite_score}</span>
          <span className="text-fg-subtle text-base ml-2">/ 100</span>
        </div>
      </div>

      {/* ── Flip banner (above everything else when critical) ──────────────── */}
      <ScanDiffBanner ticker={brief.ticker} scans={scanRows} />

      {/* ── Final action ───────────────────────────────────────────────────── */}
      <section className="border border-border bg-bg-elevated p-6">
        <div className="text-xs tracking-widest text-fg-subtle mb-3">TRADE ACTION</div>
        {legacyFallback ? (
          <div className="text-xs text-fg-dim">
            Re-run daily scan to generate a reconciled action for this brief.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-3">
              <FinalActionBadge action={finalAction} />
              <span className="text-[10px] text-fg-dim max-w-lg leading-relaxed">
                {finalRationale}
              </span>
            </div>
          </>
        )}
      </section>

      {/* ── Stats grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        <Stat label="IV 30d" value={`${(brief.iv_30d * 100).toFixed(1)}%`} />
        <Stat label="IV Rank" value={brief.iv_rank} />
        <Stat label="Expected Move" value={`±$${brief.expected_move_dollar?.toFixed(2)}`} sub={`${brief.expected_move_pct?.toFixed(1)}%`} />
        <Stat label="P/C Ratio (vol)" value={brief.put_call_ratio?.toFixed(2)} />
      </div>

      {/* ── Outcome (if logged) ────────────────────────────────────────────── */}
      {outcome && (
        <section className="border border-border bg-bg-elevated p-6">
          <h2 className="text-xs tracking-widest text-fg-subtle mb-4">OUTCOME</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-fg-subtle text-xs">RESULT</div>
              <div className={`font-bold ${outcome.beat_or_miss === 'BEAT' ? 'text-signal-buy' : outcome.beat_or_miss === 'MISS' ? 'text-signal-sell' : 'text-fg-muted'}`}>
                {outcome.beat_or_miss}
              </div>
            </div>
            <div>
              <div className="text-fg-subtle text-xs">NEXT-DAY</div>
              <div className={outcome.next_day_close_pct > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                {outcome.next_day_close_pct?.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-fg-subtle text-xs">P&L</div>
              <div className={outcome.trade_pnl > 0 ? 'text-signal-buy' : 'text-signal-sell'}>
                ${outcome.trade_pnl?.toFixed(2) ?? '—'}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── AUDIT ──────────────────────────────────────────────────────────── */}
      <details className="group border border-border-subtle">
        <summary className="cursor-pointer px-4 py-3 text-xs tracking-widest text-fg-subtle bg-bg-elevated flex items-center justify-between select-none">
          <span>AUDIT — component signals</span>
          <span className="text-fg-dim group-open:rotate-180 transition-transform">▾</span>
        </summary>

        <div className="border-t border-border-subtle space-y-8 p-4 sm:p-6">

          {/* Scream test */}
          <ScreamTestCard
            scream_score={brief.scream_score}
            scream_direction={brief.scream_direction}
            scream_recommendation={brief.scream_recommendation}
            scream_qualifies={brief.scream_qualifies}
            scream_filters={(brief.scream_filters as Record<string, FilterResult> | null) ?? null}
            scream_notes={(brief.scream_notes as string[] | null) ?? null}
            unresolvedOverhangs={screamUnresolved}
          />

          {/* Beat score components */}
          <section>
            <div className="text-xs tracking-widest text-fg-subtle mb-1">BEAT SCORE COMPONENTS</div>
            <div className="flex items-center gap-2 mb-4">
              <SignalBadge
                signal={brief.signal}
                structureAction={structure?.action ?? null}
              />
              <span className="text-[10px] text-fg-dim">beat score signal · composite {brief.composite_score}</span>
            </div>
            <div className="space-y-3">
              {components.map(key => (
                <ComponentBar
                  key={key}
                  label={COMPONENT_LABELS[key]}
                  value={brief[key]}
                />
              ))}
            </div>
          </section>

          {/* Reasoning */}
          {reasoning.length > 0 && (
            <section>
              <div className="text-xs tracking-widest text-fg-subtle mb-3">BEAT SCORE SIGNALS</div>
              <ul className="space-y-2">
                {reasoning.map((r: string, i: number) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-signal-buy">▸</span>
                    <span className="text-fg-muted">{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suggested structure (legacy / audit) */}
          {structure && (
            <section>
              <div className="text-xs tracking-widest text-fg-subtle mb-3">
                BEAT-SCORE SUGGESTED STRUCTURE
              </div>

              {(() => {
                // Determine if this structure is overridden by scream/IV gate
                const isOverridden = finalAction === 'SKIP' || finalAction === 'IRON_CONDOR';
                // Detect directional conflict: beat score is bullish (call structure) but
                // scream direction is bearish, or vice versa.
                const structureIsBullish =
                  structure.action === 'CALL_DEBIT_SPREAD' || structure.action === 'LONG_CALL';
                const screamIsBearish = brief.scream_direction === 'bearish';
                const screamIsBullish = brief.scream_direction === 'bullish';
                const hasDirectionalConflict =
                  (structureIsBullish && screamIsBearish) ||
                  (!structureIsBullish && screamIsBullish);

                const rationale = structure.action !== 'SKIP'
                  ? brief.composite_score < 60
                    ? `Marginal score (${brief.composite_score}) — structure shown for reference only, not for trading without scream confirmation.`
                    : brief.composite_score >= 75
                      ? `High-conviction score (${brief.composite_score}) with directional bias — controlled-risk spread.`
                      : structure.rationale
                  : structure.rationale;

                return (
                  <>
                    {isOverridden && (
                      <div className="mb-3 border border-signal-sell/40 bg-signal-sell/5 px-3 py-2 text-xs text-signal-sell tracking-wide">
                        ⚡ OVERRIDDEN BY SCREAM / IV GATE — structure shown for audit only. Do not trade.
                      </div>
                    )}
                    {hasDirectionalConflict && (
                      <div className="mb-3 border border-signal-watch/40 bg-signal-watch/5 px-3 py-2 text-xs text-signal-watch tracking-wide">
                        ⚠ DIRECTIONAL CONFLICT — beat score is{' '}
                        {structureIsBullish ? 'bullish' : 'bearish'} but options chain shows{' '}
                        {screamIsBearish ? 'bearish' : 'bullish'} conviction. Legs suppressed.
                      </div>
                    )}
                    <div className={`text-xl font-bold mb-1 ${isOverridden ? 'opacity-40 line-through' : ''}`}>
                      {structure.action?.replace(/_/g, ' ')}
                    </div>
                    <p className="text-fg-muted text-sm mb-4">{rationale}</p>

                    {/* Suppress legs when overridden OR when there's a directional conflict */}
                    {structure.legs && !isOverridden && !hasDirectionalConflict && (
                      <div className="border border-border-subtle overflow-x-auto mb-4">
                        <div className="grid grid-cols-4 gap-4 px-4 py-2 bg-bg text-xs text-fg-subtle tracking-widest">
                          <div>SIDE</div><div>TYPE</div><div>STRIKE</div><div>EXPIRY</div>
                        </div>
                        {structure.legs.map((leg: any, i: number) => (
                          <div key={i} className="grid grid-cols-4 gap-4 px-4 py-3 text-sm border-t border-border-subtle">
                            <div className={leg.side === 'BUY' ? 'text-signal-buy font-bold' : 'text-signal-sell font-bold'}>
                              {leg.side}
                            </div>
                            <div>{leg.type}</div>
                            <div>${leg.strike}</div>
                            <div className="text-fg-muted">{leg.expiry}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {structure.notes?.length > 0 && !isOverridden && !hasDirectionalConflict && (
                      <ul className="space-y-1">
                        {structure.notes.map((n: string, i: number) => (
                          <li key={i} className="text-xs text-fg-subtle">— {n}</li>
                        ))}
                      </ul>
                    )}
                  </>
                );
              })()}
            </section>
          )}

        </div>
      </details>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="bg-bg-elevated p-4">
      <div className="text-xs text-fg-subtle tracking-widest mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-fg-muted mt-1">{sub}</div>}
    </div>
  );
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 65 ? 'bg-signal-buy' :
    value >= 40 ? 'bg-signal-watch' :
    'bg-signal-sell';
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      <div className="w-32 sm:w-48 text-xs text-fg-muted">{label}</div>
      <div className="flex-1 h-2 bg-bg overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <div className="w-12 text-right text-xs font-bold">{value}</div>
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 65) return 'text-signal-buy';
  if (score >= 40) return 'text-signal-watch';
  return 'text-signal-sell';
}
