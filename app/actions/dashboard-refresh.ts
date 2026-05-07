'use server';

import { revalidatePath } from 'next/cache';
import { runUpdateCalendarJob } from '@/lib/jobs/update-calendar';
import type { UpdateCalendarJobResult } from '@/lib/jobs/update-calendar';
import { runDailyScanJob } from '@/lib/jobs/daily-scan';
import type { DailyScanJobResult } from '@/lib/jobs/daily-scan';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

export type RefreshResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function formatCalendarMessage(res: UpdateCalendarJobResult): string {
  if ('message' in res) {
    return 'Watchlist is empty — add tickers on WATCHLIST first.';
  }

  const { updated, nextEarning } = res;

  if (updated === 0) {
    const { fmpRowsInRange, watchlistCount } = res;
    let tail =
      ' Daily scan only builds briefs on the day each name actually reports.';
    if (fmpRowsInRange === 0) {
      tail +=
        ' FMP returned no earnings rows for that 30-day window (empty response, bad API key, or your plan may block the earnings-calendar endpoint on free tier).';
    } else {
      tail += ` FMP returned ${fmpRowsInRange} rows that week/range but none matched your ${watchlistCount} tickers — verify symbols match FMP exactly (e.g. IPO tickers, class A vs common).`;
    }
    return `Calendar sync: 0 rows stored for your watchlist.${tail}`;
  }

  const next =
    nextEarning != null
      ? ` Next: ${nextEarning.ticker} on ${nextEarning.date}.`
      : '';
  return `Earnings calendar synced (${updated} row${updated === 1 ? '' : 's'} for your watchlist).${next}`;
}

function formatScanMessage(res: DailyScanJobResult): string {
  if ('idleReason' in res) {
    if (res.idleReason === 'empty_watchlist') {
      return 'Watchlist is empty — add tickers on WATCHLIST first.';
    }
    const next = res.nextScheduled;
    const tail = next
      ? ` Next watchlist earnings in your DB: ${next.ticker} on ${next.earnings_date} — run daily scan on that US session date.`
      : ` No upcoming dates found in the database for your tickers — press Sync calendar first. If sync reports 0 matching rows, FMP may be empty for your plan or symbols may not match FMP tickers.`;
    return (
      `No watchlist ticker has earnings on ${res.sessionDate} (US session date). ` + tail
    );
  }
  const count = res.count;
  if (count === 0) return 'Scan finished (no tickers processed).';
  return `Daily scan finished (${count} ticker${count === 1 ? '' : 's'}).`;
}

/**
 * Runs the same job as GET /api/cron/update-calendar WITHOUT requiring CRON_SECRET
 * (trusted server action from your session/host only — not a public API).
 */
export async function syncCalendarAction(): Promise<RefreshResult> {
  try {
    const res = await runUpdateCalendarJob();
    revalidatePath('/');
    revalidatePath('/history');
    return { ok: true, message: formatCalendarMessage(res) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Runs the same job as GET /api/cron/daily-scan WITHOUT requiring CRON_SECRET.
 * Vercel Cron and scripted callers should still use the HTTP route + CRON_SECRET.
 */
export async function runDailyScanAction(): Promise<RefreshResult> {
  try {
    const res = await runDailyScanJob();
    revalidatePath('/');
    revalidatePath('/history');
    return { ok: true, message: formatScanMessage(res) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Day-ahead prep: generate briefs for tomorrow's session date without notifications.
 */
export async function runTomorrowPrepAction(): Promise<RefreshResult> {
  try {
    const tomorrow = addCalendarDays(earningsSessionDate(), 1);
    const res = await runDailyScanJob({ targetDate: tomorrow, sendNotifications: false });
    revalidatePath('/');
    revalidatePath('/history');
    if ('idleReason' in res) {
      if (res.idleReason === 'empty_watchlist') {
        return { ok: true, message: 'Tomorrow prep skipped: watchlist is empty.' };
      }
      return {
        ok: true,
        message: `Tomorrow prep found no watchlist earnings on ${tomorrow}.`,
      };
    }
    return {
      ok: true,
      message: `Tomorrow prep finished (${res.count} ticker${res.count === 1 ? '' : 's'} for ${tomorrow}).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
