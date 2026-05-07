/**
 * Daily scan cron — runs 6am PT weekdays.
 *
 * HTTP callers (e.g. Vercel Cron) must send Authorization: Bearer CRON_SECRET.
 * The in-app "Run daily scan" button calls the same job without a secret — see
 * lib/jobs/daily-scan.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDailyScanJob } from '@/lib/jobs/daily-scan';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';

export const maxDuration = 300; // 5 min — requires Vercel Pro or higher

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?prep=tomorrow → build briefs for tomorrow's session date, no notifications
  const prep = req.nextUrl.searchParams.get('prep');
  const targetDate =
    prep === 'tomorrow'
      ? addCalendarDays(earningsSessionDate(), 1)
      : undefined;

  try {
    const result = await runDailyScanJob({
      targetDate,
      sendNotifications: prep !== 'tomorrow',
    });
    if ('idleReason' in result) {
      return NextResponse.json({
        count: 0,
        idleReason: result.idleReason,
        sessionDate:
          result.idleReason === 'no_earnings_on_session_date'
            ? result.sessionDate
            : undefined,
        nextScheduled:
          result.idleReason === 'no_earnings_on_session_date'
            ? result.nextScheduled
            : undefined,
      });
    }
    return NextResponse.json({
      count: result.count,
      results: result.results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
