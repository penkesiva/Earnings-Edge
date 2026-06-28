'use server';

import { requireAuthSession } from '@/lib/authServer';
import { revalidatePath } from 'next/cache';
import { earningsSessionDate } from '@/lib/earningsDate';
import { parseBatchLine } from '@/lib/batchImportParse';
import { pruneTickerFromApp } from '@/lib/pruneTickerData';
import {
  addCandidateToWatchlist,
  dismissEarningsCandidate,
  fetchAndStoreEarningsCandidates,
  type FetchDiscoveryResult,
} from '@/lib/earningsDiscovery';

export type WatchlistFormState = { error?: string };

export async function addTicker(
  _prev: WatchlistFormState,
  formData: FormData
): Promise<WatchlistFormState> {
  const ticker = (formData.get('ticker') as string)?.toUpperCase().trim();

  if (!ticker) {
    return { error: 'Ticker is required' };
  }

  const { sb, user } = await requireAuthSession();
  const { error } = await sb
    .from('watchlist')
    .upsert({ user_id: user.id, ticker, active: true }, { onConflict: 'user_id,ticker' });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/watchlist');
  return {};
}

export async function toggleTicker(formData: FormData) {
  const id = formData.get('id') as string;
  const active = formData.get('active') === 'true';

  const { sb } = await requireAuthSession();
  const { error } = await sb.from('watchlist').update({ active: !active }).eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/watchlist');
}

export async function deleteTicker(formData: FormData) {
  const id = formData.get('id') as string;

  const { sb, user } = await requireAuthSession();
  const { data: row, error: fetchError } = await sb
    .from('watchlist')
    .select('ticker')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) throw new Error(fetchError.message);

  const { error } = await sb.from('watchlist').delete().eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  if (row?.ticker) {
    await pruneTickerFromApp(sb, user.id, row.ticker);
  }

  revalidatePath('/watchlist');
  revalidatePath('/');
  revalidatePath('/history');
}

// ─── Batch import ────────────────────────────────────────────────────────────

export type BatchImportResult = {
  added: string[];
  skipped: string[];
  errors: string[];
};

export async function batchImport(
  _prev: { result?: BatchImportResult; error?: string },
  formData: FormData
): Promise<{ result?: BatchImportResult; error?: string }> {
  const raw = (formData.get('lines') as string | null) ?? '';
  if (!raw.trim()) return { error: 'Paste at least one line.' };

  const today = earningsSessionDate();
  const year = new Date(today).getFullYear();
  const lines = raw.split('\n');

  const parsed: Array<{ ticker: string; dateIso: string; timing: 'BMO' | 'AMC' | 'UNK' }> = [];
  const parseErrors: string[] = [];

  for (const line of lines) {
    const row = parseBatchLine(line, year);
    if (!row) continue; // blank / comment — silently skip
    if (!row.dateIso) {
      parseErrors.push(`Could not parse date from: "${line.trim()}"`);
      continue;
    }
    parsed.push(row);
  }

  if (parsed.length === 0) {
    return {
      error:
        parseErrors.length
          ? `No rows parsed. Errors:\n${parseErrors.join('\n')}`
          : 'No recognisable rows found. Expected format: TICKER | Mon DD | AMC',
    };
  }

  const { sb, user } = await requireAuthSession();

  // 1. Upsert watchlist rows — include manual date + timing so the UI column shows them
  const watchlistRows = parsed.map(r => ({
    user_id: user.id,
    ticker: r.ticker,
    active: true,
    manual_earnings_date: r.dateIso,
    manual_timing: r.timing,
  }));
  const { error: wlErr } = await sb
    .from('watchlist')
    .upsert(watchlistRows, { onConflict: 'user_id,ticker', ignoreDuplicates: false });
  if (wlErr) return { error: `Watchlist upsert failed: ${wlErr.message}` };

  // 2. Upsert earnings_events rows
  const eventRows = parsed.map(r => ({
    user_id: user.id,
    ticker: r.ticker,
    earnings_date: r.dateIso,
    timing: r.timing,
    source: 'MANUAL' as const,
  }));
  const { error: evErr } = await sb
    .from('earnings_events')
    .upsert(eventRows, { onConflict: 'user_id,ticker,earnings_date' });
  if (evErr) return { error: `Calendar upsert failed: ${evErr.message}` };

  revalidatePath('/watchlist');
  revalidatePath('/');

  return {
    result: {
      added: parsed.map(r => `${r.ticker} ${r.dateIso} ${r.timing}`),
      skipped: [],
      errors: parseErrors,
    },
  };
}

export async function setManualEarnings(formData: FormData) {
  const id = formData.get('id') as string;
  const rawDate = (formData.get('manual_earnings_date') as string | null)?.trim() || '';
  const rawTiming = (formData.get('manual_timing') as string | null)?.trim().toUpperCase() || '';

  const manual_earnings_date = rawDate === '' ? null : rawDate;
  const manual_timing =
    rawTiming === '' ? null : rawTiming === 'BMO' || rawTiming === 'AMC' || rawTiming === 'UNK'
      ? rawTiming
      : null;

  if (manual_earnings_date && !/^\d{4}-\d{2}-\d{2}$/.test(manual_earnings_date)) {
    throw new Error('Manual earnings date must be YYYY-MM-DD');
  }
  if (rawTiming && manual_timing === null) {
    throw new Error('Manual timing must be BMO, AMC, UNK, or empty');
  }

  const { sb } = await requireAuthSession();
  const { error } = await sb
    .from('watchlist')
    .update({ manual_earnings_date, manual_timing })
    .eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/watchlist');
  revalidatePath('/');
}

// ─── Earnings discovery ──────────────────────────────────────────────────────

export type DiscoveryActionState = {
  error?: string;
  success?: string;
  stats?: FetchDiscoveryResult;
};

export async function fetchUpcomingEarningsAction(): Promise<DiscoveryActionState> {
  try {
    const { sb, user } = await requireAuthSession();
    const stats = await fetchAndStoreEarningsCandidates(sb, user.id);
    revalidatePath('/watchlist');
    const rejectedTotal = Object.values(stats.rejected).reduce((a, b) => a + b, 0);
    return {
      success: `Found ${stats.pendingShown} names for the next 14 days (${rejectedTotal} filtered out).`,
      stats,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

export async function addDiscoveryCandidateAction(formData: FormData) {
  const id = formData.get('candidate_id') as string;
  const { sb, user } = await requireAuthSession();
  const result = await addCandidateToWatchlist(sb, user.id, id);
  if (!result.ok) throw new Error(result.error);
  revalidatePath('/watchlist');
  revalidatePath('/');
}

export async function dismissDiscoveryCandidateAction(formData: FormData) {
  const id = formData.get('candidate_id') as string;
  const { sb, user } = await requireAuthSession();
  const result = await dismissEarningsCandidate(sb, user.id, id);
  if (!result.ok) throw new Error(result.error);
  revalidatePath('/watchlist');
}

export async function addAllDiscoveryCandidatesAction() {
  const { sb, user } = await requireAuthSession();
  const { data: pending } = await sb
    .from('earnings_candidates')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .gte('earnings_date', earningsSessionDate());

  if (!pending?.length) return;

  for (const row of pending) {
    const result = await addCandidateToWatchlist(sb, user.id, row.id);
    if (!result.ok) throw new Error(result.error);
  }

  revalidatePath('/watchlist');
  revalidatePath('/');
}
