import type { SupabaseClient } from '@supabase/supabase-js';

/** Programmatic historical stats for LLM context — never LLM-computed. */
export async function buildHistoricalStatsContext(sb: SupabaseClient): Promise<string> {
  const lines: string[] = [];

  const { data: outcomes } = await sb
    .from('pm_market_outcomes')
    .select('session_id, actual_direction')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!outcomes?.length) {
    return 'No graded sessions yet. Night vs premarket accuracy unavailable.';
  }

  const sessionIds = outcomes.map(o => o.session_id as string);
  const { data: preds } = await sb
    .from('pm_predictions')
    .select('session_id, prediction_type, direction')
    .in('session_id', sessionIds);

  const actualBySession = new Map(
    outcomes.map(o => [o.session_id as string, o.actual_direction as string]),
  );

  let nightTotal = 0;
  let nightHit = 0;
  let preTotal = 0;
  let preHit = 0;

  for (const p of preds ?? []) {
    const actual = actualBySession.get(p.session_id as string);
    if (!actual || actual !== 'GREEN' && actual !== 'RED') continue;
    const predicted = p.direction as string;
    if (predicted !== 'GREEN' && predicted !== 'RED') continue;
    const hit = predicted === actual;
    if (p.prediction_type === 'NIGHT') {
      nightTotal += 1;
      if (hit) nightHit += 1;
    } else if (p.prediction_type === 'PREMARKET') {
      preTotal += 1;
      if (hit) preHit += 1;
    }
  }

  if (nightTotal > 0) {
    lines.push(
      `Night direction accuracy (last ${nightTotal} graded): ${((nightHit / nightTotal) * 100).toFixed(1)}%`,
    );
  }
  if (preTotal > 0) {
    lines.push(
      `Premarket direction accuracy (last ${preTotal} graded): ${((preHit / preTotal) * 100).toFixed(1)}%`,
    );
  }

  const { data: buckets } = await sb
    .from('pm_prediction_scores')
    .select('confidence_bucket, direction_correct')
    .not('confidence_bucket', 'is', null)
    .limit(500);

  const bucketMap = new Map<string, { hit: number; total: number }>();
  for (const row of buckets ?? []) {
    const b = row.confidence_bucket as string;
    if (!b) continue;
    const cur = bucketMap.get(b) ?? { hit: 0, total: 0 };
    cur.total += 1;
    if (row.direction_correct === true) cur.hit += 1;
    bucketMap.set(b, cur);
  }

  for (const [bucket, stats] of bucketMap) {
    if (stats.total < 3) continue;
    lines.push(
      `Calibration bucket ${bucket}: ${((stats.hit / stats.total) * 100).toFixed(0)}% hit (${stats.total} samples)`,
    );
  }

  return lines.length ? lines.join('\n') : 'Graded outcomes exist but not enough directional predictions to summarize.';
}

export function confidenceBucket(confidence: number): string {
  if (confidence >= 90) return '90+';
  if (confidence >= 80) return '80-89';
  if (confidence >= 70) return '70-79';
  if (confidence >= 60) return '60-69';
  return '50-59';
}
