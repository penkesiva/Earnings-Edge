import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketDataBundle } from '@/lib/predictMarket/providers/types';
import type { PredictDirection, PredictTradeBias } from '@/lib/predictMarket/types';

export type ActiveThesis = {
  predictionId: string;
  predictionType: 'NIGHT' | 'PREMARKET';
  direction: PredictDirection;
  tradeBias: PredictTradeBias;
  confidence: number;
  expectedLow: number | null;
  expectedHigh: number | null;
  invalidationLevel: number | null;
};

export async function loadActiveThesis(
  sb: SupabaseClient,
  sessionId: string,
): Promise<ActiveThesis | null> {
  const { data: preds } = await sb
    .from('pm_predictions')
    .select('id, prediction_type, direction, trade_bias, confidence, expected_low, expected_high, structured')
    .eq('session_id', sessionId)
    .order('prediction_type', { ascending: false });

  const row = preds?.find(p => p.prediction_type === 'PREMARKET') ?? preds?.[0];
  if (!row) return null;

  const structured = row.structured as { key_levels?: Record<string, number | null> } | null;
  const inv =
    structured?.key_levels?.invalidation ??
    structured?.key_levels?.previous_close_spx ??
    null;

  return {
    predictionId: row.id as string,
    predictionType: row.prediction_type as 'NIGHT' | 'PREMARKET',
    direction: row.direction as PredictDirection,
    tradeBias: row.trade_bias as PredictTradeBias,
    confidence: Number(row.confidence),
    expectedLow: row.expected_low != null ? Number(row.expected_low) : null,
    expectedHigh: row.expected_high != null ? Number(row.expected_high) : null,
    invalidationLevel: inv != null ? Number(inv) : null,
  };
}

export function marketSpxLevel(bundle: MarketDataBundle): number | null {
  const est = bundle.technical?.spx_index_estimate;
  if (est != null && est > 0) return est;
  const spy = bundle.spx?.price ?? bundle.spx?.previousClose;
  return spy != null && spy > 0 ? spy * 10 : null;
}

export function marketPreviousCloseSpx(bundle: MarketDataBundle): number | null {
  const v = bundle.technical?.previous_close_spx;
  if (v != null && v > 0) return v;
  const spy = bundle.spx?.previousClose;
  return spy != null && spy > 0 ? spy * 10 : null;
}
