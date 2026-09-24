import {
  parseSynthesisResponse,
  type Direction,
  type ParsedTradePlan,
  type VerdictCall,
} from '@/lib/aiConsensus';
import {
  canAutoTradeOptions,
  formatLegSummary,
  resolveTradeLegsForAutoTrade,
} from '@/lib/consensusOptionExecution';
import { loadDashboardBriefAiByIds } from '@/lib/loadDashboardBriefAi';
import { getPreMarketFocusDates } from '@/lib/topEarningsPicks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTradedBriefIds } from '@/lib/automationSettings';

export type GoTradeCandidate = {
  briefId: string;
  ticker: string;
  earningsDate: string;
  timing: 'BMO' | 'AMC' | 'UNK';
  direction: 'UP' | 'DOWN';
  verdict: VerdictCall;
  compositeScore: number;
  confidence: string | null;
  /** equity = GO without option legs; options = consensus / system legs */
  executionMode: 'equity' | 'options';
  tradePlan: ParsedTradePlan | null;
  legSummary: string | null;
  suggestedStructure: {
    legs?: Array<{ side: 'BUY' | 'SELL'; type: 'CALL' | 'PUT'; strike: number; expiry?: string }>;
    preferredExpiry?: string;
    action?: string;
  } | null;
};

type BriefRow = {
  id: string;
  ticker: string;
  earnings_date: string;
  composite_score: number;
  suggested_structure: GoTradeCandidate['suggestedStructure'];
};

/**
 * Active watchlist briefs with consensus GO or WATCH + direction, filtered to the
 * pre-close entry window:
 *   - reporting today AMC (or unknown timing) → enter before today's close
 *   - reporting next trading day BMO → enter today for the morning print
 * Today-BMO names already reported pre-market and are excluded.
 *
 * GO without option legs → equity proxy. GO/WATCH with legs → options auto-trade.
 */
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
    .select('id, ticker, earnings_date, composite_score, suggested_structure')
    .eq('user_id', userId)
    .in('earnings_date', focusDates)
    .order('composite_score', { ascending: false });

  if (briefErr) throw new Error(briefErr.message);

  const preFiltered = (briefs ?? []).filter(
    b => activeTickers.has(b.ticker),
  ) as BriefRow[];
  if (preFiltered.length === 0) return [];

  const { data: events } = await sb
    .from('earnings_events')
    .select('ticker, earnings_date, timing')
    .eq('user_id', userId)
    .in('earnings_date', focusDates)
    .in('ticker', [...activeTickers]);

  const timingByKey = new Map(
    (events ?? []).map(e => [`${e.ticker}:${e.earnings_date}`, (e.timing ?? 'UNK') as 'BMO' | 'AMC' | 'UNK']),
  );

  const today = focusDates[0];
  const eligibleBriefs = preFiltered.filter(b => {
    const timing = timingByKey.get(`${b.ticker}:${b.earnings_date}`) ?? 'UNK';
    if (b.earnings_date === today && timing === 'BMO') return false;
    if (b.earnings_date !== today && timing === 'AMC') return false;
    return true;
  });
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
    if (parsed.verdict !== 'GO' && parsed.verdict !== 'WATCH') continue;

    const direction = normalizeDirection(parsed.direction);
    if (direction !== 'UP' && direction !== 'DOWN') continue;

    const structure = brief.suggested_structure ?? null;
    const tradeLegs = resolveTradeLegsForAutoTrade(
      parsed.verdict,
      direction,
      parsed.tradePlan,
      structure,
    );

    if (parsed.verdict === 'WATCH' && !canAutoTradeOptions(parsed.verdict, tradeLegs)) {
      continue;
    }

    const useOptions = tradeLegs.length > 0;
    if (parsed.verdict === 'GO' && !useOptions) {
      candidates.push(
        buildCandidate(brief, timingByKey, parsed, direction, 'equity', null, tradeLegs, structure),
      );
      continue;
    }

    if (useOptions) {
      candidates.push(
        buildCandidate(
          brief,
          timingByKey,
          parsed,
          direction,
          'options',
          parsed.tradePlan,
          tradeLegs,
          structure,
        ),
      );
    }
  }

  return candidates.sort((a, b) => b.compositeScore - a.compositeScore);
}

function buildCandidate(
  brief: BriefRow,
  timingByKey: Map<string, 'BMO' | 'AMC' | 'UNK'>,
  parsed: ReturnType<typeof parseSynthesisResponse>,
  direction: 'UP' | 'DOWN',
  executionMode: 'equity' | 'options',
  tradePlan: ParsedTradePlan | null,
  tradeLegs: ReturnType<typeof resolveTradeLegsForAutoTrade>,
  suggestedStructure: BriefRow['suggested_structure'],
): GoTradeCandidate {
  return {
    briefId: brief.id,
    ticker: brief.ticker,
    earningsDate: brief.earnings_date,
    timing: timingByKey.get(`${brief.ticker}:${brief.earnings_date}`) ?? 'UNK',
    direction,
    verdict: parsed.verdict,
    compositeScore: brief.composite_score ?? 0,
    confidence: parsed.confidence,
    executionMode,
    tradePlan,
    legSummary: tradeLegs.length ? formatLegSummary(tradeLegs) : null,
    suggestedStructure,
  };
}

function normalizeDirection(direction: Direction | null): 'UP' | 'DOWN' | null {
  if (direction === 'UP' || direction === 'DOWN') return direction;
  return null;
}
