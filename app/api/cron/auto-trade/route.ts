/**
 * Auto-trade cron — weekdays ~1 hour before US market close (19:00 UTC ≈ 3pm ET).
 *
 * For every user with auto-trade enabled (and kill switch off), places paper
 * orders for consensus GO names in the entry window:
 *   - today's AMC reporters (enter before the close)
 *   - next trading day's BMO reporters (enter for the morning print)
 *
 * HTTP callers must send Authorization: Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { executeAutoTrades } from '@/lib/autoTradeExecutor';
import { earningsSessionDate } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';
import { sendWhatsAppMessage, whatsappConfigured } from '@/lib/whatsapp';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = earningsSessionDate();
  if (!isTradingDay(today)) {
    return NextResponse.json({ skipped: 'market closed', date: today });
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from('automation_settings')
    .select('user_id')
    .eq('auto_trade_enabled', true)
    .eq('kill_switch', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((rows ?? []).map(r => r.user_id as string))];
  const results: Array<{
    userId: string;
    submitted: number;
    failed: number;
    skipped: number;
    messages: string[];
  }> = [];

  for (const userId of userIds) {
    try {
      const result = await executeAutoTrades(sb, userId);
      results.push({
        userId,
        submitted: result.submitted,
        failed: result.failed,
        skipped: result.skipped,
        messages: result.messages,
      });
    } catch (e) {
      results.push({
        userId,
        submitted: 0,
        failed: 0,
        skipped: 0,
        messages: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  // WhatsApp summary to the owner (NOTIFY_WHATSAPP_TO) — one message per run.
  let whatsapp: string | null = null;
  if (whatsappConfigured() && results.length > 0) {
    const totalSubmitted = results.reduce((a, r) => a + r.submitted, 0);
    const totalFailed = results.reduce((a, r) => a + r.failed, 0);
    const headline =
      totalSubmitted > 0
        ? `${totalSubmitted} paper order(s) placed${totalFailed ? `, ${totalFailed} failed` : ''}`
        : totalFailed > 0
          ? `No orders placed — ${totalFailed} failed`
          : 'No trades this run';
    const detailLines = results.flatMap(r => r.messages).slice(0, 12);
    const body = [`Earnings Edge · ${today}`, `Auto-trade: ${headline}`, '', ...detailLines].join('\n');

    const sent = await sendWhatsAppMessage(body);
    whatsapp = sent.ok ? 'sent' : `error: ${sent.error}`;
  }

  return NextResponse.json({ date: today, users: userIds.length, results, whatsapp });
}
