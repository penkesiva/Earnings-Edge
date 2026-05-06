'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

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
