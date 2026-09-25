import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

/** v1-style entries for EMA_ONLY mode inside v2 backtests. */
export function detectEmaOnlyEntry(
  b: MinuteBar,
  prev: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: EmaTrendDayV2Config,
): { type: 'ema_cross_up' | 'ema_pullback' } | null {
  const bullCross = ctxPrev.ema9 <= ctxPrev.ema20 && ctx.ema9 > ctx.ema20 && b.c > ctx.ema9;
  if (bullCross) return { type: 'ema_cross_up' };

  if (!config.allowPullbackEntry) return null;
  /** Match v1 `pullbackTouchPct` default (0.05) — not v2 `pullbackZonePct`. */
  const touchPct = config.emaOnlyPullbackTouchPct;
  const uptrend = ctx.ema9 > ctx.ema20;
  const touchedFast =
    uptrend &&
    b.l <= ctx.ema9 * (1 + touchPct / 100) &&
    b.c > ctx.ema9 &&
    prev.c >= ctxPrev.ema9;
  if (touchedFast) return { type: 'ema_pullback' };

  return null;
}

export function detectRegimeEntry(
  b: MinuteBar,
  prev: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: EmaTrendDayV2Config,
): { type: 'ema_cross_up_confirmed' | 'ema_pullback_confirmed' } | null {
  const bullCross =
    ctxPrev.ema9 <= ctxPrev.ema20 &&
    ctx.ema9 > ctx.ema20 &&
    b.c > ctx.ema9 &&
    b.c > ctx.vwap &&
    ctx.ema9Slope > 0;
  if (bullCross) return { type: 'ema_cross_up_confirmed' };

  if (!config.allowPullbackEntry) return null;
  const zone = config.pullbackZonePct / 100;
  const inZone = Math.abs(b.l - ctx.ema9) / ctx.ema9 <= zone;
  const uptrend = ctx.ema9 > ctx.ema20 && ctx.ema9Slope > 0 && ctx.ema20Slope >= 0;
  const vwapOk = b.c > ctx.vwap || (prev.c <= ctxPrev.vwap && b.c > ctx.vwap);
  const rejection = b.c > ctx.ema9 && b.c > b.o && inZone;
  if (uptrend && vwapOk && rejection) return { type: 'ema_pullback_confirmed' };

  return null;
}

export function detectMomentumCrossEntry(
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
): { type: 'ema_cross_up_confirmed' } | null {
  const bullCross =
    ctxPrev.ema9 <= ctxPrev.ema20 &&
    ctx.ema9 > ctx.ema20 &&
    b.c > ctx.ema9 &&
    b.c > ctx.vwap &&
    ctx.ema9Slope > 0;
  if (bullCross) return { type: 'ema_cross_up_confirmed' };
  return null;
}

export function detectMomentumPullbackEntry(
  b: MinuteBar,
  ctx: BarContext,
): { type: 'ema_pullback_confirmed' } | null {
  if (b.c > ctx.ema9 && b.c > b.o) return { type: 'ema_pullback_confirmed' };
  return null;
}
