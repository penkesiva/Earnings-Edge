import { NextRequest, NextResponse } from 'next/server';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

export async function GET() {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const { data } = await auth.sb.from('watchlist').select('*').order('ticker');
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const body = await req.json();
  const { ticker, thesis, conviction_mult } = body;

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  const { data, error } = await auth.sb
    .from('watchlist')
    .upsert(
      {
        user_id: auth.user.id,
        ticker: ticker.toUpperCase(),
        thesis,
        conviction_mult: conviction_mult ?? 1.0,
        active: true,
      },
      { onConflict: 'user_id,ticker' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
