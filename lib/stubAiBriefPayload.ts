import type { AiBriefPayload } from '@/components/AiBriefAnalysis';

/** Minimal payload before a brief row exists (Scan All creates it via system scan). */
export function stubAiBriefPayload(
  ticker: string,
  earningsDate: string,
  briefId = '',
): AiBriefPayload {
  return {
    brief_id: briefId,
    ticker,
    earnings_date: earningsDate,
    composite_score: 0,
    beat_streak_score: null,
    surprise_magnitude_score: null,
    revision_trend_score: null,
    whisper_delta_score: null,
    iv_rank_score: null,
    sector_momentum_score: null,
    insider_score: null,
    iv_rank: null,
    iv_30d: null,
    expected_move_dollar: null,
    expected_move_pct: null,
    put_call_ratio: null,
    scream_direction: null,
    scream_score: null,
    scream_qualifies: null,
    scream_notes: null,
    final_action: null,
    final_action_rationale: null,
    overhangs: [],
    raw_headlines: null,
    news_sentiment: null,
    spot_price: null,
    suggested_structure: null,
  };
}
