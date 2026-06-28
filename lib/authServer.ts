import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AuthSession = {
  sb: SupabaseClient;
  user: User;
};

export async function requireAuthSession(): Promise<AuthSession> {
  const sb = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  return { sb, user };
}

export async function requireAuthApi(): Promise<AuthSession | NextResponse> {
  const sb = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return { sb, user };
}

export function isAuthApiResult(
  result: AuthSession | NextResponse,
): result is AuthSession {
  return !(result instanceof NextResponse);
}

/** Cron / service role: distinct users with at least one watchlist row. */
export async function listWatchlistUserIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from('watchlist').select('user_id');
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map(r => r.user_id as string).filter(Boolean))];
}
