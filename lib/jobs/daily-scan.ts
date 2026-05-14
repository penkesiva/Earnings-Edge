/**
 * Daily earnings brief engine — FMP + Alpaca, beat score, scream test, persist.
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  getStockSnapshot,
  getOptionChain,
  getHistoricalBars,
  computeIvRank,
  computeExpectedMove,
  computePutCallRatio,
} from '@/lib/alpaca';
import {
  computeBeatStats,
  getNetRevisions30d,
  getNetInsiderBuying90d,
  getSectorEtf,
  getConsecutiveBeatStreak,
  hasInsiderSellingCluster60d,
  getForwardPeTtm,
} from '@/lib/fmp';
import { computeBeatScore } from '@/lib/beatScore';
import { suggestStructure } from '@/lib/structure';
import { computeScreamTest, type ScreamTestInputs } from '@/lib/screamTest';
import { deriveChainScreamFields, ytdReturnPctFromBars } from '@/lib/screamTestData';
import { detectOverhangs } from '@/lib/overhangDetector';
import { reconcileSignals } from '@/lib/reconcile';
import { sendBriefEmail } from '@/lib/email';
import { sendPush } from '@/lib/push';
import { earningsSessionDate } from '@/lib/earningsDate';

export type DailyScanTickerResult = {
  ticker: string;
  status: 'ok' | 'error';
  score?: number;
  scream_score?: number;
  scream_qualifies?: boolean;
  error?: string;
};

export type DailyScanJobResult =
  | { count: number; results: DailyScanTickerResult[] }
  | { count: 0; idleReason: 'empty_watchlist' }
  | {
      count: 0;
      idleReason: 'no_earnings_on_session_date';
      sessionDate: string;
      /** Next row in DB on or after session date (if any). */
      nextScheduled: { ticker: string; earnings_date: string } | null;
    };

export type RunDailyScanOptions = {
  /** Default true. Set false for manual dashboard testing to avoid email/push floods. */
  sendNotifications?: boolean;
  /** Optional explicit US session date (YYYY-MM-DD), defaults to today's session date. */
  targetDate?: string;
  /** When set, only this ticker is scanned (used by the brief-page re-scan button). */
  singleTicker?: string;
};

function isFmpPlanLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('FMP 402') || msg.includes('Premium Query Parameter');
}

async function withFmpFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  context: string,
  ticker: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isFmpPlanLimitError(err)) {
      console.warn(`[daily-scan] ${ticker} ${context}: using fallback due to FMP plan limit`);
      return fallback;
    }
    throw err;
  }
}

export async function runDailyScanJob(
  options: RunDailyScanOptions = {}
): Promise<DailyScanJobResult> {
  const sendNotifications = options.sendNotifications !== false;
  const targetDate = options.targetDate;
  const singleTicker = options.singleTicker?.toUpperCase();

  const sb = supabaseAdmin();
  const today = targetDate || earningsSessionDate();

  // Join via PostgREST requires a FK; we only have ticker text on both sides — filter in two steps.
  const { data: wl, error: wlError } = await sb
    .from('watchlist')
    .select('ticker')
    .eq('active', true);

  if (wlError) throw new Error(wlError.message);

  const watchTickers = (wl ?? []).map(w => w.ticker);
  if (!watchTickers.length) {
    return { count: 0, idleReason: 'empty_watchlist' };
  }

  // When re-scanning a single brief, restrict to that ticker only (skip the rest).
  const eligibleTickers = singleTicker ? [singleTicker] : watchTickers;

  const { data: events, error: eventsError } = await sb
    .from('earnings_events')
    .select('*')
    .eq('earnings_date', today)
    .in('ticker', eligibleTickers);

  if (eventsError) throw new Error(eventsError.message);

  if (!events?.length) {
    const { data: upcoming } = await sb
      .from('earnings_events')
      .select('ticker, earnings_date')
      .in('ticker', watchTickers)
      .gte('earnings_date', today)
      .order('earnings_date', { ascending: true })
      .limit(1);

    const row = upcoming?.[0];
    return {
      count: 0,
      idleReason: 'no_earnings_on_session_date',
      sessionDate: today,
      nextScheduled: row
        ? { ticker: row.ticker, earnings_date: String(row.earnings_date) }
        : null,
    };
  }

  const results: DailyScanTickerResult[] = [];

  for (const event of events) {
    try {
      const brief = await generateBrief(event.ticker, today);
      results.push({
        ticker: event.ticker,
        status: 'ok',
        score: brief.composite_score,
        scream_score: brief.scream_score,
        scream_qualifies: brief.scream_qualifies,
      });

      if (sendNotifications) {
        const tasks: Promise<unknown>[] = [];
        const hasEmailConfig = !!process.env.RESEND_API_KEY && !!process.env.NOTIFY_EMAIL;
        if (hasEmailConfig) {
          tasks.push(
            sendBriefEmail({
              ticker: event.ticker,
              earningsDate: today,
              spot: brief.spot_price,
              ivRank: brief.iv_rank,
              expectedMovePct: brief.expected_move_pct,
              expectedMoveDollar: brief.expected_move_dollar,
              score: {
                composite: brief.composite_score,
                components: brief.components,
                signal: brief.signal,
                reasoning: brief.reasoning,
              },
              structure: brief.suggested_structure,
              briefId: brief.id,
              baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://earnings-edge.vercel.app',
            })
          );
        }

        tasks.push(
          sendPush({
            ticker: event.ticker,
            signal: brief.signal,
            score: brief.composite_score,
            briefId: brief.id,
          })
        );

        const notifResults = await Promise.allSettled(tasks);
        for (const r of notifResults) {
          if (r.status === 'rejected') {
            console.warn(`[daily-scan] ${event.ticker} notification skipped:`, r.reason);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to generate brief for ${event.ticker}:`, err);
      results.push({ ticker: event.ticker, status: 'error', error: msg });
    }
  }

  return { count: results.length, results };
}

async function generateBrief(ticker: string, earningsDate: string) {
  const sb = supabaseAdmin();

  const [
    snapshot,
    beatStats,
    netRevisions,
    netInsider,
    sectorEtf,
    consecutiveStreak,
    insiderSellingCluster,
    forwardPe,
  ] = await Promise.all([
    getStockSnapshot(ticker),
    withFmpFallback(
      () => computeBeatStats(ticker, 4),
      { beatsLastN: 0, totalQuarters: 0, avgSurprisePct: 0 },
      'beat-stats',
      ticker
    ),
    withFmpFallback(() => getNetRevisions30d(ticker), 0, 'analyst-revisions', ticker),
    withFmpFallback(() => getNetInsiderBuying90d(ticker), 0, 'insider-flow', ticker),
    withFmpFallback(() => getSectorEtf(ticker), 'SPY', 'sector-profile', ticker),
    withFmpFallback(
      () => getConsecutiveBeatStreak(ticker, 8),
      { streak: 0, totalQuarters: 0 },
      'beat-streak',
      ticker
    ),
    withFmpFallback(
      () => hasInsiderSellingCluster60d(ticker),
      false,
      'insider-selling-cluster',
      ticker
    ),
    withFmpFallback(() => getForwardPeTtm(ticker), null, 'forward-pe', ticker),
  ]);

  const fiveDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const today = earningsSessionDate();
  const sectorBars = await getHistoricalBars(sectorEtf, fiveDaysAgo, today);
  const sectorReturn5d =
    sectorBars.length >= 2
      ? ((sectorBars[sectorBars.length - 1].c - sectorBars[0].c) / sectorBars[0].c) * 100
      : 0;

  const expiryAfter = nextFridayAfter(earningsDate);
  const chain = await getOptionChain(ticker, expiryAfter);
  const expectedMove = computeExpectedMove(chain);
  const putCall = computePutCallRatio(chain);

  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const yearBars = await getHistoricalBars(ticker, yearAgo, today);
  const ivHistory = computeRollingRealizedVol(yearBars, 30);
  const currentIv = chain.calls[Math.floor(chain.calls.length / 2)]?.iv ?? 0.3;
  const ivRank = computeIvRank(currentIv, ivHistory);

  const chainScream = deriveChainScreamFields(chain);
  const ytdReturnPct = ytdReturnPctFromBars(
    yearBars.map((b: { t: string; c: number }) => ({ t: String(b.t), c: b.c }))
  );

  let narrativeOverhangs: ScreamTestInputs['narrativeOverhangs'] = [];
  let rawHeadlines: { date: string; title: string; source: string }[] = [];
  try {
    const overhangResult = await detectOverhangs({ ticker, asOfDate: earningsDate });
    narrativeOverhangs = overhangResult.overhangs;
    rawHeadlines = overhangResult.rawHeadlines;
  } catch (e) {
    console.warn(`[daily-scan] ${ticker} narrative overhangs skipped:`, e);
  }

  const screamInputs: ScreamTestInputs = {
    ticker,
    spot: snapshot.price,
    ...chainScream,
    beatStreak: consecutiveStreak.streak,
    totalQuartersTracked: Math.max(1, consecutiveStreak.totalQuarters),
    zacksEsp: null,
    hasInsiderSellingCluster: insiderSellingCluster,
    hasRegulatoryOverhang: false,
    ytdReturnPct,
    forwardPe,
    narrativeOverhangs,
    peerEarningsReactionsPct: [],
    sectorIndex5dReturnPct: sectorReturn5d,
  };
  const screamResult = computeScreamTest(screamInputs);

  const score = computeBeatScore({
    beatsLast4: beatStats.beatsLastN,
    totalQuarters: beatStats.totalQuarters,
    avgSurprisePct: beatStats.avgSurprisePct,
    netRevisions30d: netRevisions,
    netInsiderBuying90d: netInsider,
    ivRank,
    sectorReturn5d,
  });

  // Use the same-week Friday as the display expiry for strike tables.
  // chain.expiry (from Alpaca's snapshot) can jump to the following week if
  // same-week options weren't in the snapshot, but earnings plays target the
  // Friday that immediately follows the report — so we lock the display to
  // expiryAfter (the Friday of the earnings week).
  const displayExpiry = expiryAfter;

  const structure = suggestStructure({
    spot: snapshot.price,
    ivRank,
    expectedMovePct: expectedMove.pct,
    expectedMoveDollar: expectedMove.dollar,
    composite: score.composite,
    signal: score.signal,
    preferredExpiry: displayExpiry,
  });

  const reconciled = reconcileSignals({
    beatScore: score,
    scream: screamResult,
    ivRank,
    spot: snapshot.price,
    expectedMoveDollar: expectedMove.dollar,
    preferredExpiry: displayExpiry,
    netInsiderBuying90d: netInsider,
    sectorReturn5d,
  });

  const { data: brief, error } = await sb
    .from('earnings_briefs')
    .upsert(
      {
        ticker,
        earnings_date: earningsDate,
        beat_streak_score: beatStats.totalQuarters > 0 ? score.components.beatStreakScore : null,
        surprise_magnitude_score: score.components.surpriseMagnitudeScore,
        revision_trend_score: score.components.revisionTrendScore,
        whisper_delta_score: score.components.whisperDeltaScore,
        iv_rank_score: score.components.ivRankScore,
        sector_momentum_score: score.components.sectorMomentumScore,
        insider_score: score.components.insiderScore,
        composite_score: score.composite,
        spot_price: snapshot.price,
        iv_30d: currentIv,
        iv_rank: ivRank,
        expected_move_pct: expectedMove.pct,
        expected_move_dollar: expectedMove.dollar,
        put_call_ratio: putCall,
        atm_call_strike: expectedMove.atmCall,
        atm_put_strike: expectedMove.atmPut,
        signal: score.signal,
        suggested_structure: structure as object,
        reasoning: score.reasoning.join(' · '),
        scream_score: screamResult.score,
        scream_direction: screamResult.directionalBias,
        scream_recommendation: screamResult.recommendation,
        scream_qualifies: screamResult.qualifies,
        scream_filters: screamResult.filters as object,
        scream_notes: screamResult.notes as unknown,
        final_action: reconciled.final_action,
        final_action_rationale: reconciled.rationale,
        raw_alpaca: {
          snapshot,
          expectedMove,
          putCall,
          ivRank,
          currentIv,
          chainScream,
          ytdReturnPct,
        } as object,
        raw_fmp: {
          beatStats,
          netRevisions,
          netInsider,
          sectorEtf,
          sectorReturn5d,
          consecutiveStreak,
          insiderSellingCluster,
          forwardPe,
          narrativeOverhangs,
          screamUnresolvedOverhangs: screamResult.unresolvedOverhangs,
        } as object,
        raw_headlines: rawHeadlines as unknown as object,
      },
      { onConflict: 'ticker,earnings_date' }
    )
    .select()
    .single();

  if (error) throw error;

  // Log scan snapshot for flip detection (fire-and-forget, never throws)
  sb.from('brief_scans').insert({
    ticker,
    reconciled_action: reconciled.final_action,
    scream_score: screamResult.score,
    iv_rank: ivRank,
    directional_bias: screamResult.directionalBias,
  }).then(({ error: scanErr }) => {
    if (scanErr) console.warn(`[daily-scan] ${ticker} brief_scans insert:`, scanErr.message);
  });

  return {
    ...brief,
    components: score.components,
    reasoning: score.reasoning,
  };
}

function nextFridayAfter(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const daysUntilFri = day <= 5 ? 5 - day : 5 + 7 - day;
  d.setDate(d.getDate() + (daysUntilFri || 7));
  return d.toISOString().slice(0, 10);
}

function computeRollingRealizedVol(bars: { c: number }[], window: number): number[] {
  const result: number[] = [];
  for (let i = window; i < bars.length; i++) {
    const slice = bars.slice(i - window, i);
    const returns: number[] = [];
    for (let j = 1; j < slice.length; j++) {
      returns.push(Math.log(slice[j].c / slice[j - 1].c));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
    result.push(annualizedVol);
  }
  return result;
}
