/**
 * Weekly cron — refreshes the earnings calendar for the next 30 days.
 * Runs Sundays 8am UTC.
 *
 * HTTP callers (e.g. Vercel Cron) must send Authorization: Bearer CRON_SECRET.
 * The in-app "Sync calendar" button calls the same logic without a secret — see
 * lib/jobs/update-calendar.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { runUpdateCalendarJob } from '@/lib/jobs/update-calendar';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const res = await runUpdateCalendarJob();
    if ('message' in res) {
      return NextResponse.json({ message: res.message });
    }
    return NextResponse.json({
      updated: res.updated,
      tickers: res.tickers,
      fmpRowsInRange: res.fmpRowsInRange,
      watchlistCount: res.watchlistCount,
      nextEarning: res.nextEarning,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
