import { parseSynthesisResponse, type Direction } from '@/lib/aiConsensus';
import { loadDashboardBriefAiByIds } from '@/lib/loadDashboardBriefAi';
import { getPreMarketFocusDates } from '@/lib/topEarningsPicks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTradedBriefIds } from '@/lib/automationSettings';

export type GoTradeCandidate = {
  briefId: string;
  ticker: string;
  earningsDate: string;
  direction: 'UP' | 'DOWN';
  compositeScore: number;
  confidence: string | null;
};

type BriefRow = {
  id: string;
  ticker: string;
  earnings_date: string;
  composite_score: number;
};

/** Active watchlist briefs with consensus GO + direction in the next 2 trading days. */
export async function loadGoTradeCandidates(
  sb: SupabaseClient,
  userId: string,
): Promise<GoTradeCandidate[]> {
  const focusDates = getPreMarketFocusDates(2);
  if (focusDates.length === 0) return [];

  const { data: watchlist, error: wlErr } = await sb
    .from('watchlist')
    .select('ticker')
    .eq('user_id', userId)
    .eq('active', true);

  if (wlErr) throw new Error(wlErr.message);
  const activeTickers = new Set((watchlist ?? []).map(w => w.ticker));
  if (activeTickers.size === 0) return [];

  const { data: briefs, error: briefErr } = await sb
    .from('earnings_briefs')
    .select('id, ticker, earnings_date, composite_score')
    .eq('user_id', userId)
    .in('earnings_date', focusDates)
    .order('composite_score', { ascending: false });

  if (briefErr) throw new Error(briefErr.message);

  const eligibleBriefs = (briefs ?? []).filter(
    b => activeTickers.has(b.ticker),
  ) as BriefRow[];
  if (eligibleBriefs.length === 0) return [];

  const briefIds = eligibleBriefs.map(b => b.id);
  const [aiMeta, tradedIds] = await Promise.all([
    loadDashboardBriefAiByIds(sb, briefIds),
    getTradedBriefIds(sb, userId, briefIds),
  ]);

  const candidates: GoTradeCandidate[] = [];

  for (const brief of eligibleBriefs) {
    if (tradedIds.has(brief.id)) continue;

    const consensusText = aiMeta.get(brief.id)?.consensusText;
    if (!consensusText?.trim()) continue;

    const parsed = parseSynthesisResponse(consensusText);
    if (parsed.verdict !== 'GO') continue;

    const direction = normalizeDirection(parsed.direction);
    if (direction !== 'UP' && direction !== 'DOWN') continue;

    candidates.push({
      briefId: brief.id,
      ticker: brief.ticker,
      earningsDate: brief.earnings_date,
      direction,
      compositeScore: brief.composite_score ?? 0,
      confidence: parsed.confidence,
    });
  }

  return candidates.sort((a, b) => b.compositeScore - a.compositeScore);
}

function normalizeDirection(direction: Direction | null): 'UP' | 'DOWN' | null {
  if (direction === 'UP' || direction === 'DOWN') return direction;
  return null;
}
