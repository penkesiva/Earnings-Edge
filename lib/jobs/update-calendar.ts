/**
 * Refresh earnings_events from FMP for active watchlist (next 30 days).
 */

import { supabaseAdmin } from '@/lib/supabase';
import { getEarningsCalendar } from '@/lib/fmp';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

export type UpdateCalendarJobResult =
  | {
      updated: number;
      tickers: string[];
      /** Raw count of rows FMP returned for the date window (before watchlist filter). */
      fmpRowsInRange: number;
      watchlistCount: number;
      /** Earliest synced row for a watchlist ticker in this window, if any. */
      nextEarning: { ticker: string; date: string } | null;
    }
  | { message: 'empty watchlist' };

export async function runUpdateCalendarJob(): Promise<UpdateCalendarJobResult> {
  const sb = supabaseAdmin();

  const { data: watchlist } = await sb
    .from('watchlist')
    .select('ticker, manual_earnings_date, manual_timing')
    .eq('active', true);

  if (!watchlist?.length) {
    return { message: 'empty watchlist' };
  }

  const tickerSet = new Set(watchlist.map(w => w.ticker));

  const today = earningsSessionDate();
  const in30 = addCalendarDays(today, 30);

  const all = await getEarningsCalendar(today, in30);
  const fmpRowsInRange = all.length;
  const relevant = all.filter((e: { symbol: string }) => tickerSet.has(e.symbol));

  const rows: Array<{
    ticker: string;
    earnings_date: string;
    timing: string;
    consensus_eps: number | null;
    consensus_rev: number | null;
    source: 'FMP' | 'MANUAL';
  }> = relevant.map(
    (e: {
      symbol: string;
      date: string;
      time?: string;
      epsEstimated?: number | null;
      revenueEstimated?: number | null;
    }) => ({
      ticker: e.symbol,
      earnings_date: e.date,
      timing: (e.time === 'amc' ? 'AMC' : e.time === 'bmo' ? 'BMO' : 'UNK') as string,
      consensus_eps: e.epsEstimated ?? null,
      consensus_rev: e.revenueEstimated ?? null,
      source: 'FMP' as const,
    })
  );

  // Manual overrides fill gaps for names not covered by current FMP plan/tier.
  for (const w of watchlist) {
    if (!w.manual_earnings_date) continue;
    rows.push({
      ticker: w.ticker,
      earnings_date: w.manual_earnings_date,
      timing: (w.manual_timing || 'UNK') as string,
      consensus_eps: null,
      consensus_rev: null,
      source: 'MANUAL' as const,
    });
  }

  const dedupedRows = Array.from(
    new Map(rows.map(r => [`${r.ticker}:${r.earnings_date}`, r])).values()
  );

  const { error } = await sb
    .from('earnings_events')
    .upsert(dedupedRows, { onConflict: 'ticker,earnings_date' });

  if (error) throw new Error(error.message);

  const sorted = [...dedupedRows].sort((a, b) =>
    a.earnings_date.localeCompare(b.earnings_date)
  );
  const nextEarning =
    sorted[0] != null
      ? { ticker: sorted[0].ticker, date: sorted[0].earnings_date }
      : null;

  const uniqueTickers = [...new Set(dedupedRows.map(r => r.ticker))];

  return {
    updated: dedupedRows.length,
    tickers: uniqueTickers,
    fmpRowsInRange,
    watchlistCount: watchlist.length,
    nextEarning,
  };
}
