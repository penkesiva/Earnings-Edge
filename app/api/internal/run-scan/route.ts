import { NextRequest, NextResponse } from 'next/server';
import { runDailyScanJob } from '@/lib/jobs/daily-scan';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { assertScanRunAllowed } from '@/lib/tickerScanLock';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const body = await req.json().catch(() => ({}));
  const prep = body?.prep === 'tomorrow';

  const explicitDate: string | undefined =
    typeof body?.targetDate === 'string' ? body.targetDate : undefined;

  const singleTicker: string | undefined =
    typeof body?.ticker === 'string' ? body.ticker : undefined;

  const scanRunId: string | undefined =
    typeof body?.scan_run_id === 'string' ? body.scan_run_id : undefined;

  if (singleTicker) {
    const denied = await assertScanRunAllowed(
      auth.sb,
      auth.user.id,
      singleTicker,
      scanRunId,
    );
    if (denied) return denied;
  }

  const targetDate = explicitDate ?? (prep ? addCalendarDays(earningsSessionDate(), 1) : undefined);

  try {
    const result = await runDailyScanJob({
      userId: auth.user.id,
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
