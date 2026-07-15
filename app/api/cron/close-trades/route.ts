/**
 * Close-out cron — weekdays 19:50 UTC (~3:50pm ET, 10 min before the close).
 *
 * Flattens auto-trade positions whose earnings reaction day has arrived:
 *   BMO on date D → closed at D's close; AMC/UNK → next trading day's close.
 * Realized paper P&L is written to trade_orders and summarized via WhatsApp.
 *
 * HTTP callers must send Authorization: Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { closeDueTrades } from '@/lib/tradeCloser';
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

  // Any user with an open auto-trade order (kill switch does not block
  // risk-reducing exits — it only stops new entries).
  const { data: rows, error } = await sb
    .from('trade_orders')
    .select('user_id')
    .in('status', ['submitted', 'filled'])
    .is('closed_at', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((rows ?? []).map(r => r.user_id as string))];
  const results: Array<{
    userId: string;
    closed: number;
    failed: number;
    messages: string[];
  }> = [];

  for (const userId of userIds) {
    try {
      const result = await closeDueTrades(sb, userId);
      if (result.attempted > 0) {
        results.push({
          userId,
          closed: result.closed,
          failed: result.failed,
          messages: result.messages,
        });
      }
    } catch (e) {
      results.push({
        userId,
        closed: 0,
        failed: 0,
        messages: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  let whatsapp: string | null = null;
  if (whatsappConfigured() && results.length > 0) {
    const totalClosed = results.reduce((a, r) => a + r.closed, 0);
    const totalFailed = results.reduce((a, r) => a + r.failed, 0);
    const headline = `${totalClosed} position(s) closed${totalFailed ? `, ${totalFailed} failed` : ''}`;
    const detailLines = results.flatMap(r => r.messages).slice(0, 12);
    const body = [`Earnings Edge · ${today}`, `Close-out: ${headline}`, '', ...detailLines].join('\n');
    const sent = await sendWhatsAppMessage(body);
    whatsapp = sent.ok ? 'sent' : `error: ${sent.error}`;
  }

  return NextResponse.json({ date: today, users: userIds.length, results, whatsapp });
}
