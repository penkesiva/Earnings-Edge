import { NextRequest, NextResponse } from 'next/server';
import { acquireTickerScanLock, getTickerScanLock } from '@/lib/tickerScanLock';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

/** GET ?ticker=HPQ — current lock status for Scan All cooldown UI. */
export async function GET(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const ticker = req.nextUrl.searchParams.get('ticker')?.trim();
  if (!ticker) {
    return NextResponse.json({ error: 'ticker query param required' }, { status: 400 });
  }

  const status = await getTickerScanLock(auth.sb, auth.user.id, ticker);
  return NextResponse.json(status);
}

/** POST { ticker, brief_id? } — atomic acquire; first caller wins for ~5 minutes. */
export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  let body: { ticker?: string; brief_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ticker = body.ticker?.trim();
  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  try {
    const result = await acquireTickerScanLock(
      auth.sb,
      auth.user.id,
      ticker,
      body.brief_id,
    );

    if (!result.acquired) {
      return NextResponse.json(
        {
          acquired: false,
          lockedUntil: result.lockedUntil,
          waitMs: result.waitMs,
          message: `${ticker.toUpperCase()} scan in progress — wait for the current Scan All to finish.`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      acquired: true,
      runId: result.runId,
      lockedUntil: result.lockedUntil,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lock failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
