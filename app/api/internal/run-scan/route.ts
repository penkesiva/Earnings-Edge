/**
 * Internal-only route — called by the dashboard buttons.
 * No CRON_SECRET required (same-origin, not in vercel.json cron schedule).
 * maxDuration = 300 so it inherits the 5-min limit, bypassing the Server
 * Action 10s cap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDailyScanJob } from '@/lib/jobs/daily-scan';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { assertScanRunAllowed } from '@/lib/tickerScanLock';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prep = body?.prep === 'tomorrow';

  // Allow explicit date override (e.g. from "PREP [date]" buttons in Next 7 Days)
  const explicitDate: string | undefined =
    typeof body?.targetDate === 'string' ? body.targetDate : undefined;

  // Brief-page re-scan: single ticker only
  const singleTicker: string | undefined =
    typeof body?.ticker === 'string' ? body.ticker : undefined;

  const scanRunId: string | undefined =
    typeof body?.scan_run_id === 'string' ? body.scan_run_id : undefined;

  if (singleTicker) {
    const denied = await assertScanRunAllowed(supabaseAdmin(), singleTicker, scanRunId);
    if (denied) return denied;
  }

  const targetDate = explicitDate ?? (prep ? addCalendarDays(earningsSessionDate(), 1) : undefined);

  try {
    const result = await runDailyScanJob({
      targetDate,
      singleTicker,
      sendNotifications: !prep && !singleTicker,
    });

    if ('idleReason' in result) {
      return NextResponse.json({
        count: 0,
        idleReason: result.idleReason,
        targetDate: targetDate ?? earningsSessionDate(),
        prep,
        ...(result.idleReason === 'no_earnings_on_session_date'
          ? { nextScheduled: result.nextScheduled, sessionDate: result.sessionDate }
          : {}),
      });
    }
    return NextResponse.json({ count: result.count, targetDate: targetDate ?? earningsSessionDate() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
