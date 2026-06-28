import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuthSession } from '@/lib/authServer';
import { FinalActionBadge, SignalBadge } from '@/components/SignalBadge';
import { ScreamTestCard } from '@/components/ScreamTestCard';
import { ScanDiffBanner } from '@/components/ScanDiffBanner';
import { BriefAnalysisPanel } from '@/components/BriefAnalysisPanel';
import { BriefSystemRow } from '@/components/BriefSystemRow';
import { loadBriefAiAnalyses } from '@/lib/loadBriefAiAnalyses';
import { getStockSnapshot } from '@/lib/alpaca';
import { getCompanyName } from '@/lib/fmp';
import type { FilterResult, NarrativeOverhang } from '@/lib/screamTest';
import type { BriefScanRow } from '@/lib/scanDiff';
import type { NewsOverallSentiment, RawHeadline } from '@/lib/newsSentiment';
import {
  getNewsSentimentDisplay,
  newsInsightFromNoData,
  newsInsightFromOverall,
  newsInsightFromRisks,
  sentimentChipClass,
  sentimentChipLabel,
} from '@/lib/newsSentiment';

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

function backHref(from: string | undefined): string {
  if (from === 'history') return '/history';
  if (from === 'watchlist') return '/watchlist';
  return '/';
}

export default async function BriefPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { from?: string };
}) {
  const { sb } = await requireAuthSession();
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

  const { analyses: savedAnalyses, analysisAt: savedAnalysisAt, lastAiScanAt, lastConsensusAt } = await loadBriefAiAnalyses(
    sb,
    params.id,
    brief.ticker as string,
    brief.earnings_date as string
  );
  const systemScanAt =
    (brief.updated_at as string | null) ?? (brief.generated_at as string | null);

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

  let companyName: string | null = null;
  try {
    companyName = await getCompanyName(brief.ticker as string);
  } catch {
    // Non-fatal — header shows ticker only.
  }

  const finalAction: string | null = brief.final_action ?? null;
  const finalRationale: string | null = brief.final_action_rationale ?? null;
  // Older briefs predate reconcile — fall back gracefully to old structure action
  const legacyFallback = !finalAction;

  const preferredExpiry: string | null =
    structure?.preferredExpiry ?? structure?.legs?.[0]?.expiry ?? null;

  const newsOverall = (brief.news_sentiment as NewsOverallSentiment | null) ?? null;
  const rawHeadlines = (brief.raw_headlines as RawHeadline[] | null) ?? null;

  return (
    <div className="space-y-6 sm:space-y-8 brief-page-pad-bottom">
      <Link href={backHref(searchParams?.from)} className="text-xs text-fg-subtle hover:text-fg">
        ← BACK
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-l-[3px] sm:border-l-4 border-signal-buy pl-3 sm:pl-6">
        <div className="text-xs text-fg-subtle tracking-widest mb-2">
          EARNINGS BRIEF · {brief.earnings_date}
        </div>
        <div className="flex flex-wrap items-baseline gap-3 sm:gap-6 mb-4">
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-5xl font-bold">{brief.ticker}</h1>
            {companyName ? (
              <p className="text-sm text-fg-muted mt-1 leading-snug">{companyName}</p>
            ) : null}
          </div>
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
          <div className="text-xl sm:text-2xl font-bold">
            SCORE <span className={scoreColor(brief.composite_score)}>{brief.composite_score}</span>
            <span className="text-fg-subtle text-base ml-2">/ 100</span>
          </div>
          <div className="text-xs text-fg-dim mt-1">
            {beatProbabilityLabel(brief.composite_score)}
          </div>
          <BriefInsightStrip
            compositeScore={brief.composite_score}
            ivRank={brief.iv_rank ?? null}
            putCallRatio={brief.put_call_ratio ?? null}
            overhangs={screamUnresolved}
            newsOverall={newsOverall}
            rawHeadlines={rawHeadlines}
          />
        </div>
      </div>

      <BriefAnalysisPanel
        savedAnalyses={savedAnalyses}
        savedAnalysisAt={savedAnalysisAt}
        lastAiScanAt={lastAiScanAt}
        lastConsensusAt={lastConsensusAt}
        systemScanAt={systemScanAt}
        systemRow={
          <BriefSystemRow
            compositeScore={brief.composite_score}
            finalAction={finalAction}
            ivRank={brief.iv_rank ?? null}
            expectedMovePct={brief.expected_move_pct ?? null}
            expectedMoveDollar={brief.expected_move_dollar ?? null}
            spot={brief.spot_price ?? null}
            preferredExpiry={preferredExpiry}
            screamDirection={brief.scream_direction ?? null}
            screamScore={brief.scream_score ?? null}
          />
        }
        brief={{
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
            raw_headlines:            rawHeadlines,
            news_sentiment:           newsOverall,
            spot_price:               brief.spot_price ?? null,
            suggested_structure:      structure ?? null,
          }}
      />

      {/* ── Flip banner (above everything else when critical) ──────────────── */}
      <ScanDiffBanner ticker={brief.ticker} scans={scanRows} />

      {/* ── Final action ───────────────────────────────────────────────────── */}
      <section className="border border-border bg-bg-elevated p-4 sm:p-6">
        <div className="text-xs tracking-widest text-fg-subtle mb-4">TRADE DECISION</div>
        {legacyFallback ? (
          <div className="text-xs text-fg-dim">
            Use ✦ SCAN ALL to generate a reconciled action for this brief.
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
      <NewsSentimentSection
        overhangs={screamUnresolved}
        rawHeadlines={rawHeadlines}
        newsOverall={newsOverall}
      />

      {/* ── Outcome (if logged) ────────────────────────────────────────────── */}
      {outcome && (
        <section className="border border-border bg-bg-elevated p-4 sm:p-6">
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
        <div className={`text-xl sm:text-2xl font-bold tracking-wide ${tradeColor}`}>{tradeLabel}</div>
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
    <div className="bg-bg-elevated p-3 sm:p-4">
      <div className="text-xs text-fg-subtle tracking-widest mb-1">{label}</div>
      <div className="text-lg sm:text-xl font-bold">{value}</div>
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
  compositeScore, ivRank, putCallRatio, overhangs, newsOverall, rawHeadlines,
}: {
  compositeScore: number;
  ivRank: number | null;
  putCallRatio: number | null;
  overhangs: NarrativeOverhang[] | null;
  newsOverall: NewsOverallSentiment | null;
  rawHeadlines: RawHeadline[] | null;
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
  const newsDisplay = getNewsSentimentDisplay(newsOverall, rawHeadlines, risks.length, maxSev);
  const newsInsight =
    newsInsightFromOverall(newsOverall, rawHeadlines) ??
    (risks.length > 0 ? newsInsightFromRisks(risks.length, maxSev) : newsInsightFromNoData());
  const newsLabel = newsInsight.label;
  const newsCls = newsInsight.cls;
  const newsSub =
    newsInsightFromOverall(newsOverall, rawHeadlines)
      ? (newsOverall?.summary?.slice(0, 48) ?? newsInsight.sub)
      : newsInsight.sub;
  const newsReason =
    newsDisplay.summary.length > 180
      ? `${newsDisplay.summary.slice(0, 177).trim()}…`
      : newsDisplay.summary;

  // ── IV environment ────────────────────────────────────────────────────────
  const ivr = ivRank;
  const [ivLabel, ivCls] =
    ivr === null ? ['NO DATA',    'text-fg-dim']       :
    ivr >= 80    ? ['EXTREME',    'text-signal-sell']  :
    ivr >= 60    ? ['ELEVATED',   'text-signal-watch'] :
    ivr >= 40    ? ['MODERATE',   'text-fg-muted']     :
                   ['LOW',        'text-signal-buy'];
  const ivSub = ivr !== null ? `rank ${ivr}` : '';

  return (
    <div className="mt-4 pt-3 border-t border-border-subtle">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <InsightCell label="BEAT" value={beatLabel} sub={`${compositeScore}/100`} valueCls={beatCls} />
        <InsightCell label="OPTIONS FLOW" shortLabel="FLOW" value={flowLabel} sub={flowSub} valueCls={flowCls} />
        <InsightCell
          label="NEWS"
          value={newsLabel}
          sub={newsSub}
          valueCls={newsCls}
          href="#news-sentiment"
          linkHint="read headlines ↓"
        />
        <InsightCell label="IV ENV" value={ivLabel} sub={ivSub} valueCls={ivCls} />
      </div>
      <a
        href="#news-sentiment"
        className="mt-3 block text-[11px] leading-relaxed text-fg-dim hover:text-fg-subtle"
      >
        <span className="text-fg-subtle">News:</span>{' '}
        <span className={newsCls}>{newsDisplay.badge.label}</span>
        <span> — {newsReason}</span>
      </a>
    </div>
  );
}

function InsightCell({
  label, shortLabel, value, sub, valueCls, href, linkHint,
}: {
  label: string;
  shortLabel?: string;
  value: string;
  sub?: string;
  valueCls: string;
  href?: string;
  linkHint?: string;
}) {
  const body = (
    <>
      <div className="text-[10px] text-fg-dim tracking-widest uppercase mb-0.5">
        {shortLabel ? (
          <>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </div>
      <div className={`text-xs font-bold ${valueCls}`}>{value}</div>
      {sub && <div className="text-[10px] text-fg-dim">{sub}</div>}
      {href && linkHint && (
        <div className="text-[10px] text-fg-dim mt-0.5 group-hover:text-fg-subtle">{linkHint}</div>
      )}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="block rounded -mx-1 px-1 py-0.5 hover:bg-bg-hover/60 transition-colors group"
      >
        {body}
      </a>
    );
  }

  return <div>{body}</div>;
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

function NewsSentimentSection({
  overhangs,
  rawHeadlines,
  newsOverall,
}: {
  overhangs: NarrativeOverhang[] | null;
  rawHeadlines: RawHeadline[] | null;
  newsOverall: NewsOverallSentiment | null;
}) {
  const risks = overhangs ?? [];
  const headlines = [...(rawHeadlines ?? [])].reverse();
  const maxSeverity = risks.reduce((m, r) => Math.max(m, r.severity ?? 3), 0);
  const { badge, summary } = getNewsSentimentDisplay(
    newsOverall,
    rawHeadlines,
    risks.length,
    maxSeverity,
  );

  return (
    <section
      id="news-sentiment"
      className="border border-border bg-bg-elevated p-4 sm:p-6 scroll-mt-20 md:scroll-mt-6"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4">
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
              <div key={i} className="text-xs border-b border-border-subtle pb-2 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`shrink-0 font-bold tabular-nums ${sevColor}`}>
                    {sev ? `S${sev}` : '—'}
                  </span>
                  <span className="text-fg-subtle font-medium">
                    {CATEGORY_LABELS[r.category] ?? r.category}
                  </span>
                </div>
                <p className="text-fg-muted leading-snug pl-6">{r.description}</p>
              </div>
            );
          })}
        </div>
      )}

      {risks.length === 0 && headlines.length === 0 && (
        <p className="text-xs text-fg-dim">
          Powered by LLM headline analysis (60-day window). No negative signals found.
        </p>
      )}

      <div className="mt-5 pt-4 border-t border-border-subtle">
        <div className="text-[10px] tracking-widest text-fg-dim mb-3">
          RAW HEADLINES{headlines.length > 0 ? ` (${headlines.length})` : ''}
        </div>
        {headlines.length > 0 ? (
          <>
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {headlines.map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span
                    className={`shrink-0 w-5 text-center text-[10px] font-bold border ${sentimentChipClass(h.sentiment)}`}
                    title={h.note ?? h.sentiment ?? 'neutral'}
                  >
                    {sentimentChipLabel(h.sentiment)}
                  </span>
                  <span className="shrink-0 tabular-nums text-fg-dim w-[4.5rem]">{h.date}</span>
                  <span className="text-fg-muted leading-snug flex-1 min-w-0">{h.title}</span>
                  {h.source ? (
                    <span className="shrink-0 text-fg-dim hidden sm:block max-w-[7rem] truncate" title={h.source}>
                      {h.source}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-fg-dim mt-3">
              FMP stable news + Gemini search · 60-day window · newest first
            </p>
          </>
        ) : (
          <p className="text-xs text-fg-dim">
            No headlines stored for this brief. Use ↻ SYSTEM SCAN to load news and sentiment tags.
          </p>
        )}
      </div>
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
