import type { SupabaseClient } from '@supabase/supabase-js';
import { getHistoricalBars } from '@/lib/alpaca';
import { addCalendarDays } from '@/lib/earningsDate';
import { confidenceBucket } from '@/lib/predictMarket/analytics/historicalContext';
import {
  classifyActualDirection,
  scoreDirectionForecast,
} from '@/lib/predictMarket/outcomeGrading';
import { computeMorningThesisGrade } from '@/lib/predictMarket/morningThesisGrade';

const PROXY = 'SPY';

/** Grade session after close using SPY daily bar as SPX proxy (Phase 2). */
export async function gradePredictMarketSession(
  sb: SupabaseClient,
  sessionId: string,
  sessionDate: string,
  gradedAtIso: string,
): Promise<string> {
  const start = sessionDate;
  const end = addCalendarDays(sessionDate, 1);

  let bars: Array<{ o?: number; h?: number; l?: number; c?: number; t?: string }>;
  try {
    const raw = await getHistoricalBars(PROXY, start, end, '1Day', null);
    bars = (raw as Array<{ o?: number; h?: number; l?: number; c?: number; t?: string }>) ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not load ${PROXY} bars: ${msg}`);
  }

  const dayBar = bars.find(b => b.c != null) ?? bars[0];
  if (!dayBar?.c) {
    return 'No daily bar yet — market may still be open or data delayed.';
  }

  const prevEnd = sessionDate;
  const prevStart = addCalendarDays(sessionDate, -5);
  const prevBarsRaw = await getHistoricalBars(PROXY, prevStart, prevEnd, '1Day', null);
  const prevBars = (prevBarsRaw as Array<{ c?: number; o?: number; t?: string }>) ?? [];
  const prior = [...prevBars].reverse().find(b => b.c != null && b.c !== dayBar.o);
  const previousClose = prior?.c ?? dayBar.o ?? null;
  const open = dayBar.o ?? null;
  const high = dayBar.h ?? null;
  const low = dayBar.l ?? null;
  const close = dayBar.c ?? null;

  if (previousClose == null || close == null) {
    return 'Incomplete OHLC for grading.';
  }

  const dailyReturn = ((close - previousClose) / previousClose) * 100;
  const gapPercent = open != null ? ((open - previousClose) / previousClose) * 100 : null;
  const rangePercent =
    high != null && low != null && previousClose
      ? ((high - low) / previousClose) * 100
      : null;
  const actualDirection = classifyActualDirection(dailyReturn);

  const [{ data: entryRow }, { data: cp7Row }, { data: prePred }] = await Promise.all([
    sb
      .from('pm_trade_signals')
      .select('recommended_side')
      .eq('session_id', sessionId)
      .maybeSingle(),
    sb
      .from('pm_validation_checkpoints')
      .select('thesis_status')
      .eq('session_id', sessionId)
      .eq('checkpoint_kind', 'FIRST_7AM')
      .maybeSingle(),
    sb
      .from('pm_predictions')
      .select('direction, trade_bias, prediction_type')
      .eq('session_id', sessionId)
      .eq('prediction_type', 'PREMARKET')
      .maybeSingle(),
  ]);

  const morning = computeMorningThesisGrade({
    premarketDirection: (prePred?.direction as string) ?? null,
    tradeBias: (prePred?.trade_bias as string) ?? null,
    entrySide: (entryRow?.recommended_side as string) ?? null,
    checkpoint7Status: (cp7Row?.thesis_status as string) ?? null,
  });

  await sb.from('pm_market_outcomes').upsert(
    {
      session_id: sessionId,
      previous_close: previousClose,
      open,
      high,
      low,
      close,
      gap_percent: gapPercent,
      daily_return_percent: dailyReturn,
      intraday_range_percent: rangePercent,
      actual_direction: actualDirection,
      payload: {
        proxy: PROXY,
        note: 'SPY used as SPX proxy; actual_direction is full-session close (reference).',
        morning_thesis: morning,
        eod_reference: {
          actual_direction: actualDirection,
          daily_return_percent: dailyReturn,
        },
      },
      graded_at_pt: gradedAtIso,
    },
    { onConflict: 'session_id' },
  );

  const { data: preds } = await sb
    .from('pm_predictions')
    .select('*')
    .eq('session_id', sessionId);

  const { data: priceEval } = await sb
    .from('pm_price_target_evaluations')
    .select('target_hit, target_spx, target_side')
    .eq('session_id', sessionId)
    .maybeSingle();

  for (const p of preds ?? []) {
    const predicted = p.direction as string;
    const predictionType = p.prediction_type as string;
    const eodCorrect = scoreDirectionForecast(predicted, actualDirection);
    const directionCorrect =
      predictionType === 'PREMARKET' && morning.premarketHit != null
        ? morning.premarketHit
        : eodCorrect;

    const expLow = p.expected_low != null ? Number(p.expected_low) : null;
    const expHigh = p.expected_high != null ? Number(p.expected_high) : null;
    let rangeCoverage: boolean | null = null;
    let maeHigh: number | null = null;
    let maeLow: number | null = null;
    if (high != null && low != null && expLow != null && expHigh != null) {
      rangeCoverage = low >= expLow && high <= expHigh;
      maeHigh = Math.abs(high - expHigh);
      maeLow = Math.abs(low - expLow);
    }

    const conf = Number(p.confidence);

    const scoreRow: Record<string, unknown> = {
      session_id: sessionId,
      prediction_id: p.id,
      direction_correct: directionCorrect,
      open_direction_correct: null,
      range_mae_high: maeHigh,
      range_mae_low: maeLow,
      range_coverage: rangeCoverage,
      confidence_bucket: confidenceBucket(conf),
      metrics: {
        actual_direction: actualDirection,
        daily_return_percent: dailyReturn,
        morning_thesis_status: morning.status,
        eod_direction_correct: eodCorrect,
        price_target_spx: priceEval?.target_spx ?? null,
        price_target_hit: priceEval?.target_hit ?? null,
      },
    };
    if (p.prediction_type === 'PREMARKET' && priceEval) {
      scoreRow.price_target_hit = priceEval.target_hit;
    }

    await sb.from('pm_prediction_scores').upsert(scoreRow, { onConflict: 'prediction_id' });
  }

  return `Graded ${preds?.length ?? 0} prediction(s); morning ${morning.status}; EOD ${actualDirection} ${dailyReturn.toFixed(2)}% (${PROXY}).`;
}
