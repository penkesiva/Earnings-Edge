/**
 * Weekly cron — refreshes the earnings calendar for the next 30 days.
 * Runs Sundays 8am UTC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getEarningsCalendar } from '@/lib/fmp';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // Tickers we care about
  const { data: watchlist } = await sb
    .from('watchlist')
    .select('ticker')
    .eq('active', true);

  if (!watchlist?.length) {
    return NextResponse.json({ message: 'empty watchlist' });
  }

  const tickerSet = new Set(watchlist.map(w => w.ticker));

  // Fetch FMP calendar for next 30 days
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const all = await getEarningsCalendar(today, in30);

  // Filter to watchlist
  const relevant = all.filter(e => tickerSet.has(e.symbol));

  // Upsert
  const rows = relevant.map(e => ({
    ticker: e.symbol,
    earnings_date: e.date,
    timing: (e.time === 'amc' ? 'AMC' : e.time === 'bmo' ? 'BMO' : 'UNK') as any,
    consensus_eps: e.epsEstimated,
    consensus_rev: e.revenueEstimated,
  }));

  const { error } = await sb
    .from('earnings_events')
    .upsert(rows, { onConflict: 'ticker,earnings_date' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    updated: rows.length,
    tickers: rows.map(r => r.ticker),
  });
}
