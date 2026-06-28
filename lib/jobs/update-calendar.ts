/**
 * Refresh earnings_events from FMP for active watchlist (next 30 days).
 */

import { listWatchlistUserIds } from '@/lib/authServer';
import { getEarningsCalendar } from '@/lib/fmp';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { pruneOrphansNotOnWatchlist } from '@/lib/pruneTickerData';
import { supabaseAdmin } from '@/lib/supabase';

export type UpdateCalendarJobResult =
  | {
      updated: number;
      tickers: string[];
      fmpRowsInRange: number;
      watchlistCount: number;
      nextEarning: { ticker: string; date: string } | null;
    }
  | { message: 'empty watchlist' };

export type UpdateCalendarOptions = {
  userId?: string;
};

async function runUpdateCalendarForUser(
  sb: ReturnType<typeof supabaseAdmin>,
  userId: string,
): Promise<UpdateCalendarJobResult> {
  const { data: watchlist } = await sb
    .from('watchlist')
    .select('ticker, manual_earnings_date, manual_timing')
    .eq('user_id', userId)
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
    user_id: string;
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
      user_id: userId,
      ticker: e.symbol,
      earnings_date: e.date,
      timing: (e.time === 'amc' ? 'AMC' : e.time === 'bmo' ? 'BMO' : 'UNK') as string,
      consensus_eps: e.epsEstimated ?? null,
      consensus_rev: e.revenueEstimated ?? null,
      source: 'FMP' as const,
    }),
  );

  for (const w of watchlist) {
    if (!w.manual_earnings_date) continue;
    rows.push({
      user_id: userId,
      ticker: w.ticker,
      earnings_date: w.manual_earnings_date,
      timing: (w.manual_timing || 'UNK') as string,
      consensus_eps: null,
      consensus_rev: null,
      source: 'MANUAL' as const,
    });
  }

  const dedupedRows = Array.from(
    new Map(rows.map(r => [`${r.user_id}:${r.ticker}:${r.earnings_date}`, r])).values(),
  );

  const { error } = await sb
    .from('earnings_events')
    .upsert(dedupedRows, { onConflict: 'user_id,ticker,earnings_date' });

  if (error) throw new Error(error.message);

  await sb
    .from('earnings_events')
    .delete()
    .eq('user_id', userId)
    .lt('earnings_date', today)
    .eq('source', 'FMP')
    .in('ticker', [...tickerSet]);

  await pruneOrphansNotOnWatchlist(sb, userId, tickerSet, today);

  const upcoming = dedupedRows
    .filter(r => r.earnings_date >= today)
    .sort((a, b) => a.earnings_date.localeCompare(b.earnings_date));

  const nextEarning =
    upcoming[0] != null
      ? { ticker: upcoming[0].ticker, date: upcoming[0].earnings_date }
      : null;

  return {
    updated: dedupedRows.length,
    tickers: [...new Set(dedupedRows.map(r => r.ticker))],
    fmpRowsInRange,
    watchlistCount: watchlist.length,
    nextEarning,
  };
}

export async function runUpdateCalendarJob(
  options: UpdateCalendarOptions = {},
): Promise<UpdateCalendarJobResult> {
  const sb = supabaseAdmin();

  if (options.userId) {
    return runUpdateCalendarForUser(sb, options.userId);
  }

  const userIds = await listWatchlistUserIds(sb);
  if (!userIds.length) {
    return { message: 'empty watchlist' };
  }

  let totalUpdated = 0;
  let fmpRowsInRange = 0;
  let watchlistCount = 0;
  let nextEarning: { ticker: string; date: string } | null = null;
  const tickers = new Set<string>();

  for (const userId of userIds) {
    const res = await runUpdateCalendarForUser(sb, userId);
    if ('message' in res) continue;
    totalUpdated += res.updated;
    fmpRowsInRange = Math.max(fmpRowsInRange, res.fmpRowsInRange);
    watchlistCount += res.watchlistCount;
    res.tickers.forEach(t => tickers.add(t));
    if (!nextEarning && res.nextEarning) nextEarning = res.nextEarning;
    else if (res.nextEarning && nextEarning && res.nextEarning.date < nextEarning.date) {
      nextEarning = res.nextEarning;
    }
  }

  if (watchlistCount === 0) {
    return { message: 'empty watchlist' };
  }

  return {
    updated: totalUpdated,
    tickers: [...tickers],
    fmpRowsInRange,
    watchlistCount,
    nextEarning,
  };
}
