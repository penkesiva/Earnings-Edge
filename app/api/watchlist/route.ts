import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const sb = supabaseAdmin();
  const { data } = await sb.from('watchlist').select('*').order('ticker');
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ticker, thesis, conviction_mult } = body;

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('watchlist')
    .upsert(
      {
        ticker: ticker.toUpperCase(),
        thesis,
        conviction_mult: conviction_mult ?? 1.0,
        active: true,
      },
      { onConflict: 'ticker' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
