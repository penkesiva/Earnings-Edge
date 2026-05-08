/**
 * Internal-only route — called by the dashboard buttons.
 * No CRON_SECRET required (same-origin, not in vercel.json cron schedule).
 * maxDuration = 300 so it inherits the 5-min limit, bypassing the Server
 * Action 10s cap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDailyScanJob } from '@/lib/jobs/daily-scan';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const prep = body?.prep === 'tomorrow';

  const targetDate = prep ? addCalendarDays(earningsSessionDate(), 1) : undefined;

  try {
    const result = await runDailyScanJob({
      targetDate,
      sendNotifications: !prep,
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
