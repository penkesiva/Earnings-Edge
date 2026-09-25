import type { SupabaseClient } from '@supabase/supabase-js';
import { earningsSessionDate } from '@/lib/earningsDate';
import { loadPredictMarketPerformance } from '@/lib/predictMarket/analytics/performance';
import { nextTradingSessionDate, pacificParts } from '@/lib/predictMarket/sessionCalendar';

export type SessionForecastBundle = {
  sessionDate: string;
  night: Record<string, unknown> | null;
  premarket: Record<string, unknown> | null;
  spxAnchor: number | null;
  hasOutcome: boolean;
};

export type PredictMarketPageData = {
  migrationRequired: boolean;
  /** Next NYSE session date from “now” (after ~1:30 PM PT, rolls to following trading day). */
  nextSessionDate: string;
  /** Session whose forecasts / grade we highlight on the home card. */
  featured: SessionForecastBundle | null;
  /** True when featured session date equals nextSessionDate and has at least one forecast. */
  featuredIsUpcoming: boolean;
  performance: Awaited<ReturnType<typeof loadPredictMarketPerformance>>;
};

async function loadSessionBundle(
  sb: SupabaseClient,
  sessionDate: string,
): Promise<SessionForecastBundle | null> {
  const { data: session } = await sb
    .from('pm_market_sessions')
    .select('id, session_date')
    .eq('session_date', sessionDate)
    .maybeSingle();

  if (!session) return null;

  const [{ data: preds }, { data: snap }, { data: outcome }] = await Promise.all([
    sb.from('pm_predictions').select('*').eq('session_id', session.id),
    sb
      .from('pm_market_snapshots')
      .select('payload')
      .eq('session_id', session.id)
      .order('as_of_pt', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from('pm_market_outcomes')
      .select('id')
      .eq('session_id', session.id)
      .maybeSingle(),
  ]);

  let night: Record<string, unknown> | null = null;
  let premarket: Record<string, unknown> | null = null;
  for (const p of preds ?? []) {
    if (p.prediction_type === 'NIGHT') night = p as Record<string, unknown>;
    if (p.prediction_type === 'PREMARKET') premarket = p as Record<string, unknown>;
  }

  const payload = snap?.payload as { technical?: { spx_index_estimate?: number } } | null;
  const spxAnchor = payload?.technical?.spx_index_estimate ?? null;

  return {
    sessionDate: session.session_date as string,
    night,
    premarket,
    spxAnchor,
    hasOutcome: Boolean(outcome),
  };
}

export async function loadPredictMarketPageData(
  sb: SupabaseClient,
): Promise<PredictMarketPageData> {
  const nextSessionDate = nextTradingSessionDate();

  const probe = await sb.from('pm_market_sessions').select('id', { head: true, count: 'exact' });
  if (probe.error && /relation|does not exist/i.test(probe.error.message)) {
    return {
      migrationRequired: true,
      nextSessionDate,
      featured: null,
      featuredIsUpcoming: false,
      performance: {
        directionAccuracy: null,
        nightDirectionAccuracy: null,
        premarketDirectionAccuracy: null,
        rangeCoveragePct: null,
        sampleSize: 0,
      },
    };
  }

  const nextBundle = await loadSessionBundle(sb, nextSessionDate);
  const nextHasForecast = Boolean(nextBundle?.night || nextBundle?.premarket);

  let featured: SessionForecastBundle | null = nextHasForecast ? nextBundle : null;
  let featuredIsUpcoming = nextHasForecast;

  if (!featured) {
    const { data: latestRow } = await sb
      .from('pm_market_sessions')
      .select('session_date')
      .order('session_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRow?.session_date) {
      featured = await loadSessionBundle(sb, latestRow.session_date as string);
      featuredIsUpcoming = featured?.sessionDate === nextSessionDate;
    }
  }

  const performance = await loadPredictMarketPerformance(sb);

  return {
    migrationRequired: false,
    nextSessionDate,
    featured,
    featuredIsUpcoming,
    performance,
  };
}

/** Human hint for what happens next on the home card. */
export function predictMarketScheduleHint(now = new Date()): string {
  const next = nextTradingSessionDate(now);
  const etToday = earningsSessionDate(now);
  const { hour: ptHour } = pacificParts(now);

  if (next !== etToday && ptHour < 21) {
    return `Next LLM forecast: night run ~9:00 PM PT tonight for trading session ${next}.`;
  }
  if (next !== etToday && ptHour >= 21) {
    return `Night forecast for ${next} runs ~9:00 PM PT (cron or manual force).`;
  }
  return `Intraday steps run ${next} morning PT: premarket → open → entry → 7 AM / 10 AM checks → afternoon grade.`;
}
