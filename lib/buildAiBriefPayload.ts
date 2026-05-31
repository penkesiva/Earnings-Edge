import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiBriefPayload } from '@/components/AiBriefAnalysis';
import type { NarrativeOverhang } from '@/lib/screamTest';
import type { NewsOverallSentiment, RawHeadline } from '@/lib/newsSentiment';

/** Map an earnings_briefs row (+ related fields) to the client AI payload. */
export function buildAiBriefPayloadFromRow(
  brief: Record<string, unknown>,
  extras?: {
    overhangs?: NarrativeOverhang[];
    rawHeadlines?: RawHeadline[] | null;
    newsOverall?: NewsOverallSentiment | null;
  },
): AiBriefPayload {
  const structure = brief.suggested_structure as AiBriefPayload['suggested_structure'];
  return {
    brief_id: String(brief.id),
    ticker: String(brief.ticker),
    earnings_date: String(brief.earnings_date),
    composite_score: Number(brief.composite_score ?? 0),
    beat_streak_score: (brief.beat_streak_score as number | null) ?? null,
    surprise_magnitude_score: (brief.surprise_magnitude_score as number | null) ?? null,
    revision_trend_score: (brief.revision_trend_score as number | null) ?? null,
    whisper_delta_score: (brief.whisper_delta_score as number | null) ?? null,
    iv_rank_score: (brief.iv_rank_score as number | null) ?? null,
    sector_momentum_score: (brief.sector_momentum_score as number | null) ?? null,
    insider_score: (brief.insider_score as number | null) ?? null,
    iv_rank: (brief.iv_rank as number | null) ?? null,
    iv_30d: (brief.iv_30d as number | null) ?? null,
    expected_move_dollar: (brief.expected_move_dollar as number | null) ?? null,
    expected_move_pct: (brief.expected_move_pct as number | null) ?? null,
    put_call_ratio: (brief.put_call_ratio as number | null) ?? null,
    scream_direction: (brief.scream_direction as string | null) ?? null,
    scream_score: (brief.scream_score as number | null) ?? null,
    scream_qualifies: (brief.scream_qualifies as boolean | string | null) ?? null,
    scream_notes: (brief.scream_notes as string | string[] | null) ?? null,
    final_action: (brief.final_action as string | null) ?? null,
    final_action_rationale: (brief.final_action_rationale as string | null) ?? null,
    overhangs: extras?.overhangs ?? [],
    raw_headlines: extras?.rawHeadlines ?? null,
    news_sentiment: extras?.newsOverall ?? null,
    spot_price: (brief.spot_price as number | null) ?? null,
    suggested_structure: structure ?? null,
  };
}

export async function loadAiBriefPayload(
  sb: SupabaseClient,
  briefId: string,
): Promise<AiBriefPayload | null> {
  const { data: brief } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('id', briefId)
    .maybeSingle();

  if (!brief) return null;

  const rawFmp = brief.raw_fmp as { screamUnresolvedOverhangs?: NarrativeOverhang[] } | null;
  const screamUnresolved = rawFmp?.screamUnresolvedOverhangs ?? null;

  return buildAiBriefPayloadFromRow(brief, {
    overhangs: screamUnresolved ?? [],
    rawHeadlines: (brief.raw_headlines as RawHeadline[] | null) ?? null,
    newsOverall: (brief.news_sentiment as NewsOverallSentiment | null) ?? null,
  });
}

export async function loadAiBriefPayloadByTickerDate(
  sb: SupabaseClient,
  ticker: string,
  earningsDate: string,
): Promise<AiBriefPayload | null> {
  const { data: brief } = await sb
    .from('earnings_briefs')
    .select('*')
    .eq('ticker', ticker.toUpperCase())
    .eq('earnings_date', earningsDate)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!brief) return null;

  const rawFmp = brief.raw_fmp as { screamUnresolvedOverhangs?: NarrativeOverhang[] } | null;
  const screamUnresolved = rawFmp?.screamUnresolvedOverhangs ?? null;

  return buildAiBriefPayloadFromRow(brief, {
    overhangs: screamUnresolved ?? [],
    rawHeadlines: (brief.raw_headlines as RawHeadline[] | null) ?? null,
    newsOverall: (brief.news_sentiment as NewsOverallSentiment | null) ?? null,
  });
}
