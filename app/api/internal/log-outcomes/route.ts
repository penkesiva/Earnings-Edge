/**
 * POST /api/internal/log-outcomes
 *
 * Finds past briefs with no outcome recorded, fetches actual EPS result and
 * next-day price move, writes to earnings_outcomes, and marks hit/miss.
 *
 * HIT logic (based on final_action):
 *   LONG_CALL / CALL_DEBIT_SPREAD  → hit if next-day close > +2%
 *   LONG_PUT  / PUT_DEBIT_SPREAD   → hit if next-day close < -2%
 *   PUT_CREDIT_SPREAD              → hit if next-day close > -1.25× expected_move (above short put)
 *   CALL_CREDIT_SPREAD             → hit if next-day close < +1.25× expected_move (below short call)
 *   IRON_CONDOR                    → hit if |next-day close| < 1.25× expected_move (between shorts)
 *   SKIP                           → not counted (null hit)
 */

import { NextResponse } from 'next/server';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';
import { getEarningsSurprises } from '@/lib/fmp';
import { getHistoricalBars } from '@/lib/alpaca';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { isScorableStructure } from '@/lib/historyStats';
import { parseSynthesisResponse } from '@/lib/aiConsensus';

export const maxDuration = 120;

function parseConfidence(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw.match(/\d+/)?.[0] ?? '', 10);
  return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : null;
}

function consensusHit(
  direction: string | null,
  nextDayClosePct: number | null,
): boolean | null {
  if (nextDayClosePct == null) return null;
  if (direction === 'UP') return nextDayClosePct > 2;
  if (direction === 'DOWN') return nextDayClosePct < -2;
  return null;
}

export async function POST() {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const sb = auth.sb;
  const today = earningsSessionDate();

  const baseOutcomeSelect =
    'brief_id, ticker, earnings_date, final_action, expected_move_pct, beat_or_miss, surprise_pct, next_day_close_pct';
  const outcomeSelect =
    'brief_id, ticker, earnings_date, final_action, expected_move_pct, beat_or_miss, surprise_pct, next_day_close_pct, consensus_verdict';

  // Past briefs missing EPS and/or next-day price (re-run fills gaps as data arrives)
  let supportsConsensusOutcomes = true;
  let { data: pendingBriefs, error: briefErr } = await sb
    .from('v_brief_outcomes')
    .select(outcomeSelect)
    .lt('earnings_date', today)
    .or('beat_or_miss.is.null,next_day_close_pct.is.null')
    .limit(20);

  if (briefErr && /consensus_verdict/i.test(briefErr.message)) {
    supportsConsensusOutcomes = false;
    const retry = await sb
      .from('v_brief_outcomes')
      .select(baseOutcomeSelect)
      .lt('earnings_date', today)
      .or('beat_or_miss.is.null,next_day_close_pct.is.null')
      .limit(20);
    pendingBriefs = retry.data as typeof pendingBriefs;
    briefErr = retry.error;
  }

  if (briefErr) return NextResponse.json({ error: briefErr.message }, { status: 500 });

  // Backfill saved Final Verdict fields for rows that already have EPS/price.
  const { data: consensusCandidates } = supportsConsensusOutcomes
    ? await sb
      .from('v_brief_outcomes')
      .select(outcomeSelect)
      .lt('earnings_date', today)
      .not('next_day_close_pct', 'is', null)
      .is('consensus_verdict', null)
      .limit(40)
    : { data: [] };

  const candidateIds = (consensusCandidates ?? []).map(b => b.brief_id as string);
  const { data: candidateConsensusRows } = candidateIds.length
    ? await sb
      .from('brief_ai_analyses')
      .select('brief_id')
      .eq('provider', 'consensus')
      .in('brief_id', candidateIds)
    : { data: [] };
  const candidateConsensusIds = new Set(
    (candidateConsensusRows ?? []).map(r => r.brief_id as string)
  );

  const byId = new Map<string, NonNullable<typeof pendingBriefs>[number]>();
  for (const brief of pendingBriefs ?? []) byId.set(brief.brief_id as string, brief);
  for (const brief of consensusCandidates ?? []) {
    if (candidateConsensusIds.has(brief.brief_id as string)) {
      byId.set(brief.brief_id as string, brief as NonNullable<typeof pendingBriefs>[number]);
    }
  }
  const briefs = Array.from(byId.values()).slice(0, 20);

  if (!briefs?.length) return NextResponse.json({ count: 0, message: 'No pending outcomes.' });

  const briefIds = briefs.map(b => b.brief_id as string);
  const { data: consensusRows } = await sb
    .from('brief_ai_analyses')
    .select('brief_id, analysis_text')
    .eq('provider', 'consensus')
    .in('brief_id', briefIds);

  const consensusByBrief = new Map(
    (consensusRows ?? []).map(r => [r.brief_id as string, r.analysis_text as string])
  );

  const results: { ticker: string; status: string; detail?: string }[] = [];

  for (const brief of briefs) {
    try {
      const earningsDate = brief.earnings_date as string;
      const ticker = brief.ticker as string;
      const finalAction = (brief.final_action ?? 'SKIP') as string;
      const existingBeat = brief.beat_or_miss as 'BEAT' | 'MISS' | null;
      let beatOrMiss: 'BEAT' | 'MISS' | null = existingBeat;
      let surprisePct = (brief.surprise_pct as number | null) ?? null;

      if (!existingBeat) {
        // ── Actual EPS result from FMP ─────────────────────────────────────────
        const surprises = await getEarningsSurprises(ticker, true).catch(() => []);
        const sorted = surprises.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        const match = sorted.reduce<typeof sorted[0] | null>((best, s) => {
          const diff = Math.abs(
            new Date(s.date).getTime() - new Date(earningsDate).getTime()
          );
          if (diff > 7 * 24 * 60 * 60 * 1000) return best;
          if (!best) return s;
          const bestDiff = Math.abs(
            new Date(best.date).getTime() - new Date(earningsDate).getTime()
          );
          return diff < bestDiff ? s : best;
        }, null);

        beatOrMiss = match
          ? match.actualEarningResult >= match.estimatedEarning ? 'BEAT' : 'MISS'
          : null;
        surprisePct = match && match.estimatedEarning !== 0
          ? ((match.actualEarningResult - match.estimatedEarning) / Math.abs(match.estimatedEarning)) * 100
          : null;
      }

      // ── Next-day price move from Alpaca ──────────────────────────────────────
      // Fetch 3 trading days after earnings to find the first post-earnings close
      const fetchStart = earningsDate;
      const fetchEnd   = addCalendarDays(earningsDate, 4);
      const bars = await getHistoricalBars(ticker, fetchStart, fetchEnd, '1Day').catch(() => [] as { o: number; c: number }[]);

      // bars[0] is the earnings date close (or pre-earnings last close),
      // bars[1] is the next trading day close
      let nextDayOpenPct: number | null = null;
      let nextDayClosePct: number | null = null;

      if (bars.length >= 2) {
        const base   = bars[0].c; // close on earnings date
        const next   = bars[1];
        nextDayOpenPct  = base ? ((next.o - base) / base) * 100 : null;
        nextDayClosePct = base ? ((next.c - base) / base) * 100 : null;
      }

      // ── HIT determination ────────────────────────────────────────────────────
      let hit: boolean | null = null;
      const expMove = (brief.expected_move_pct as number | null) ?? 5;

      // Short-vol structures: shorts placed at 1.25× expected move; that's
      // also the breakeven on a hit (price needs to land inside the short
      // strikes, with some buffer for the credit collected).
      const SHORT_VOL_BAND = expMove * 1.25;

      // Skip / watch actions → hit stays null (not counted in structure hit rate)
      if (isScorableStructure(finalAction) && nextDayClosePct !== null) {
        if (finalAction === 'LONG_CALL' || finalAction === 'CALL_DEBIT_SPREAD') {
          hit = nextDayClosePct > 2;
        } else if (finalAction === 'LONG_PUT' || finalAction === 'PUT_DEBIT_SPREAD') {
          hit = nextDayClosePct < -2;
        } else if (finalAction === 'IRON_CONDOR') {
          hit = Math.abs(nextDayClosePct) < SHORT_VOL_BAND;
        } else if (finalAction === 'PUT_CREDIT_SPREAD') {
          hit = nextDayClosePct > -SHORT_VOL_BAND;
        } else if (finalAction === 'CALL_CREDIT_SPREAD') {
          hit = nextDayClosePct < SHORT_VOL_BAND;
        }
      }

      const consensusText = supportsConsensusOutcomes
        ? consensusByBrief.get(brief.brief_id as string)
        : undefined;
      const consensus = consensusText ? parseSynthesisResponse(consensusText) : null;
      const consensusDirection = consensus?.direction ?? null;
      const consensusHitValue = consensusHit(consensusDirection, nextDayClosePct);
      const outcomePayload = {
        brief_id: brief.brief_id,
        ticker,
        earnings_date: earningsDate,
        beat_or_miss: beatOrMiss,
        surprise_pct: surprisePct,
        next_day_open_pct: nextDayOpenPct,
        next_day_close_pct: nextDayClosePct,
        final_action: finalAction,
        hit,
        ...(supportsConsensusOutcomes ? {
          consensus_verdict: consensus?.verdict ?? null,
          consensus_direction: consensusDirection,
          consensus_confidence: parseConfidence(consensus?.confidence ?? null),
          consensus_trade_type: consensus?.tradePlan?.type ?? consensus?.trade ?? null,
          consensus_hit: consensusHitValue,
        } : {}),
      };

      // ── Upsert outcome row ───────────────────────────────────────────────────
      const { error: upsertErr } = await sb
        .from('earnings_outcomes')
        .upsert(
          outcomePayload,
          { onConflict: 'brief_id' }
        );

      if (upsertErr) throw new Error(upsertErr.message);

      results.push({
        ticker,
        status: 'ok',
        detail: `${beatOrMiss ?? 'no EPS data'} · next-day ${nextDayClosePct != null ? `${nextDayClosePct.toFixed(1)}%` : 'n/a'} · hit=${hit}`,
      });
    } catch (e) {
      results.push({
        ticker: brief.ticker as string,
        status: 'error',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ count: results.length, results });
}
