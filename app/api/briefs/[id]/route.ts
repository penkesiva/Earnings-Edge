import { NextRequest, NextResponse } from 'next/server';
import { isAuthApiResult, requireAuthApi } from '@/lib/authServer';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const { data, error } = await auth.sb
    .from('earnings_briefs')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

// Log outcome
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthApi();
  if (!isAuthApiResult(auth)) return auth;

  const body = await req.json();

  const { data: brief } = await auth.sb
    .from('earnings_briefs')
    .select('ticker, earnings_date')
    .eq('id', params.id)
    .single();

  if (!brief) return NextResponse.json({ error: 'brief not found' }, { status: 404 });

  const { data, error } = await auth.sb
    .from('earnings_outcomes')
    .upsert(
      {
        brief_id: params.id,
        ticker: brief.ticker,
        earnings_date: brief.earnings_date,
        ...body,
      },
      { onConflict: 'brief_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
