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
import { supabaseAdmin } from '@/lib/supabase';
import { getEarningsSurprises } from '@/lib/fmp';
import { getHistoricalBars } from '@/lib/alpaca';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

export const maxDuration = 120;

export async function POST() {
  const sb = supabaseAdmin();
  const today = earningsSessionDate();

  // 1. Find briefs past earnings day with no outcome row yet
  const { data: briefs, error: briefErr } = await sb
    .from('v_brief_outcomes')
    .select('brief_id, ticker, earnings_date, final_action, expected_move_pct, beat_or_miss')
    .lt('earnings_date', today)
    .is('beat_or_miss', null)
    .limit(20);

  if (briefErr) return NextResponse.json({ error: briefErr.message }, { status: 500 });
  if (!briefs?.length) return NextResponse.json({ count: 0, message: 'No pending outcomes.' });

  const results: { ticker: string; status: string; detail?: string }[] = [];

  for (const brief of briefs) {
    try {
      const earningsDate = brief.earnings_date as string;
      const ticker = brief.ticker as string;
      const finalAction = (brief.final_action ?? 'SKIP') as string;

      // ── Actual EPS result from FMP ───────────────────────────────────────────
      // Gracefully handle FMP errors (rate limits, plan restrictions) so that
      // at minimum the next-day price data still gets saved.
      const surprises = await getEarningsSurprises(ticker).catch(() => []);
      const match = surprises
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .find(s => {
          // Find the surprise row closest to the earnings date (within 5 days)
          const diff = Math.abs(
            new Date(s.date).getTime() - new Date(earningsDate).getTime()
          );
          return diff <= 5 * 24 * 60 * 60 * 1000;
        });

      const beatOrMiss: 'BEAT' | 'MISS' | null = match
        ? match.actualEarningResult >= match.estimatedEarning ? 'BEAT' : 'MISS'
        : null;
      const surprisePct = match && match.estimatedEarning !== 0
        ? ((match.actualEarningResult - match.estimatedEarning) / Math.abs(match.estimatedEarning)) * 100
        : null;

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

      if (nextDayClosePct !== null) {
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
        // SKIP / SKIP_* / BEARISH_WATCH / BULLISH_WATCH → hit stays null (not counted)
      }

      // ── Upsert outcome row ───────────────────────────────────────────────────
      const { error: upsertErr } = await sb
        .from('earnings_outcomes')
        .upsert(
          {
            brief_id: brief.brief_id,
            beat_or_miss: beatOrMiss,
            surprise_pct: surprisePct,
            next_day_open_pct: nextDayOpenPct,
            next_day_close_pct: nextDayClosePct,
            final_action: finalAction,
            hit,
          },
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
