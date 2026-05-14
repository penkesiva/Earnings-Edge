import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { FinalActionBadge, SignalBadge } from '@/components/SignalBadge';
import { ScreamTestCard } from '@/components/ScreamTestCard';
import { ScanDiffBanner } from '@/components/ScanDiffBanner';
import { RescanBriefButton } from '@/components/RescanBriefButton';
import { AiBriefAnalysis, type SavedAnalyses } from '@/components/AiBriefAnalysis';
import { getStockSnapshot } from '@/lib/alpaca';
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

  // Fetch all saved AI analyses and filter in JS — PostgREST UUID .eq() filter
  // returns empty rows on this table despite data existing (schema cache quirk).
  const { data: allAiRows } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, provider, analysis_text');

  const aiRows = (allAiRows ?? []).filter(r => r.brief_id === params.id);

  const savedAnalyses: SavedAnalyses = {};
  for (const row of aiRows ?? []) {
    const p = row.provider as string;
    if (p === 'openai' || p === 'gemini' || p === 'claude') {
      savedAnalyses[p as 'openai' | 'gemini' | 'claude'] = row.analysis_text as string;
    }
  }

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

  // Fetch live price — Alpaca latestTrade, falls back to stored scan price if unavailable.
  let livePrice: number | null = null;
  try {
    const snap = await getStockSnapshot(brief.ticker);
    if (snap.price > 0) livePrice = snap.price;
  } catch {
    // Non-fatal — display falls back to scan-time price below.
  }
  const displayPrice = livePrice ?? brief.spot_price;

  const finalAction: string | null = brief.final_action ?? null;
  const finalRationale: string | null = brief.final_action_rationale ?? null;
  // Older briefs predate reconcile — fall back gracefully to old structure action
  const legacyFallback = !finalAction;

  const preferredExpiry: string | null =
    structure?.preferredExpiry ?? structure?.legs?.[0]?.expiry ?? null;

  return (
    <div className="space-y-8">
      <Link href="/" className="text-xs text-fg-subtle hover:text-fg">
        ← BACK
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-l-4 border-signal-buy pl-4 sm:pl-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="text-xs text-fg-subtle tracking-widest">
            EARNINGS BRIEF · {brief.earnings_date}
          </div>
          <RescanBriefButton ticker={brief.ticker} earningsDate={brief.earnings_date} />
        </div>
        <div className="flex flex-wrap items-baseline gap-3 sm:gap-6 mb-4">
          <h1 className="text-4xl sm:text-5xl font-bold">{brief.ticker}</h1>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl sm:text-3xl text-fg-muted">
              ${displayPrice?.toFixed(2)}
            </div>
            {livePrice !== null ? (
              <span className="text-xs text-emerald-400 tracking-wide">LIVE</span>
            ) : (
              <span className="text-xs text-fg-dim tracking-wide" title="Live price unavailable — showing scan-time price">AT SCAN</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold">
            SCORE <span className={scoreColor(brief.composite_score)}>{brief.composite_score}</span>
            <span className="text-fg-subtle text-base ml-2">/ 100</span>
          </div>
          <div className="text-xs text-fg-dim mt-1">
            {beatProbabilityLabel(brief.composite_score)}
          </div>
          <BriefInsightStrip
            compositeScore={brief.composite_score}
            finalAction={finalAction}
            ivRank={brief.iv_rank ?? null}
            putCallRatio={brief.put_call_ratio ?? null}
            expectedMovePct={brief.expected_move_pct ?? null}
            expectedMoveDollar={brief.expected_move_dollar ?? null}
            spot={brief.spot_price ?? null}
            preferredExpiry={preferredExpiry}
            screamDirection={brief.scream_direction ?? null}
            screamScore={brief.scream_score ?? null}
            overhangs={screamUnresolved}
          />
          <AiBriefAnalysis savedAnalyses={savedAnalyses} brief={{
            brief_id:                 brief.id,
            ticker:                   brief.ticker,
            earnings_date:            brief.earnings_date,
            composite_score:          brief.composite_score,
            beat_streak_score:        brief.beat_streak_score,
            surprise_magnitude_score: brief.surprise_magnitude_score,
            revision_trend_score:     brief.revision_trend_score,
            whisper_delta_score:      brief.whisper_delta_score,
            iv_rank_score:            brief.iv_rank_score,
            sector_momentum_score:    brief.sector_momentum_score,
            insider_score:            brief.insider_score,
            iv_rank:                  brief.iv_rank,
            iv_30d:                   brief.iv_30d,
            expected_move_dollar:     brief.expected_move_dollar,
            expected_move_pct:        brief.expected_move_pct,
            put_call_ratio:           brief.put_call_ratio,
            scream_direction:         brief.scream_direction,
            scream_score:             brief.scream_score,
            scream_qualifies:         brief.scream_qualifies,
            scream_notes:             brief.scream_notes,
            final_action:             brief.final_action,
            final_action_rationale:   brief.final_action_rationale,
            overhangs:                screamUnresolved ?? [],
            raw_headlines:            (brief.raw_headlines as { date: string; title: string; source: string }[] | null) ?? null,
          }} />
        </div>
      </div>

      {/* ── Flip banner (above everything else when critical) ──────────────── */}
      <ScanDiffBanner ticker={brief.ticker} scans={scanRows} />

      {/* ── Final action ───────────────────────────────────────────────────── */}
      <section className="border border-border bg-bg-elevated p-6">
        <div className="text-xs tracking-widest text-fg-subtle mb-4">TRADE DECISION</div>
        {legacyFallback ? (
          <div className="text-xs text-fg-dim">
            Re-run scan to generate a reconciled action for this brief.
          </div>
        ) : (
          <TradeDecisionCard
            action={finalAction}
            rationale={finalRationale}
            screamDirection={brief.scream_direction ?? null}
            screamScore={brief.scream_score ?? null}
            compositeScore={brief.composite_score ?? null}
            expectedMoveDollar={brief.expected_move_dollar ?? null}
            expectedMovePct={brief.expected_move_pct ?? null}
            ivRank={brief.iv_rank ?? null}
            spot={brief.spot_price ?? null}
            preferredExpiry={preferredExpiry}
          />
        )}
      </section>

      {/* ── Stats grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        <Stat label="IV 30d" value={`${(brief.iv_30d * 100).toFixed(1)}%`} />
        <Stat label="IV Rank" value={brief.iv_rank} />
        <Stat label="Expected Move" value={`±$${brief.expected_move_dollar?.toFixed(2)}`} sub={`${brief.expected_move_pct?.toFixed(1)}%`} />
        <Stat label="P/C Ratio (all strikes)" value={brief.put_call_ratio?.toFixed(2)} />
      </div>

      {/* ── News Sentiment ─────────────────────────────────────────────────── */}
      <NewsSentimentSection overhangs={screamUnresolved} />

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
            <div className="text-xs tracking-widest text-fg-subtle mb-1">BEAT SCORE — HOW LIKELY TO BEAT EARNINGS?</div>
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

          {/* Suggested structure (audit only — shown only when beat-score disagrees with reconciled) */}
          {structure && (
            <section>
              <div className="text-xs tracking-widest text-fg-subtle mb-3">
                BEAT-SCORE SUGGESTED STRUCTURE
              </div>

              {(() => {
                // Overridden = reconcile engine picked a different (or no-trade) path.
                // When the reconcile action matches the beat-score action exactly,
                // suppress the audit section — it would just repeat what's already shown above.
                const noTradeActions = new Set([
                  'SKIP', 'SKIP_NO_EDGE', 'SKIP_CONFLICT',
                  'SKIP_ASYMMETRIC_DOWNSIDE_RISK', 'SKIP_ASYMMETRIC_UPSIDE_RISK',
                  'BEARISH_WATCH', 'BULLISH_WATCH', 'IRON_CONDOR',
                ]);
                const isOverridden = !finalAction || noTradeActions.has(finalAction);

                // If reconcile and beat-score agree, skip the duplicate section.
                if (!isOverridden && finalAction === structure.action) {
                  return (
                    <p className="text-xs text-fg-dim">
                      ✓ Beat score agrees with the reconciled action — no additional audit needed.
                    </p>
                  );
                }
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

function roundStrike(price: number): number {
  if (price < 25) return Math.round(price * 2) / 2;
  if (price < 200) return Math.round(price);
  return Math.round(price / 5) * 5;
}

// Multipliers for short-vol structures. Shorts placed at 1.25× expected move
// (≈ 1.25 standard deviations OTM) so they're meaningfully outside the
// straddle expected move, not sitting on it. Longs at 1.75× as protective
// wings.
const SHORT_LEG_MULT = 1.25;
const LONG_LEG_MULT  = 1.75;

function StructureLegsTable({
  legs, expiry, footnote,
}: {
  legs: ReadonlyArray<{ side: 'BUY' | 'SELL'; type: 'CALL' | 'PUT'; strike: number }>;
  expiry: string;
  footnote: string;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-widest text-fg-subtle mb-2">STRUCTURE</div>
      <div className="border border-border-subtle overflow-x-auto mb-2">
        <div className="grid grid-cols-4 gap-4 px-4 py-2 bg-bg text-xs text-fg-subtle tracking-widest">
          <div>SIDE</div><div>TYPE</div><div>STRIKE</div><div>EXPIRY</div>
        </div>
        {legs.map((leg, i) => (
          <div key={i} className="grid grid-cols-4 gap-4 px-4 py-3 text-sm border-t border-border-subtle">
            <div className={leg.side === 'BUY' ? 'text-signal-buy font-bold' : 'text-signal-sell font-bold'}>
              {leg.side}
            </div>
            <div>{leg.type}</div>
            <div>${leg.strike}</div>
            <div className="text-fg-muted">{expiry}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-dim">{footnote}</p>
    </div>
  );
}

function CondorLegsTable({
  spot, expectedMoveDollar, expiry,
}: {
  spot: number;
  expectedMoveDollar: number;
  expiry: string | null;
}) {
  if (!expiry) return null;
  const shortCall = roundStrike(spot + expectedMoveDollar * SHORT_LEG_MULT);
  const longCall  = roundStrike(spot + expectedMoveDollar * LONG_LEG_MULT);
  const shortPut  = roundStrike(spot - expectedMoveDollar * SHORT_LEG_MULT);
  const longPut   = roundStrike(spot - expectedMoveDollar * LONG_LEG_MULT);

  return (
    <StructureLegsTable
      expiry={expiry}
      legs={[
        { side: 'BUY',  type: 'PUT',  strike: longPut },
        { side: 'SELL', type: 'PUT',  strike: shortPut },
        { side: 'SELL', type: 'CALL', strike: shortCall },
        { side: 'BUY',  type: 'CALL', strike: longCall },
      ]}
      footnote={
        `Shorts placed at ±$${(expectedMoveDollar * SHORT_LEG_MULT).toFixed(2)} ` +
        `(${SHORT_LEG_MULT}× expected move); long wings at ±$${(expectedMoveDollar * LONG_LEG_MULT).toFixed(2)}. ` +
        `Profit if stock stays within the short strikes. ` +
        `Verify strikes safely exceed the straddle expected move before entry.`
      }
    />
  );
}

function PutCreditSpreadLegsTable({
  spot, expectedMoveDollar, expiry,
}: {
  spot: number;
  expectedMoveDollar: number;
  expiry: string | null;
}) {
  if (!expiry) return null;
  const shortPut = roundStrike(spot - expectedMoveDollar * SHORT_LEG_MULT);
  const longPut  = roundStrike(spot - expectedMoveDollar * LONG_LEG_MULT);
  return (
    <StructureLegsTable
      expiry={expiry}
      legs={[
        { side: 'BUY',  type: 'PUT', strike: longPut },
        { side: 'SELL', type: 'PUT', strike: shortPut },
      ]}
      footnote={
        `Short put at $${shortPut} (≈${SHORT_LEG_MULT}× expected move below spot); ` +
        `protective long put at $${longPut}. Max profit if stock closes above $${shortPut}. ` +
        `Bullish bias — bets stock will hold support and IV will crush.`
      }
    />
  );
}

function CallCreditSpreadLegsTable({
  spot, expectedMoveDollar, expiry,
}: {
  spot: number;
  expectedMoveDollar: number;
  expiry: string | null;
}) {
  if (!expiry) return null;
  const shortCall = roundStrike(spot + expectedMoveDollar * SHORT_LEG_MULT);
  const longCall  = roundStrike(spot + expectedMoveDollar * LONG_LEG_MULT);
  return (
    <StructureLegsTable
      expiry={expiry}
      legs={[
        { side: 'SELL', type: 'CALL', strike: shortCall },
        { side: 'BUY',  type: 'CALL', strike: longCall },
      ]}
      footnote={
        `Short call at $${shortCall} (≈${SHORT_LEG_MULT}× expected move above spot); ` +
        `protective long call at $${longCall}. Max profit if stock closes below $${shortCall}. ` +
        `Bearish bias — bets stock won't rally and IV will crush.`
      }
    />
  );
}

// Long debit spreads: buy ATM, sell at expected move (cap the cost, set the target).
function CallDebitSpreadLegsTable({
  spot, expectedMoveDollar, expiry,
}: {
  spot: number;
  expectedMoveDollar: number;
  expiry: string | null;
}) {
  if (!expiry) return null;
  const longCall  = roundStrike(spot);
  const shortCall = roundStrike(spot + expectedMoveDollar);
  return (
    <StructureLegsTable
      expiry={expiry}
      legs={[
        { side: 'BUY',  type: 'CALL', strike: longCall },
        { side: 'SELL', type: 'CALL', strike: shortCall },
      ]}
      footnote={
        `Buy ATM call at $${longCall}; sell OTM call at $${shortCall} ` +
        `(≈1× expected move above spot). Max gain capped at the spread width. ` +
        `Debit spread reduces cost vs naked long call — suitable when IV is elevated.`
      }
    />
  );
}

function PutDebitSpreadLegsTable({
  spot, expectedMoveDollar, expiry,
}: {
  spot: number;
  expectedMoveDollar: number;
  expiry: string | null;
}) {
  if (!expiry) return null;
  const longPut  = roundStrike(spot);
  const shortPut = roundStrike(spot - expectedMoveDollar);
  return (
    <StructureLegsTable
      expiry={expiry}
      legs={[
        { side: 'BUY',  type: 'PUT', strike: longPut },
        { side: 'SELL', type: 'PUT', strike: shortPut },
      ]}
      footnote={
        `Buy ATM put at $${longPut}; sell OTM put at $${shortPut} ` +
        `(≈1× expected move below spot). Max gain capped at the spread width. ` +
        `Debit spread reduces cost vs naked long put — suitable when IV is elevated.`
      }
    />
  );
}

function TradeDecisionCard({
  action, rationale, screamDirection, screamScore,
  compositeScore, expectedMoveDollar, expectedMovePct, ivRank,
  spot, preferredExpiry,
}: {
  action: string | null;
  rationale: string | null;
  screamDirection: string | null;
  screamScore: number | null;
  compositeScore: number | null;
  expectedMoveDollar: number | null;
  expectedMovePct: number | null;
  ivRank: number | null;
  spot: number | null;
  preferredExpiry: string | null;
}) {
  // Classify the action into display buckets.
  const SKIP_ACTIONS = new Set([
    'SKIP', 'SKIP_NO_EDGE', 'SKIP_CONFLICT',
    'SKIP_ASYMMETRIC_DOWNSIDE_RISK', 'SKIP_ASYMMETRIC_UPSIDE_RISK',
  ]);
  const isSkip       = !action || SKIP_ACTIONS.has(action);
  const isConflict   = action === 'SKIP_CONFLICT';
  const isDownRisk   = action === 'SKIP_ASYMMETRIC_DOWNSIDE_RISK';
  const isUpRisk     = action === 'SKIP_ASYMMETRIC_UPSIDE_RISK';
  const isWatchBear  = action === 'BEARISH_WATCH';
  const isWatchBull  = action === 'BULLISH_WATCH';
  const isWatch      = isWatchBear || isWatchBull;
  const isCondor     = action === 'IRON_CONDOR';
  const isPutCredit  = action === 'PUT_CREDIT_SPREAD';
  const isCallCredit = action === 'CALL_CREDIT_SPREAD';
  const isBullish    = action === 'LONG_CALL' || action === 'CALL_DEBIT_SPREAD';
  const isBearish    = action === 'LONG_PUT'  || action === 'PUT_DEBIT_SPREAD';
  const isShortVol   = isCondor || isPutCredit || isCallCredit;

  const tradeLabel  = isSkip      && isConflict  ? 'SKIP — CONFLICTING SIGNALS'
                    : isSkip      && isDownRisk   ? 'SKIP — DOWNSIDE RISK'
                    : isSkip      && isUpRisk     ? 'SKIP — UPSIDE RISK'
                    : isSkip                      ? 'NO TRADE'
                    : isWatchBear                 ? 'WATCH — BEARISH'
                    : isWatchBull                 ? 'WATCH — BULLISH'
                    : isCondor                    ? 'SELL VOLATILITY'
                    : isPutCredit                 ? 'SELL VOL · BULLISH TILT'
                    : isCallCredit                ? 'SELL VOL · BEARISH TILT'
                    : isBullish                   ? 'TRADE · BULLISH'
                    : isBearish                   ? 'TRADE · BEARISH'
                    : 'TRADE';

  const tradeColor  = isDownRisk   ? 'text-signal-sell'
                    : isUpRisk     ? 'text-signal-buy'
                    : isConflict   ? 'text-signal-watch'
                    : isSkip       ? 'text-fg-subtle'
                    : isWatchBear  ? 'text-signal-sell'
                    : isWatchBull  ? 'text-signal-buy'
                    : isCondor     ? 'text-signal-watch'
                    : isPutCredit  ? 'text-signal-buy'
                    : isCallCredit ? 'text-signal-sell'
                    : isBullish    ? 'text-signal-buy'
                    : isBearish    ? 'text-signal-sell'
                    : 'text-fg';

  const borderColor = isDownRisk   ? 'border-signal-sell'
                    : isUpRisk     ? 'border-signal-buy'
                    : isConflict   ? 'border-signal-watch'
                    : isSkip       ? 'border-border'
                    : isWatchBear  ? 'border-signal-sell'
                    : isWatchBull  ? 'border-signal-buy'
                    : isCondor     ? 'border-signal-watch'
                    : isPutCredit  ? 'border-signal-buy'
                    : isCallCredit ? 'border-signal-sell'
                    : isBullish    ? 'border-signal-buy'
                    : isBearish    ? 'border-signal-sell'
                    : 'border-border';

  const instrument  = isSkip      ? '—'
                    : isWatch     ? 'Monitor — no trade yet'
                    : isCondor    ? 'Options (iron condor)'
                    : isPutCredit ? 'Options (put credit spread)'
                    : isCallCredit? 'Options (call credit spread)'
                    : isBullish || isBearish
                                  ? `Options (${action?.replace(/_/g, ' ').toLowerCase()})`
                    : '—';

  const shortStrike = spot != null && expectedMoveDollar != null
    ? (isPutCredit  ? spot - expectedMoveDollar * SHORT_LEG_MULT
      : isCallCredit ? spot + expectedMoveDollar * SHORT_LEG_MULT
      : null)
    : null;

  const prediction  = isBullish    ? `Expects stock to move UP beyond ±$${expectedMoveDollar?.toFixed(2)} (${expectedMovePct?.toFixed(1)}%)`
                    : isBearish    ? `Expects stock to move DOWN beyond ±$${expectedMoveDollar?.toFixed(2)} (${expectedMovePct?.toFixed(1)}%)`
                    : isCondor     ? `Expects stock to stay within ±$${expectedMoveDollar?.toFixed(2)} (${expectedMovePct?.toFixed(1)}%)`
                    : isPutCredit  ? `Expects stock to stay above $${roundStrike(shortStrike ?? 0)} (≈${SHORT_LEG_MULT}× expected move below spot)`
                    : isCallCredit ? `Expects stock to stay below $${roundStrike(shortStrike ?? 0)} (≈${SHORT_LEG_MULT}× expected move above spot)`
                    : isWatchBear  ? `Scream warns bearish but conviction or IV not yet at trade threshold — monitor for upgrade`
                    : isWatchBull  ? `Scream warns bullish but conviction or IV not yet at trade threshold — monitor for upgrade`
                    : `No tradeable edge — stay in cash`;

  return (
    <div className={`border-l-4 ${borderColor} pl-4 space-y-4`}>
      {/* Primary answer */}
      <div>
        <div className="text-[10px] tracking-widest text-fg-subtle mb-1">DECISION</div>
        <div className={`text-2xl font-bold tracking-wide ${tradeColor}`}>{tradeLabel}</div>
      </div>

      {/* Three key questions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-[10px] tracking-widest text-fg-subtle mb-1">INSTRUMENT</div>
          <div className="font-bold">{instrument}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-widest text-fg-subtle mb-1">PREDICTION</div>
          <div className="text-fg-muted text-xs leading-relaxed">{prediction}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-widest text-fg-subtle mb-1">SIGNAL STRENGTH</div>
          <div className="flex items-center gap-3 text-xs">
            <span>Scream <span className="font-bold">{screamScore ?? '—'}/5</span></span>
            <span className="text-fg-dim">·</span>
            <span>Score <span className="font-bold">{compositeScore ?? '—'}</span></span>
            <span className="text-fg-dim">·</span>
            <span>IVR <span className="font-bold">{ivRank ?? '—'}</span></span>
          </div>
        </div>
      </div>

      {/* Why */}
      {rationale && (
        <div>
          <div className="text-[10px] tracking-widest text-fg-subtle mb-1">WHY</div>
          <p className="text-xs text-fg-muted leading-relaxed">{rationale}</p>
        </div>
      )}

      {/* Render strike table for every actionable structure */}
      {spot != null && expectedMoveDollar != null && isCondor && (
        <CondorLegsTable spot={spot} expectedMoveDollar={expectedMoveDollar} expiry={preferredExpiry} />
      )}
      {spot != null && expectedMoveDollar != null && isPutCredit && (
        <PutCreditSpreadLegsTable spot={spot} expectedMoveDollar={expectedMoveDollar} expiry={preferredExpiry} />
      )}
      {spot != null && expectedMoveDollar != null && isCallCredit && (
        <CallCreditSpreadLegsTable spot={spot} expectedMoveDollar={expectedMoveDollar} expiry={preferredExpiry} />
      )}
      {spot != null && expectedMoveDollar != null && action === 'CALL_DEBIT_SPREAD' && (
        <CallDebitSpreadLegsTable spot={spot} expectedMoveDollar={expectedMoveDollar} expiry={preferredExpiry} />
      )}
      {spot != null && expectedMoveDollar != null && action === 'PUT_DEBIT_SPREAD' && (
        <PutDebitSpreadLegsTable spot={spot} expectedMoveDollar={expectedMoveDollar} expiry={preferredExpiry} />
      )}
      {spot != null && expectedMoveDollar != null && action === 'LONG_CALL' && preferredExpiry && (
        <StructureLegsTable
          legs={[{ side: 'BUY', type: 'CALL', strike: roundStrike(spot) }]}
          expiry={preferredExpiry}
          footnote={`Buy ATM call. Max gain: unlimited above $${roundStrike(spot)}. Max loss: premium paid.`}
        />
      )}
      {spot != null && expectedMoveDollar != null && action === 'LONG_PUT' && preferredExpiry && (
        <StructureLegsTable
          legs={[{ side: 'BUY', type: 'PUT', strike: roundStrike(spot) }]}
          expiry={preferredExpiry}
          footnote={`Buy ATM put. Max gain: stock going to zero. Max loss: premium paid.`}
        />
      )}
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

function ComponentBar({ label, value }: { label: string; value: number | null }) {
  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="w-32 sm:w-48 text-xs text-fg-muted">{label}</div>
        <div className="flex-1 h-2 bg-bg overflow-hidden" />
        <div className="w-12 text-right text-xs text-fg-dim">—</div>
      </div>
    );
  }
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

// ── Brief Insight Strip ───────────────────────────────────────────────────────

function BriefInsightStrip({
  compositeScore, finalAction, ivRank, putCallRatio,
  expectedMovePct, expectedMoveDollar, spot, preferredExpiry,
  screamDirection, screamScore, overhangs,
}: {
  compositeScore: number;
  finalAction: string | null;
  ivRank: number | null;
  putCallRatio: number | null;
  expectedMovePct: number | null;
  expectedMoveDollar: number | null;
  spot: number | null;
  preferredExpiry: string | null;
  screamDirection: string | null;
  screamScore: number | null;
  overhangs: NarrativeOverhang[] | null;
}) {
  // ── Beat probability ──────────────────────────────────────────────────────
  const beatLabel =
    compositeScore >= 65 ? 'LIKELY'      :
    compositeScore >= 50 ? 'POSSIBLE'    :
    compositeScore >= 35 ? 'UNLIKELY'    : 'LOW ODDS';
  const beatCls =
    compositeScore >= 65 ? 'text-signal-buy'   :
    compositeScore >= 50 ? 'text-signal-watch' : 'text-signal-sell';

  // ── Options flow (P/C ratio) ──────────────────────────────────────────────
  const pc = putCallRatio;
  const [flowLabel, flowCls] =
    pc === null                ? ['NO DATA',           'text-fg-dim']         :
    pc < 0.70                  ? ['CALL HEAVY ▲',      'text-signal-buy']     :
    pc < 0.90                  ? ['SLIGHT CALL LEAN',  'text-signal-buy/70']  :
    pc <= 1.10                 ? ['BALANCED',          'text-fg-muted']       :
    pc <= 1.40                 ? ['SLIGHT PUT LEAN',   'text-signal-sell/70'] :
                                 ['PUT HEAVY ▼',       'text-signal-sell'];
  const flowSub =
    pc === null  ? '' :
    pc < 1       ? `Call vol ${(1 / pc).toFixed(1)}× put vol` :
    pc > 1       ? `Put vol ${pc.toFixed(1)}× call vol` :
                   'Equal vol';

  // ── News sentiment ────────────────────────────────────────────────────────
  const risks = overhangs ?? [];
  const maxSev = risks.reduce((m, r) => Math.max(m, r.severity ?? 3), 0);
  const [newsLabel, newsCls] =
    risks.length === 0           ? ['CLEAN ✓',                  'text-signal-buy']   :
    risks.length <= 2 && maxSev <= 3 ? [`${risks.length} RISKS`,  'text-signal-watch'] :
                                   [`${risks.length} RISKS ⚠`,   'text-signal-sell'];
  const newsSub =
    risks.length === 0 ? 'no material risks' :
    maxSev >= 4 ? 'material headwinds' : 'monitor closely';

  // ── IV environment ────────────────────────────────────────────────────────
  const ivr = ivRank;
  const [ivLabel, ivCls] =
    ivr === null ? ['NO DATA',    'text-fg-dim']       :
    ivr >= 80    ? ['EXTREME',    'text-signal-sell']  :
    ivr >= 60    ? ['ELEVATED',   'text-signal-watch'] :
    ivr >= 40    ? ['MODERATE',   'text-fg-muted']     :
                   ['LOW',        'text-signal-buy'];
  const ivSub = ivr !== null ? `rank ${ivr}` : '';

  // ── Signal lean (from final action + scream) ──────────────────────────────
  const bullishActions = new Set([
    'LONG_CALL', 'CALL_DEBIT_SPREAD', 'PUT_CREDIT_SPREAD', 'BULLISH_WATCH',
    'SKIP_ASYMMETRIC_UPSIDE_RISK',
  ]);
  const bearishActions = new Set([
    'LONG_PUT', 'PUT_DEBIT_SPREAD', 'CALL_CREDIT_SPREAD', 'BEARISH_WATCH',
    'SKIP_ASYMMETRIC_DOWNSIDE_RISK',
  ]);

  const [leanLabel, leanCls] =
    finalAction && bullishActions.has(finalAction)  ? ['BULLISH ▲',     'text-signal-buy']   :
    finalAction && bearishActions.has(finalAction)  ? ['BEARISH ▼',     'text-signal-sell']  :
    finalAction === 'IRON_CONDOR'                   ? ['NEUTRAL ↔',     'text-signal-watch'] :
    finalAction === 'SKIP_CONFLICT'                 ? ['CONFLICTED',    'text-fg-muted']     :
                                                      ['UNCLEAR',       'text-fg-dim'];

  // ── Stock direction take ──────────────────────────────────────────────────
  const isBullish  = finalAction && bullishActions.has(finalAction);
  const isBearish  = finalAction && bearishActions.has(finalAction);
  const isNeutral  = finalAction === 'IRON_CONDOR';
  const isLongCall = finalAction === 'LONG_CALL';
  const isLongPut  = finalAction === 'LONG_PUT';

  // Dollar range: show ≈$X if available, fallback to %
  const movePctStr = expectedMovePct ? `±${expectedMovePct.toFixed(1)}%` : null;
  const moveDolStr = expectedMoveDollar ? `≈$${expectedMoveDollar.toFixed(2)}` : null;
  const moveStr    = moveDolStr && movePctStr ? `${moveDolStr} (${movePctStr})` : movePctStr ?? null;

  // Strong scream conviction note
  const screamNote = screamScore && screamScore >= 4 && screamDirection &&
    screamDirection !== 'none' && screamDirection !== 'mixed'
    ? ` · ${screamScore}/5 ${screamDirection} chain`
    : '';

  // IV implication (terse)
  const ivNote =
    ivr === null      ? '' :
    ivr >= 80         ? ' · Extreme IV — sell premium over buying' :
    ivr >= 60         ? ' · High IV — spreads over naked' :
                        '';

  let directionTake: string;
  let directionCls: string;
  if (isBullish) {
    directionTake = `Likely UP${moveStr ? ` ${moveStr}` : ''}${screamNote}${ivNote}`;
    directionCls = 'text-signal-buy';
  } else if (isBearish) {
    directionTake = `Likely DOWN${moveStr ? ` ${moveStr}` : ''}${screamNote}${ivNote}`;
    directionCls = 'text-signal-sell';
  } else if (isNeutral) {
    directionTake = `Contained${moveStr ? ` ${moveStr}` : ''} — vol crush expected${ivNote}`;
    directionCls = 'text-signal-watch';
  } else {
    directionTake = `Direction unclear${moveStr ? ` — market pricing ${moveStr}` : ''}${ivNote}`;
    directionCls = 'text-fg-muted';
  }

  // ── Beat ↔ direction tension note ─────────────────────────────────────────
  // Surfaces sell-the-news or buy-the-rumor setups explicitly.
  let tensionNote: string | null = null;
  if (isBearish && compositeScore >= 65) {
    tensionNote = `Beat ${beatLabel} but chain bearish — classic sell-the-news setup`;
  } else if (isBullish && compositeScore < 40) {
    tensionNote = `Beat ${beatLabel} but chain bullish — buy-the-rumor momentum play`;
  } else if (isNeutral && compositeScore >= 65) {
    tensionNote = `Beat ${beatLabel} — IV crush likely to offset any directional move`;
  }

  // ── Naked-option suggestion (LONG_CALL / LONG_PUT only) ───────────────────
  // Compute ATM strike the same way the legs table does: round spot to nearest
  // standard increment. Also show a slightly OTM alternative for higher leverage.
  let nakedOptionLine: React.ReactNode = null;
  if ((isLongCall || isLongPut) && spot !== null && preferredExpiry) {
    const atmStrike = roundStrike(spot);
    const otmStrike = isLongCall
      ? roundStrike(spot + (expectedMoveDollar ?? spot * 0.05) * 0.5)
      : roundStrike(spot - (expectedMoveDollar ?? spot * 0.05) * 0.5);
    const type = isLongCall ? 'CALL' : 'PUT';
    const typeCls = isLongCall ? 'text-signal-buy' : 'text-signal-sell';
    nakedOptionLine = (
      <div className={`font-medium ${typeCls}`}>
        Buy: <span className="font-bold">${atmStrike} {type}</span>{' '}
        <span className="text-fg-dim">exp {preferredExpiry}</span>
        <span className="text-fg-dim"> · OTM alt: </span>
        <span className="font-bold">${otmStrike} {type}</span>
        <span className="text-fg-dim"> (higher leverage, smaller size)</span>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle space-y-3">
      {/* 4-cell signal grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <InsightCell label="BEAT" value={beatLabel} sub={`${compositeScore}/100`} valueCls={beatCls} />
        <InsightCell label="OPTIONS FLOW" value={flowLabel} sub={flowSub} valueCls={flowCls} />
        <InsightCell label="NEWS" value={newsLabel} sub={newsSub} valueCls={newsCls} />
        <InsightCell label="IV ENV" value={ivLabel} sub={ivSub} valueCls={ivCls} />
      </div>

      {/* System verdict — single crisp line */}
      <div className="text-xs border-t border-border-subtle pt-2 space-y-1">
        <div>
          <span className="text-fg-dim tracking-widest">System  </span>
          <span className={`font-semibold ${leanCls}`}>{leanLabel}</span>
          <span className="text-fg-dim">  ·  </span>
          <span className={directionCls}>{directionTake}</span>
        </div>
        {tensionNote && (
          <div className="text-fg-dim italic">{tensionNote}</div>
        )}
        {nakedOptionLine}
      </div>
    </div>
  );
}

function InsightCell({
  label, value, sub, valueCls,
}: {
  label: string; value: string; sub?: string; valueCls: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-fg-dim tracking-widest uppercase mb-0.5">{label}</div>
      <div className={`text-xs font-bold ${valueCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-fg-dim">{sub}</div>}
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  competitive:      'Competitive threat',
  sector_repricing: 'Sector repricing',
  downgrade:        'Analyst downgrade',
  guidance_concern: 'Guidance concern',
  customer_loss:    'Customer / contract loss',
  regulatory:       'Regulatory / legal',
  macro_specific:   'Macro / price action',
};

function NewsSentimentSection({ overhangs }: { overhangs: NarrativeOverhang[] | null }) {
  // Compute overall sentiment from unresolved overhangs
  const risks = overhangs ?? [];
  const maxSeverity = risks.reduce((m, r) => Math.max(m, r.severity ?? 3), 0);

  let badge: { label: string; cls: string };
  let summary: string;
  if (risks.length === 0) {
    badge = { label: 'CLEAN', cls: 'bg-signal-buy/10 text-signal-buy border-signal-buy/20' };
    summary = 'No material risk signals detected in recent headlines.';
  } else if (risks.length <= 2 && maxSeverity <= 3) {
    badge = { label: 'CAUTIOUS', cls: 'bg-signal-watch/10 text-signal-watch border-signal-watch/20' };
    summary = `${risks.length} minor concern${risks.length > 1 ? 's' : ''} — monitor but not disqualifying.`;
  } else {
    badge = { label: 'ELEVATED RISK', cls: 'bg-signal-sell/10 text-signal-sell border-signal-sell/20' };
    summary = `${risks.length} unresolved risk${risks.length > 1 ? 's' : ''} — material headwinds into earnings.`;
  }

  return (
    <section className="border border-border bg-bg-elevated p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="text-xs tracking-widest text-fg-subtle">NEWS SENTIMENT</div>
        <span className={`text-[11px] font-bold px-2 py-0.5 border tracking-widest ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <p className="text-sm text-fg-muted mb-4">{summary}</p>

      {risks.length > 0 && (
        <div className="space-y-2">
          {risks.map((r, i) => {
            const sev = r.severity;
            const sevColor = sev && sev >= 4 ? 'text-signal-sell' : sev && sev >= 3 ? 'text-signal-watch' : 'text-fg-dim';
            return (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className={`shrink-0 font-bold tabular-nums ${sevColor}`}>
                  {sev ? `S${sev}` : '—'}
                </span>
                <span className="text-fg-subtle shrink-0 w-[130px]">
                  {CATEGORY_LABELS[r.category] ?? r.category}
                </span>
                <span className="text-fg-muted">{r.description}</span>
              </div>
            );
          })}
        </div>
      )}

      {risks.length === 0 && (
        <p className="text-xs text-fg-dim">
          Powered by LLM headline analysis (60-day window). No negative signals found.
        </p>
      )}
    </section>
  );
}

function scoreColor(score: number) {
  if (score >= 65) return 'text-signal-buy';
  if (score >= 40) return 'text-signal-watch';
  return 'text-signal-sell';
}

function beatProbabilityLabel(score: number): string {
  if (score >= 80) return 'Strong earnings beat likelihood — historically high beat frequency and magnitude';
  if (score >= 65) return 'Above-average beat likelihood — positive analyst revisions and beat history';
  if (score >= 50) return 'Moderate beat likelihood — mixed signals, no strong edge either way';
  if (score >= 35) return 'Below-average beat likelihood — weak history or negative revisions';
  return 'Low beat likelihood — poor beat history, deteriorating estimates';
}
