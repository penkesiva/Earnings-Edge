import type { SupabaseClient } from '@supabase/supabase-js';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';
import type { PredictMarketPhase } from '@/lib/predictMarket/types';
import {
  nightForecastSessionDate,
  pacificIsoTimestamp,
} from '@/lib/predictMarket/sessionCalendar';
import { defaultMarketDataProvider } from '@/lib/predictMarket/providers/alpacaMarketDataProvider';
import { buildHistoricalStatsContext } from '@/lib/predictMarket/analytics/historicalContext';
import { generatePredictMarketForecast } from '@/lib/predictMarket/llm/openAiPredictMarketForecast';
import { gradePredictMarketSession } from '@/lib/predictMarket/gradeSession';
import { enrichForecastRange } from '@/lib/predictMarket/enrichForecastRange';
import { evaluateCheckpoint } from '@/lib/predictMarket/intraday/evaluateCheckpoint';
import { evaluateEntryWindow } from '@/lib/predictMarket/intraday/evaluateEntry';
import { evaluateOpenThesis } from '@/lib/predictMarket/intraday/evaluateOpenThesis';
import { loadActiveThesis } from '@/lib/predictMarket/intraday/sessionContext';
import {
  persistForecast,
  predictionExists,
  writeNightPremarketComparison,
} from '@/lib/predictMarket/persistForecast';

export type PredictMarketJobResult = {
  phase: PredictMarketPhase;
  sessionDate: string;
  ok: boolean;
  message: string;
};

function sessionDateForPhase(phase: PredictMarketPhase, now: Date): string {
  if (phase === 'night') return nightForecastSessionDate(now);
  let d = earningsSessionDate(now);
  if (!isTradingDay(d)) {
    while (!isTradingDay(d)) d = addCalendarDays(d, 1);
  }
  return d;
}

async function ensureSession(sb: SupabaseClient, sessionDate: string) {
  const { data, error } = await sb
    .from('pm_market_sessions')
    .upsert({ session_date: sessionDate }, { onConflict: 'session_date' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function runForecastPhase(
  sb: SupabaseClient,
  sessionId: string,
  sessionDate: string,
  phase: 'night' | 'premarket',
  now: Date,
): Promise<PredictMarketJobResult> {
  const predictionType = phase === 'night' ? 'NIGHT' : 'PREMARKET';
  if (await predictionExists(sb, sessionId, predictionType)) {
    return {
      phase,
      sessionDate,
      ok: true,
      message: `${predictionType} prediction already stored (immutable).`,
    };
  }

  const asOfPt = pacificIsoTimestamp(now);
  const bundle = await defaultMarketDataProvider.collect(
    { sessionDate, asOfPt, asOfInstant: now },
    null,
  );
  const snapshotKind = phase === 'night' ? 'NIGHT_INPUT' : 'PREMARKET_INPUT';
  const { data: snapRow, error: snapErr } = await sb
    .from('pm_market_snapshots')
    .insert({
      session_id: sessionId,
      snapshot_kind: snapshotKind,
      as_of_pt: now.toISOString(),
      payload: bundle,
    })
    .select('id')
    .single();
  if (snapErr) throw new Error(snapErr.message);

  const historicalStats = await buildHistoricalStatsContext(sb);
  let forecast = await generatePredictMarketForecast({
    predictionType,
    sessionDate,
    asOfPt,
    market: bundle,
    historicalStats,
  });
  forecast = enrichForecastRange(forecast, bundle);

  await persistForecast(sb, sessionId, forecast, snapRow.id as string, now.toISOString());

  if (phase === 'premarket') {
    await writeNightPremarketComparison(sb, sessionId);
  }

  return {
    phase,
    sessionDate,
    ok: true,
    message: `${predictionType} ${forecast.structured.direction} @ ${forecast.structured.confidence}% (${forecast.structured.trade_bias}).`,
  };
}

/** Cron phase runner — snapshots, OpenAI+web_search forecasts, checkpoints, grading. */
export async function runPredictMarketPhase(
  sb: SupabaseClient,
  phase: PredictMarketPhase,
  now = new Date(),
): Promise<PredictMarketJobResult> {
  const sessionDate = sessionDateForPhase(phase, now);
  const asOfPt = pacificIsoTimestamp(now);

  try {
    const sessionId = await ensureSession(sb, sessionDate);

    if (phase === 'night' || phase === 'premarket') {
      return runForecastPhase(sb, sessionId, sessionDate, phase, now);
    }

    if (phase === 'open') {
      const bundle = await defaultMarketDataProvider.collect(
        { sessionDate, asOfPt, asOfInstant: now },
        null,
      );
      const thesis = await loadActiveThesis(sb, sessionId);
      const openCheck = evaluateOpenThesis(thesis, bundle);
      await sb.from('pm_market_snapshots').insert({
        session_id: sessionId,
        snapshot_kind: 'OPEN',
        as_of_pt: now.toISOString(),
        payload: { ...bundle, open_thesis: openCheck },
      });
      return {
        phase,
        sessionDate,
        ok: true,
        message: openCheck.summary,
      };
    }

    if (phase === 'entry') {
      const bundle = await defaultMarketDataProvider.collect(
        { sessionDate, asOfPt, asOfInstant: now },
        null,
      );
      const thesis = await loadActiveThesis(sb, sessionId);
      const { data: openSnap } = await sb
        .from('pm_market_snapshots')
        .select('payload')
        .eq('session_id', sessionId)
        .eq('snapshot_kind', 'OPEN')
        .order('as_of_pt', { ascending: false })
        .limit(1)
        .maybeSingle();
      const openPayload = openSnap?.payload as { open_thesis?: { confirming?: boolean | null } } | null;
      const entry = evaluateEntryWindow(
        thesis,
        bundle,
        openPayload?.open_thesis?.confirming ?? null,
      );

      await sb.from('pm_trade_signals').upsert(
        {
          session_id: sessionId,
          recommended_side: entry.recommendedSide,
          decision_time_pt: now.toISOString(),
          spx_price: entry.spxPrice,
          confidence: entry.confidence,
          confirmation_signals: entry.confirmationSignals,
          invalidation_level: entry.invalidationLevel,
          reasoning: entry.reasoning,
          structured: { phase: 'entry', signals: entry.confirmationSignals },
        },
        { onConflict: 'session_id' },
      );

      return {
        phase,
        sessionDate,
        ok: true,
        message: `Entry: ${entry.recommendedSide} — ${entry.reasoning.slice(0, 80)}`,
      };
    }

    if (phase === 'validate_7am' || phase === 'validate_10am') {
      const kind = phase === 'validate_7am' ? 'FIRST_7AM' : 'MIDDAY_10AM';
      const bundle = await defaultMarketDataProvider.collect(
        { sessionDate, asOfPt, asOfInstant: now },
        null,
      );
      const thesis = await loadActiveThesis(sb, sessionId);
      const result = evaluateCheckpoint(thesis, bundle, kind);
      await sb.from('pm_validation_checkpoints').upsert(
        {
          session_id: sessionId,
          checkpoint_kind: kind,
          as_of_pt: now.toISOString(),
          thesis_status: result.thesisStatus,
          metrics: result.metrics,
          reasoning: result.reasoning,
        },
        { onConflict: 'session_id,checkpoint_kind' },
      );
      return {
        phase,
        sessionDate,
        ok: true,
        message: `${kind}: ${result.thesisStatus} — ${result.reasoning.slice(0, 80)}`,
      };
    }

    if (phase === 'grade') {
      const msg = await gradePredictMarketSession(sb, sessionId, sessionDate, now.toISOString());
      return { phase, sessionDate, ok: true, message: msg };
    }

    return { phase, sessionDate, ok: false, message: 'Unknown phase.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { phase, sessionDate, ok: false, message: msg };
  }
}
