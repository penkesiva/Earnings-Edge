import type { SupabaseClient } from '@supabase/supabase-js';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import {
  calendarTiming,
  EARNINGS_DISCOVERY_DAYS,
  passesDiscoveryFilter,
  type DiscoveryProfile,
} from '@/lib/earningsDiscoveryFilter';
import { getCompanyProfile, getEarningsCalendar, getQuotesBatch, type EarningsCalendarEntry } from '@/lib/fmp';

export type EarningsCandidateRow = {
  id: string;
  ticker: string;
  company_name: string | null;
  earnings_date: string;
  timing: 'BMO' | 'AMC' | 'UNK';
  price: number | null;
  market_cap: number | null;
  sector: string | null;
  industry: string | null;
  status: 'pending' | 'added' | 'dismissed';
};

export type FetchDiscoveryResult = {
  fetchedFromFmp: number;
  uniqueTickers: number;
  passedFilter: number;
  pendingShown: number;
  skippedDismissed: number;
  skippedAdded: number;
  rejected: Record<string, number>;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function dedupeCalendar(rows: EarningsCalendarEntry[]): EarningsCalendarEntry[] {
  const map = new Map<string, EarningsCalendarEntry>();
  for (const row of rows) {
    const ticker = row.symbol?.toUpperCase().trim();
    const date = row.date?.trim();
    if (!ticker || !date) continue;
    const key = `${ticker}:${date}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, symbol: ticker, date });
      continue;
    }
    if (!existing.time && row.time) map.set(key, { ...row, symbol: ticker, date });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
}

export async function fetchAndStoreEarningsCandidates(
  sb: SupabaseClient,
  userId: string,
): Promise<FetchDiscoveryResult> {
  const today = earningsSessionDate();
  const to = addCalendarDays(today, EARNINGS_DISCOVERY_DAYS);

  const calendar = await getEarningsCalendar(today, to);
  const deduped = dedupeCalendar(calendar);
  const uniqueTickers = [...new Set(deduped.map(r => r.symbol.toUpperCase()))];

  const quotes = await getQuotesBatch(uniqueTickers);

  // First pass: price + market cap from batch quotes (fast).
  const needsProfile = new Set<string>();
  const quoteProfileByTicker = new Map<string, DiscoveryProfile>();

  for (const ticker of uniqueTickers) {
    const q = quotes.get(ticker);
    const draft: DiscoveryProfile = {
      ticker,
      companyName: q?.name ?? null,
      sector: null,
      industry: null,
      price: q?.price ?? null,
      marketCap: q?.marketCap ?? null,
    };
    quoteProfileByTicker.set(ticker, draft);

    const result = passesDiscoveryFilter(draft);
    if (result.ok) {
      needsProfile.add(ticker);
      continue;
    }
    if (
      result.reason === 'pharma_excluded' ||
      result.reason === 'missing_market_cap' ||
      (result.reason === 'small_cap' && draft.marketCap != null)
    ) {
      // Final answer known from quote-only data.
      continue;
    }
    // Missing fields — try full profile once.
    needsProfile.add(ticker);
  }

  const profileExtras = await mapPool([...needsProfile], 8, async ticker => {
    try {
      return { ticker, profile: await getCompanyProfile(ticker) };
    } catch {
      return { ticker, profile: null };
    }
  });

  for (const { ticker, profile } of profileExtras) {
    if (!profile) continue;
    const base = quoteProfileByTicker.get(ticker)!;
    quoteProfileByTicker.set(ticker, {
      ticker,
      companyName: profile.companyName ?? base.companyName,
      sector: profile.sector,
      industry: profile.industry,
      price: profile.price ?? base.price,
      marketCap: profile.marketCap ?? base.marketCap,
    });
  }

  const rejected: Record<string, number> = {};
  const filtered = deduped.filter(row => {
    const profile = quoteProfileByTicker.get(row.symbol.toUpperCase());
    if (!profile) return false;
    const result = passesDiscoveryFilter(profile);
    if (result.ok) return true;
    rejected[result.reason] = (rejected[result.reason] ?? 0) + 1;
    return false;
  });

  const { data: existingRows } = await sb
    .from('earnings_candidates')
    .select('ticker, earnings_date, status')
    .eq('user_id', userId)
    .gte('earnings_date', today)
    .lte('earnings_date', to);

  const existingMap = new Map(
    (existingRows ?? []).map(r => [`${r.ticker}:${r.earnings_date}`, r.status as string]),
  );

  let skippedDismissed = 0;
  let skippedAdded = 0;
  const now = new Date().toISOString();

  for (const row of filtered) {
    const ticker = row.symbol.toUpperCase();
    const key = `${ticker}:${row.date}`;
    const prior = existingMap.get(key);

    if (prior === 'dismissed') {
      skippedDismissed++;
      continue;
    }
    if (prior === 'added') {
      skippedAdded++;
      continue;
    }

    const profile = quoteProfileByTicker.get(ticker)!;
    const timing = calendarTiming(row.time);

    const { error } = await sb.from('earnings_candidates').upsert(
      {
        user_id: userId,
        ticker,
        company_name: profile.companyName,
        earnings_date: row.date,
        timing,
        price: profile.price,
        market_cap: profile.marketCap,
        sector: profile.sector,
        industry: profile.industry,
        status: 'pending',
        fetched_at: now,
      },
      { onConflict: 'user_id,ticker,earnings_date', ignoreDuplicates: false },
    );

    if (error) throw new Error(error.message);
  }

  const validKeys = new Set(filtered.map(r => `${r.symbol.toUpperCase()}:${r.date}`));
  const { data: pendingInDb } = await sb
    .from('earnings_candidates')
    .select('id, ticker, earnings_date')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('earnings_date', today)
    .lte('earnings_date', to);

  const staleIds = (pendingInDb ?? [])
    .filter(r => !validKeys.has(`${r.ticker}:${r.earnings_date}`))
    .map(r => r.id);

  if (staleIds.length) {
    await sb.from('earnings_candidates').delete().in('id', staleIds);
  }

  const { count: pendingShown } = await sb
    .from('earnings_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('earnings_date', today);

  return {
    fetchedFromFmp: calendar.length,
    uniqueTickers: uniqueTickers.length,
    passedFilter: filtered.length,
    pendingShown: pendingShown ?? 0,
    skippedDismissed,
    skippedAdded,
    rejected,
  };
}

export async function listPendingEarningsCandidates(
  sb: SupabaseClient,
  userId: string,
): Promise<EarningsCandidateRow[]> {
  const today = earningsSessionDate();
  const { data, error } = await sb
    .from('earnings_candidates')
    .select(
      'id, ticker, company_name, earnings_date, timing, price, market_cap, sector, industry, status',
    )
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('earnings_date', today)
    .order('earnings_date', { ascending: true })
    .order('market_cap', { ascending: false, nullsFirst: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as EarningsCandidateRow[];
}

export async function addCandidateToWatchlist(
  sb: SupabaseClient,
  userId: string,
  candidateId: string,
): Promise<{ ok: true; ticker: string } | { ok: false; error: string }> {
  const { data: candidate, error: fetchErr } = await sb
    .from('earnings_candidates')
    .select('*')
    .eq('id', candidateId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!candidate) return { ok: false, error: 'Candidate not found.' };
  if (candidate.status === 'dismissed') {
    return { ok: false, error: 'This name was dismissed — fetch again to restore.' };
  }

  const ticker = String(candidate.ticker).toUpperCase();
  const earningsDate = String(candidate.earnings_date);
  const timing = (candidate.timing as 'BMO' | 'AMC' | 'UNK') || 'UNK';

  const { error: wlErr } = await sb.from('watchlist').upsert(
    {
      user_id: userId,
      ticker,
      active: true,
      manual_earnings_date: earningsDate,
      manual_timing: timing,
    },
    { onConflict: 'user_id,ticker' },
  );
  if (wlErr) return { ok: false, error: wlErr.message };

  const { error: evErr } = await sb.from('earnings_events').upsert(
    {
      user_id: userId,
      ticker,
      earnings_date: earningsDate,
      timing,
      consensus_eps: null,
      consensus_rev: null,
      source: 'FMP',
    },
    { onConflict: 'user_id,ticker,earnings_date' },
  );
  if (evErr) return { ok: false, error: evErr.message };

  const { error: markErr } = await sb
    .from('earnings_candidates')
    .update({ status: 'added', added_at: new Date().toISOString() })
    .eq('id', candidateId)
    .eq('user_id', userId);

  if (markErr) return { ok: false, error: markErr.message };

  return { ok: true, ticker };
}

export async function dismissEarningsCandidate(
  sb: SupabaseClient,
  userId: string,
  candidateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from('earnings_candidates')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', candidateId)
    .eq('user_id', userId)
    .eq('status', 'pending');

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
