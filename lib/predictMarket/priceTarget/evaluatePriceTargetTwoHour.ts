import type { SupabaseClient } from '@supabase/supabase-js';
import { getHistoricalBars } from '@/lib/alpaca';
import {
  derivePremarketPriceTarget,
  evaluateTargetTouch,
} from '@/lib/predictMarket/priceTarget/derivePremarketTarget';
import { firstTwoHoursRthWindow } from '@/lib/predictMarket/priceTarget/pacificBarWindow';
import { pacificIsoTimestamp } from '@/lib/predictMarket/sessionCalendar';

const SPY = 'SPY';
const SPX_MULT = 10;

type SpyBar = { h?: number; l?: number; t?: string };

export type PriceTargetEvalResult = {
  ok: boolean;
  message: string;
  hit?: boolean;
  targetSpx?: number;
  side?: 'PUT' | 'CALL';
};

export async function evaluatePremarketPriceTargetTwoHour(
  sb: SupabaseClient,
  sessionId: string,
  sessionDate: string,
  now = new Date(),
): Promise<PriceTargetEvalResult> {
  const { data: existing } = await sb
    .from('pm_price_target_evaluations')
    .select('id')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (existing) {
    return { ok: true, message: 'Price target evaluation already stored (immutable).' };
  }

  const { data: pre } = await sb
    .from('pm_predictions')
    .select('id, direction, trade_bias, expected_low, expected_high, structured')
    .eq('session_id', sessionId)
    .eq('prediction_type', 'PREMARKET')
    .maybeSingle();

  if (!pre) {
    return { ok: true, message: 'No premarket forecast — skip price target.' };
  }

  const target = derivePremarketPriceTarget({
    direction: pre.direction as string,
    tradeBias: pre.trade_bias as string,
    expectedLow: pre.expected_low != null ? Number(pre.expected_low) : null,
    expectedHigh: pre.expected_high != null ? Number(pre.expected_high) : null,
    structured: pre.structured as Record<string, unknown>,
  });

  if (!target) {
    return { ok: true, message: 'No SPX price target derived from premarket — skip.' };
  }

  const { startIso, endIso } = firstTwoHoursRthWindow(sessionDate);
  let bars: SpyBar[];
  try {
    bars = (await getHistoricalBars(SPY, startIso, endIso, '1Min', null)) as SpyBar[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `SPY intraday bars failed: ${msg}` };
  }

  if (!bars.length) {
    return { ok: false, message: 'No 1Min bars in 6:30–8:30 AM PT window yet.' };
  }

  let spyHigh = -Infinity;
  let spyLow = Infinity;
  for (const b of bars) {
    if (b.h != null) spyHigh = Math.max(spyHigh, b.h);
    if (b.l != null) spyLow = Math.min(spyLow, b.l);
  }
  if (!Number.isFinite(spyHigh) || !Number.isFinite(spyLow)) {
    return { ok: false, message: 'Incomplete bar OHLC in window.' };
  }

  const windowHighSpx = spyHigh * SPX_MULT;
  const windowLowSpx = spyLow * SPX_MULT;
  const hit = evaluateTargetTouch(target.side, target.targetSpx, windowLowSpx, windowHighSpx);
  const evaluatedAt = pacificIsoTimestamp(now);
  const { startIso: wStart, endIso: wEnd } = { startIso, endIso };

  const { error: insErr } = await sb.from('pm_price_target_evaluations').insert({
    session_id: sessionId,
    prediction_id: pre.id,
    target_spx: target.targetSpx,
    target_side: target.side,
    window_start_pt: wStart,
    window_end_pt: wEnd,
    window_high_spx: windowHighSpx,
    window_low_spx: windowLowSpx,
    target_hit: hit,
    metrics: {
      spy_bars: bars.length,
      target_source: target.source,
      window_pt: '06:30-08:30',
    },
    evaluated_at_pt: now.toISOString(),
  });

  if (insErr) {
    return { ok: false, message: insErr.message };
  }

  await sb
    .from('pm_prediction_scores')
    .upsert(
      {
        session_id: sessionId,
        prediction_id: pre.id as string,
        price_target_hit: hit,
      },
      { onConflict: 'prediction_id' },
    );

  return {
    ok: true,
    message: `Target ${target.side} ${target.targetSpx.toFixed(0)} SPX — ${hit ? 'HIT' : 'MISS'} (window low ${windowLowSpx.toFixed(0)} / high ${windowHighSpx.toFixed(0)}).`,
    hit,
    targetSpx: target.targetSpx,
    side: target.side,
  };
}

/** Embed locked target on premarket structured JSON at forecast time. */
export function enrichStructuredWithPriceTarget(
  structured: Record<string, unknown>,
  direction: string,
  tradeBias: string,
  expectedLow: number | null,
  expectedHigh: number | null,
): Record<string, unknown> {
  const target = derivePremarketPriceTarget({
    direction,
    tradeBias,
    expectedLow,
    expectedHigh,
    structured,
  });
  if (!target) return structured;
  return {
    ...structured,
    price_target: {
      target_spx: target.targetSpx,
      side: target.side,
      source: target.source,
      window_pt: '06:30-08:30 RTH',
    },
  };
}
