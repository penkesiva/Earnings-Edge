/**
 * Remove a ticker's upcoming dashboard data (calendar rows, briefs, scan log).
 * Past briefs/outcomes are kept for /history.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { earningsSessionDate } from '@/lib/earningsDate';

export async function pruneTickerFromApp(
  sb: SupabaseClient,
  ticker: string,
  fromDate: string = earningsSessionDate()
): Promise<void> {
  const t = ticker.toUpperCase();

  await sb.from('brief_scans').delete().eq('ticker', t);
  await sb.from('llm_scan_cache').delete().eq('ticker', t);

  const { error: eventsError } = await sb
    .from('earnings_events')
    .delete()
    .eq('ticker', t)
    .gte('earnings_date', fromDate);
  if (eventsError) throw new Error(eventsError.message);

  const { error: briefsError } = await sb
    .from('earnings_briefs')
    .delete()
    .eq('ticker', t)
    .gte('earnings_date', fromDate);
  if (briefsError) throw new Error(briefsError.message);
}

/** Drop calendar + brief rows for tickers not on the active watchlist (today onward). */
export async function pruneOrphansNotOnWatchlist(
  sb: SupabaseClient,
  activeTickers: Iterable<string>,
  fromDate: string = earningsSessionDate()
): Promise<string[]> {
  const allowed = new Set([...activeTickers].map(t => t.toUpperCase()));

  const { data: futureEvents, error } = await sb
    .from('earnings_events')
    .select('ticker')
    .gte('earnings_date', fromDate);

  if (error) throw new Error(error.message);

  const orphans = [
    ...new Set(
      (futureEvents ?? [])
        .map(e => e.ticker as string)
        .filter(t => !allowed.has(t.toUpperCase()))
    ),
  ];

  for (const ticker of orphans) {
    await pruneTickerFromApp(sb, ticker, fromDate);
  }

  // Briefs without a matching calendar row (e.g. bad import ticker)
  const { data: futureBriefs, error: briefsErr } = await sb
    .from('earnings_briefs')
    .select('ticker')
    .gte('earnings_date', fromDate);

  if (briefsErr) throw new Error(briefsErr.message);

  const briefOrphans = [
    ...new Set(
      (futureBriefs ?? [])
        .map(b => b.ticker as string)
        .filter(t => !allowed.has(t.toUpperCase()))
    ),
  ];

  const pruned = new Set(orphans.map(t => t.toUpperCase()));
  for (const ticker of briefOrphans) {
    if (!pruned.has(ticker.toUpperCase())) {
      await pruneTickerFromApp(sb, ticker, fromDate);
      pruned.add(ticker.toUpperCase());
    }
  }

  return [...pruned];
}
