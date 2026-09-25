/**
 * Intraday automation — 1-min steps during US RTH (weekdays).
 * Users with intraday_settings.automation_enabled; uses paper/live from automation_settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from('intraday_settings')
    .select('user_id, symbol, strategy_id, automation_enabled')
    .eq('automation_enabled', true);

  if (error) {
    if (/relation|does not exist/i.test(error.message)) {
      return NextResponse.json({ skipped: 'migration pending' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Phase 2: SessionRunner.step per user (paper/live orders via BrokerAdapter).
  return NextResponse.json({
    ok: true,
    enabled: rows?.length ?? 0,
    message: 'Cron registered — live stepping ships in next phase.',
  });
}
