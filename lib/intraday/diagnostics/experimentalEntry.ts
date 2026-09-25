import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import { classifyMomentumPhase } from '@/lib/intraday/diagnostics/momentumPhase';
import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { MinuteBar } from '@/lib/intraday/types';

/** Forensics-only: VWAP proximity + momentum resumption (not production default). */
export function detectExperimentalVwapResumptionEntry(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  pullbackReady: boolean,
): { type: 'ema_pullback_confirmed' } | null {
  if (ctx.ema9 <= ctx.ema20 || ctx.ema9Slope <= 0 || ctx.ema20Slope < 0) return null;

  const distVwap = ((b.c - ctx.vwap) / ctx.vwap) * 100;
  const distEma9 = ((b.c - ctx.ema9) / ctx.ema9) * 100;
  if (distVwap > 0.15 || distEma9 > 0.25) return null;

  let consolidation = false;
  if (i >= 5) {
    const slice = bars.slice(i - 5, i + 1);
    const hi = Math.max(...slice.map(x => x.h));
    const lo = Math.min(...slice.map(x => x.l));
    consolidation = hi > 0 && ((hi - lo) / hi) * 100 < 0.15;
  }
  if (!pullbackReady && !consolidation) return null;

  const phase = classifyMomentumPhase(bars, i, b, ctx, ctxPrev).phase;
  if (phase === 'EXTENDED' || phase === 'FADING') return null;

  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  if (ret3 <= 0 || b.c <= b.o) return null;

  const range = Math.max(b.h - b.l, 1e-9);
  const closeLoc = (b.c - b.l) / range;
  if (closeLoc < 0.55) return null;
  if (ctx.emaSpreadPct < ctxPrev.emaSpreadPct) return null;

  const bb = bollingerAtBar(bars, i);
  if (bb && bb.percentB > 1 && ret1 > 0.003) return null;

  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volAccel = volPrev5 > 0 ? b.v / volPrev5 : 1;
  if (volAccel > 1.8 && ret1 > 0.002) return null;

  if (b.c < ctx.vwap * 0.9995) return null;

  return { type: 'ema_pullback_confirmed' };
}
