import { NextRequest, NextResponse } from 'next/server';
import { loadAiBriefPayload, loadAiBriefPayloadByTickerDate } from '@/lib/buildAiBriefPayload';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

/** POST { brief_id } or { ticker, earnings_date } → fresh AiBriefPayload. */
export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  let body: { brief_id?: string; ticker?: string; earnings_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const briefId = body.brief_id?.trim();
  const ticker = body.ticker?.trim().toUpperCase();
  const earningsDate = body.earnings_date?.trim();

  let payload = null;
  if (briefId) {
    payload = await loadAiBriefPayload(auth.sb, briefId);
  } else if (ticker && earningsDate) {
    payload = await loadAiBriefPayloadByTickerDate(auth.sb, ticker, earningsDate);
  } else {
    return NextResponse.json(
      { error: 'brief_id or (ticker + earnings_date) required' },
      { status: 400 },
    );
  }

  if (!payload) {
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 });
  }

  return NextResponse.json(payload);
}
