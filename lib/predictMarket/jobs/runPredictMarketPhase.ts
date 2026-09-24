import type { SupabaseClient } from '@supabase/supabase-js';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';
import type { PredictMarketPhase } from '@/lib/predictMarket/types';
import {
  nightForecastSessionDate,
  pacificIsoTimestamp,
} from '@/lib/predictMarket/sessionCalendar';
import { defaultMarketDataProvider } from '@/lib/predictMarket/providers/alpacaMarketDataProvider';

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

/** Phase 1 runner — wires cron phases to persistence (LLM steps stubbed next). */
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
      const bundle = await defaultMarketDataProvider.collect(
        { sessionDate, asOfPt, asOfInstant: now },
        null,
      );
      const snapshotKind = phase === 'night' ? 'NIGHT_INPUT' : 'PREMARKET_INPUT';
      await sb.from('pm_market_snapshots').insert({
        session_id: sessionId,
        snapshot_kind: snapshotKind,
        as_of_pt: now.toISOString(),
        payload: bundle,
      });

      return {
        phase,
        sessionDate,
        ok: true,
        message: `${phase}: snapshot stored (LLM forecast wiring pending). Missing: ${bundle.missing.slice(0, 4).join(', ')}…`,
      };
    }

    if (phase === 'open') {
      const bundle = await defaultMarketDataProvider.collect(
        { sessionDate, asOfPt, asOfInstant: now },
        null,
      );
      await sb.from('pm_market_snapshots').insert({
        session_id: sessionId,
        snapshot_kind: 'OPEN',
        as_of_pt: now.toISOString(),
        payload: bundle,
      });
      return { phase, sessionDate, ok: true, message: 'Open snapshot stored.' };
    }

    if (phase === 'entry') {
      await sb.from('pm_trade_signals').insert({
        session_id: sessionId,
        recommended_side: 'WAIT',
        decision_time_pt: now.toISOString(),
        confidence: null,
        reasoning: 'Phase 1 placeholder — confirmation logic not wired yet.',
        structured: { phase: 'entry', stub: true },
      });
      return { phase, sessionDate, ok: true, message: 'Entry evaluation placeholder stored.' };
    }

    if (phase === 'validate_7am' || phase === 'validate_10am') {
      const kind = phase === 'validate_7am' ? 'FIRST_7AM' : 'MIDDAY_10AM';
      await sb.from('pm_validation_checkpoints').upsert(
        {
          session_id: sessionId,
          checkpoint_kind: kind,
          as_of_pt: now.toISOString(),
          thesis_status: 'PENDING',
          metrics: { stub: true },
          reasoning: 'Phase 1 placeholder checkpoint.',
        },
        { onConflict: 'session_id,checkpoint_kind' },
      );
      return { phase, sessionDate, ok: true, message: `${kind} checkpoint stored.` };
    }

    if (phase === 'grade') {
      return {
        phase,
        sessionDate,
        ok: true,
        message: 'Final grading job registered — outcome + score writers pending.',
      };
    }

    return { phase, sessionDate, ok: false, message: 'Unknown phase.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { phase, sessionDate, ok: false, message: msg };
  }
}
