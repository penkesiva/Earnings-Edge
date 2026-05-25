import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_SCAN_COOLDOWN_MS } from '@/lib/aiScanCooldown';

export type TickerScanLockStatus = {
  ticker: string;
  isLocked: boolean;
  lockedUntil: string | null;
  runId: string | null;
  waitMs: number;
};

export function msUntilIso(iso: string | null | undefined, nowMs = Date.now()): number {
  if (!iso) return 0;
  return Math.max(0, new Date(iso).getTime() - nowMs);
}

export async function getTickerScanLock(
  sb: SupabaseClient,
  ticker: string,
): Promise<TickerScanLockStatus> {
  const normalized = ticker.trim().toUpperCase();
  const { data } = await sb
    .from('ticker_scan_locks')
    .select('run_id, locked_until')
    .eq('ticker', normalized)
    .maybeSingle();

  const lockedUntil = (data?.locked_until as string | undefined) ?? null;
  const waitMs = msUntilIso(lockedUntil);
  const isLocked = waitMs > 0;

  return {
    ticker: normalized,
    isLocked,
    lockedUntil: isLocked ? lockedUntil : null,
    runId: isLocked ? ((data?.run_id as string | undefined) ?? null) : null,
    waitMs,
  };
}

export type AcquireScanLockResult =
  | { acquired: true; runId: string; lockedUntil: string }
  | { acquired: false; lockedUntil: string; runId: string | null; waitMs: number };

export async function acquireTickerScanLock(
  sb: SupabaseClient,
  ticker: string,
  briefId?: string,
): Promise<AcquireScanLockResult> {
  const normalized = ticker.trim().toUpperCase();
  const lockMinutes = Math.round(AI_SCAN_COOLDOWN_MS / 60_000);

  const { data, error } = await sb.rpc('acquire_ticker_scan_lock', {
    p_ticker: normalized,
    p_brief_id: briefId ?? null,
    p_lock_minutes: lockMinutes,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = data as {
    acquired?: boolean;
    locked_until?: string;
    run_id?: string;
  };

  const lockedUntil = row.locked_until ?? new Date(Date.now() + AI_SCAN_COOLDOWN_MS).toISOString();

  if (row.acquired && row.run_id) {
    return { acquired: true, runId: row.run_id, lockedUntil };
  }

  return {
    acquired: false,
    lockedUntil,
    runId: row.run_id ?? null,
    waitMs: msUntilIso(lockedUntil),
  };
}

/** Reject when another Scan All holds the ticker lock. */
export async function assertScanRunAllowed(
  sb: SupabaseClient,
  ticker: string,
  scanRunId?: string | null,
): Promise<NextResponse | null> {
  const status = await getTickerScanLock(sb, ticker);
  if (!status.isLocked) return null;
  if (scanRunId && status.runId === scanRunId) return null;

  return NextResponse.json(
    {
      error: `${status.ticker} Scan All in progress — try again in ${Math.ceil(status.waitMs / 60_000)}m`,
      lockedUntil: status.lockedUntil,
      waitMs: status.waitMs,
    },
    { status: 409 },
  );
}
