'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { earningsSessionDate } from '@/lib/earningsDate';

export type WatchlistFormState = { error?: string };

export async function addTicker(
  _prev: WatchlistFormState,
  formData: FormData
): Promise<WatchlistFormState> {
  const ticker = (formData.get('ticker') as string)?.toUpperCase().trim();
  const thesisRaw = formData.get('thesis') as string | null;
  const thesis = thesisRaw?.trim() || null;

  if (!ticker) {
    return { error: 'Ticker is required' };
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from('watchlist')
    .upsert({ ticker, thesis, active: true }, { onConflict: 'ticker' });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/watchlist');
  return {};
}

export async function toggleTicker(formData: FormData) {
  const id = formData.get('id') as string;
  const active = formData.get('active') === 'true';

  const sb = supabaseAdmin();
  const { error } = await sb.from('watchlist').update({ active: !active }).eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/watchlist');
}

export async function deleteTicker(formData: FormData) {
  const id = formData.get('id') as string;

  const sb = supabaseAdmin();
  const { error } = await sb.from('watchlist').delete().eq('id', id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/watchlist');
}

// ─── Batch import ────────────────────────────────────────────────────────────

export type BatchImportResult = {
  added: string[];
  skipped: string[];
  errors: string[];
};

/**
 * Fuzzy line parser — handles pipe, tab, comma, or just whitespace as delimiters.
 * Extracts: TICKER, date string ("Mon May 11", "2026-05-11", "May 11", etc.), timing.
 *
 * Returns null for blank / comment lines.
 */
function parseBatchLine(
  line: string,
  year: number
): { ticker: string; dateIso: string; timing: 'BMO' | 'AMC' | 'UNK' } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  // Split on pipe, tab, comma, or 2+ spaces
  const parts = trimmed.split(/\s*[|,\t]\s*|\s{2,}/).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const ticker = parts[0].toUpperCase().replace(/[^A-Z0-9.]/, '');
  if (!ticker) return null;

  // Detect timing from any part
  let timing: 'BMO' | 'AMC' | 'UNK' = 'UNK';
  for (const p of parts) {
    if (/\bAMC\b/i.test(p)) { timing = 'AMC'; break; }
    if (/\bBMO\b/i.test(p)) { timing = 'BMO'; break; }
  }

  // Find the part that looks like a date
  const MONTH_MAP: Record<string, number> = {
    jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
    jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  };
  let dateIso: string | null = null;

  for (const p of parts) {
    // Already ISO: 2026-05-11
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) { dateIso = p; break; }

    // "Mon May 11", "May 11", "May 11 2026", "11 May", etc.
    const monthMatch = p.match(/([A-Za-z]{3,})\s+(\d{1,2})(?:\s+(\d{4}))?/)
      || p.match(/(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?/);
    if (monthMatch) {
      const isNumFirst = /^\d/.test(monthMatch[0]);
      const monthStr = isNumFirst ? monthMatch[2] : monthMatch[1];
      const dayStr   = isNumFirst ? monthMatch[1] : monthMatch[2];
      const yearStr  = monthMatch[3];
      const month = MONTH_MAP[monthStr.toLowerCase().slice(0, 3)];
      const day = parseInt(dayStr, 10);
      const y = yearStr ? parseInt(yearStr, 10) : year;
      if (month && day >= 1 && day <= 31) {
        dateIso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        break;
      }
    }
  }

  if (!dateIso) return null;
  return { ticker, dateIso, timing };
}

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

  const sb = supabaseAdmin();

  // 1. Upsert watchlist rows
  const watchlistRows = parsed.map(r => ({
    ticker: r.ticker,
    active: true,
  }));
  const { error: wlErr } = await sb
    .from('watchlist')
    .upsert(watchlistRows, { onConflict: 'ticker', ignoreDuplicates: false });
  if (wlErr) return { error: `Watchlist upsert failed: ${wlErr.message}` };

  // 2. Upsert earnings_events rows
  const eventRows = parsed.map(r => ({
    ticker: r.ticker,
    earnings_date: r.dateIso,
    timing: r.timing,
    source: 'MANUAL' as const,
  }));
  const { error: evErr } = await sb
    .from('earnings_events')
    .upsert(eventRows, { onConflict: 'ticker,earnings_date' });
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

  const sb = supabaseAdmin();
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
