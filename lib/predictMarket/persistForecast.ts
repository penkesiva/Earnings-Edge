import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeneratedForecast } from '@/lib/predictMarket/llm/openAiPredictMarketForecast';
import type { PredictionType } from '@/lib/predictMarket/types';

export async function predictionExists(
  sb: SupabaseClient,
  sessionId: string,
  type: PredictionType,
): Promise<boolean> {
  const { data } = await sb
    .from('pm_predictions')
    .select('id')
    .eq('session_id', sessionId)
    .eq('prediction_type', type)
    .maybeSingle();
  return !!data;
}

export async function persistForecast(
  sb: SupabaseClient,
  sessionId: string,
  forecast: GeneratedForecast,
  inputSnapshotId: string | null,
  asOfIso: string,
): Promise<string> {
  const s = forecast.structured;
  const { data, error } = await sb
    .from('pm_predictions')
    .insert({
      session_id: sessionId,
      prediction_type: s.prediction_type,
      as_of_pt: asOfIso,
      direction: s.direction,
      confidence: s.confidence,
      trade_bias: s.trade_bias,
      expected_open_direction: s.expected_open_direction,
      expected_gap_percent: s.expected_gap_percent,
      expected_low: s.expected_low,
      expected_high: s.expected_high,
      expected_close: s.expected_close,
      expected_day_return_percent: s.expected_day_return_percent,
      bullish_score: s.bullish_score,
      bearish_score: s.bearish_score,
      structured: { ...s, llm_excerpt: forecast.rawResponseExcerpt },
      reasoning: forecast.reasoning,
      input_snapshot_id: inputSnapshotId,
    })
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  if (forecast.news.length) {
    await sb.from('pm_news_events').insert(
      forecast.news.map(n => ({
        session_id: sessionId,
        headline: n.headline,
        classification: n.classification,
        impact: n.impact,
        mechanism: n.mechanism,
        source: n.source,
      })),
    );
  }

  return data.id as string;
}

export async function writeNightPremarketComparison(sb: SupabaseClient, sessionId: string) {
  const { data: preds } = await sb
    .from('pm_predictions')
    .select('id, prediction_type, direction, confidence')
    .eq('session_id', sessionId);

  const night = preds?.find(p => p.prediction_type === 'NIGHT');
  const pre = preds?.find(p => p.prediction_type === 'PREMARKET');
  if (!night || !pre) return;

  const changed = night.direction !== pre.direction;
  const confDelta = Number(pre.confidence) - Number(night.confidence);

  await sb.from('pm_prediction_comparisons').upsert(
    {
      session_id: sessionId,
      night_prediction_id: night.id,
      premarket_prediction_id: pre.id,
      changed,
      night_direction: night.direction,
      night_confidence: night.confidence,
      premarket_direction: pre.direction,
      premarket_confidence: pre.confidence,
      change_summary: {
        direction_changed: changed,
        confidence_delta: confDelta,
        confidence_increased: confDelta > 0,
      },
    },
    { onConflict: 'session_id' },
  );
}
