/**
 * Daily scan cron — runs 6am PT weekdays.
 *
 * For every ticker on the watchlist reporting earnings TODAY:
 *   1. Pull data from FMP + Alpaca
 *   2. Compute beat score
 *   3. Suggest options structure
 *   4. Persist brief
 *   5. Notify (email + push)
 */

import { NextRequest, NextResponse } from 'next/server';
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
} from '@/lib/fmp';
import { computeBeatScore } from '@/lib/beatScore';
import { suggestStructure } from '@/lib/structure';
import { sendBriefEmail } from '@/lib/email';
import { sendPush } from '@/lib/push';

export const maxDuration = 300; // 5 min

export async function GET(req: NextRequest) {
  // Cron security
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Get tickers from watchlist that report today
  const { data: events, error: eventsError } = await sb
    .from('earnings_events')
    .select('*, watchlist!inner(*)')
    .eq('earnings_date', today);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  if (!events?.length) {
    return NextResponse.json({ message: 'no earnings today', count: 0 });
  }

  const results: any[] = [];

  for (const event of events) {
    try {
      const brief = await generateBrief(event.ticker, today);
      results.push({ ticker: event.ticker, status: 'ok', score: brief.composite_score });

      // Notify
      await Promise.all([
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
        }),
        sendPush({
          ticker: event.ticker,
          signal: brief.signal,
          score: brief.composite_score,
          briefId: brief.id,
        }),
      ]);
    } catch (err: any) {
      console.error(`Failed to generate brief for ${event.ticker}:`, err);
      results.push({ ticker: event.ticker, status: 'error', error: err.message });
    }
  }

  return NextResponse.json({ count: results.length, results });
}

async function generateBrief(ticker: string, earningsDate: string) {
  const sb = supabaseAdmin();

  // Parallel data fetch
  const [
    snapshot,
    beatStats,
    netRevisions,
    netInsider,
    sectorEtf,
  ] = await Promise.all([
    getStockSnapshot(ticker),
    computeBeatStats(ticker, 4),
    getNetRevisions30d(ticker),
    getNetInsiderBuying90d(ticker),
    getSectorEtf(ticker),
  ]);

  // Sector 5d return
  const fiveDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const sectorBars = await getHistoricalBars(sectorEtf, fiveDaysAgo, today);
  const sectorReturn5d =
    sectorBars.length >= 2
      ? ((sectorBars[sectorBars.length - 1].c - sectorBars[0].c) / sectorBars[0].c) * 100
      : 0;

  // Options chain — closest expiry post-earnings
  // Find next Friday after earnings date
  const expiryAfter = nextFridayAfter(earningsDate);
  const chain = await getOptionChain(ticker, expiryAfter);
  const expectedMove = computeExpectedMove(chain);
  const putCall = computePutCallRatio(chain);

  // IV rank: pull 252-day IV history (approximation: use realized vol of underlying)
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const yearBars = await getHistoricalBars(ticker, yearAgo, today);
  const ivHistory = computeRollingRealizedVol(yearBars, 30);
  const currentIv = chain.calls[Math.floor(chain.calls.length / 2)]?.iv ?? 0.3;
  const ivRank = computeIvRank(currentIv, ivHistory);

  // Score
  const score = computeBeatScore({
    beatsLast4: beatStats.beatsLastN,
    totalQuarters: beatStats.totalQuarters,
    avgSurprisePct: beatStats.avgSurprisePct,
    netRevisions30d: netRevisions,
    netInsiderBuying90d: netInsider,
    ivRank,
    sectorReturn5d,
  });

  // Structure
  const structure = suggestStructure({
    spot: snapshot.price,
    ivRank,
    expectedMovePct: expectedMove.pct,
    expectedMoveDollar: expectedMove.dollar,
    composite: score.composite,
    signal: score.signal,
    preferredExpiry: chain.expiry,
  });

  // Persist
  const { data: brief, error } = await sb
    .from('earnings_briefs')
    .upsert({
      ticker,
      earnings_date: earningsDate,
      beat_streak_score: score.components.beatStreakScore,
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
      suggested_structure: structure as any,
      reasoning: score.reasoning.join(' · '),
      raw_alpaca: { snapshot, expectedMove, putCall, ivRank, currentIv } as any,
      raw_fmp: { beatStats, netRevisions, netInsider, sectorEtf, sectorReturn5d } as any,
    }, { onConflict: 'ticker,earnings_date' })
    .select()
    .single();

  if (error) throw error;

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

function computeRollingRealizedVol(bars: any[], window: number): number[] {
  const result: number[] = [];
  for (let i = window; i < bars.length; i++) {
    const slice = bars.slice(i - window, i);
    const returns: number[] = [];
    for (let j = 1; j < slice.length; j++) {
      returns.push(Math.log(slice[j].c / slice[j - 1].c));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
    result.push(annualizedVol);
  }
  return result;
}
