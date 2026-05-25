import { NextRequest, NextResponse } from 'next/server';
import { loadBriefAiAnalyses } from '@/lib/loadBriefAiAnalyses';
import { latestScanTimestamp } from '@/lib/aiScanCooldown';
import { getTickerScanLock } from '@/lib/tickerScanLock';
import { supabaseAdmin } from '@/lib/supabase';

/** GET ?brief_id=&ticker=&earnings_date= — lock + latest scan timestamps for peer wait polling. */
export async function GET(req: NextRequest) {
  const briefId = req.nextUrl.searchParams.get('brief_id')?.trim();
  const ticker = req.nextUrl.searchParams.get('ticker')?.trim();
  const earningsDate = req.nextUrl.searchParams.get('earnings_date')?.trim();

  if (!briefId || !ticker || !earningsDate) {
    return NextResponse.json(
      { error: 'brief_id, ticker, and earnings_date required' },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const lock = await getTickerScanLock(sb, ticker);

  const { data: briefRow } = await sb
    .from('earnings_briefs')
    .select('updated_at, generated_at')
    .eq('id', briefId)
    .maybeSingle();

  const systemScanAt =
    (briefRow?.updated_at as string | null) ??
    (briefRow?.generated_at as string | null) ??
    null;

  const { lastAiScanAt, lastConsensusAt } = await loadBriefAiAnalyses(
    sb,
    briefId,
    ticker,
    earningsDate,
  );

  const latestResultsAt = latestScanTimestamp(
    systemScanAt,
    lastAiScanAt,
    lastConsensusAt,
  );

  const scanCompleteForLock =
    !!lock.lockStartedAt &&
    !!lastConsensusAt &&
    lastConsensusAt >= lock.lockStartedAt;

  return NextResponse.json({
    ...lock,
    systemScanAt,
    lastAiScanAt,
    lastConsensusAt,
    latestResultsAt,
    scanCompleteForLock,
  });
}
