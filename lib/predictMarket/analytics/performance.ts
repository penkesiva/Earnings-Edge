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
    .select('direction_correct, range_coverage, prediction_id')
    .order('created_at', { ascending: false })
    .limit(limitSessions);

  const { data: preds } = await sb
    .from('pm_predictions')
    .select('id, prediction_type, direction')
    .limit(500);

  const predType = new Map((preds ?? []).map(p => [p.id as string, p.prediction_type as string]));

  const rows = scores ?? [];
  let nightHit = 0;
  let nightTotal = 0;
  let preHit = 0;
  let preTotal = 0;

  for (const row of rows) {
    const type = predType.get(row.prediction_id as string);
    if (row.direction_correct == null || !type) continue;
    if (type === 'NIGHT') {
      nightTotal += 1;
      if (row.direction_correct) nightHit += 1;
    } else if (type === 'PREMARKET') {
      preTotal += 1;
      if (row.direction_correct) preHit += 1;
    }
  }

  const dirHits = rows.filter(r => r.direction_correct === true).length;
  const dirTotal = rows.filter(r => r.direction_correct != null).length;
  const coverageHits = rows.filter(r => r.range_coverage === true).length;
  const coverageTotal = rows.filter(r => r.range_coverage != null).length;

  return {
    directionAccuracy: dirTotal ? (dirHits / dirTotal) * 100 : null,
    nightDirectionAccuracy: nightTotal ? (nightHit / nightTotal) * 100 : null,
    premarketDirectionAccuracy: preTotal ? (preHit / preTotal) * 100 : null,
    rangeCoveragePct: coverageTotal ? (coverageHits / coverageTotal) * 100 : null,
    sampleSize: rows.length,
  };
}
