import type { SupabaseClient } from '@supabase/supabase-js';

export type PerformanceSummary = {
  directionAccuracy: number | null;
  nightDirectionAccuracy: number | null;
  premarketDirectionAccuracy: number | null;
  rangeCoveragePct: number | null;
  sampleSize: number;
};

/** Deterministic analytics — never LLM-computed. Phase 1: empty until outcomes exist. */
export async function loadPredictMarketPerformance(
  sb: SupabaseClient,
  limitSessions = 100,
): Promise<PerformanceSummary> {
  const { count } = await sb
    .from('pm_prediction_scores')
    .select('*', { count: 'exact', head: true });

  if (!count) {
    return {
      directionAccuracy: null,
      nightDirectionAccuracy: null,
      premarketDirectionAccuracy: null,
      rangeCoveragePct: null,
      sampleSize: 0,
    };
  }

  const { data: scores } = await sb
    .from('pm_prediction_scores')
    .select('direction_correct, range_coverage, metrics, prediction_id')
    .order('created_at', { ascending: false })
    .limit(limitSessions);

  const rows = scores ?? [];
  const dirHits = rows.filter(r => r.direction_correct === true).length;
  const dirTotal = rows.filter(r => r.direction_correct != null).length;
  const coverageHits = rows.filter(r => r.range_coverage === true).length;
  const coverageTotal = rows.filter(r => r.range_coverage != null).length;

  return {
    directionAccuracy: dirTotal ? (dirHits / dirTotal) * 100 : null,
    nightDirectionAccuracy: null,
    premarketDirectionAccuracy: null,
    rangeCoveragePct: coverageTotal ? (coverageHits / coverageTotal) * 100 : null,
    sampleSize: rows.length,
  };
}
