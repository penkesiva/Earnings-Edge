import type { SupabaseClient } from '@supabase/supabase-js';
import { nextTradingSessionDate } from '@/lib/predictMarket/sessionCalendar';
import { loadPredictMarketPerformance } from '@/lib/predictMarket/analytics/performance';

export type PredictMarketPageData = {
  migrationRequired: boolean;
  nextSessionDate: string;
  latestSession: {
    sessionDate: string;
    night: Record<string, unknown> | null;
    premarket: Record<string, unknown> | null;
    spxAnchor: number | null;
  } | null;
  performance: Awaited<ReturnType<typeof loadPredictMarketPerformance>>;
};

export async function loadPredictMarketPageData(
  sb: SupabaseClient,
): Promise<PredictMarketPageData> {
  const nextSessionDate = nextTradingSessionDate();

  const probe = await sb.from('pm_market_sessions').select('id', { head: true, count: 'exact' });
  if (probe.error && /relation|does not exist/i.test(probe.error.message)) {
    return {
      migrationRequired: true,
      nextSessionDate,
      latestSession: null,
      performance: {
        directionAccuracy: null,
        nightDirectionAccuracy: null,
        premarketDirectionAccuracy: null,
        rangeCoveragePct: null,
        sampleSize: 0,
      },
    };
  }

  const { data: session } = await sb
    .from('pm_market_sessions')
    .select('id, session_date')
    .order('session_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let night: Record<string, unknown> | null = null;
  let premarket: Record<string, unknown> | null = null;
  let spxAnchor: number | null = null;

  if (session) {
    const { data: preds } = await sb
      .from('pm_predictions')
      .select('*')
      .eq('session_id', session.id);
    for (const p of preds ?? []) {
      if (p.prediction_type === 'NIGHT') night = p as Record<string, unknown>;
      if (p.prediction_type === 'PREMARKET') premarket = p as Record<string, unknown>;
    }

    const { data: snap } = await sb
      .from('pm_market_snapshots')
      .select('payload')
      .eq('session_id', session.id)
      .order('as_of_pt', { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = snap?.payload as { technical?: { spx_index_estimate?: number } } | null;
    spxAnchor = payload?.technical?.spx_index_estimate ?? null;
  }

  const performance = await loadPredictMarketPerformance(sb);

  return {
    migrationRequired: false,
    nextSessionDate,
    latestSession: session
      ? {
          sessionDate: session.session_date as string,
          night,
          premarket,
          spxAnchor,
        }
      : null,
    performance,
  };
}
