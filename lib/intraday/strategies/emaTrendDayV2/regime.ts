import type { EmaTrendDayV2Config, MarketRegime } from '@/lib/intraday/types';
import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { MinuteBar } from '@/lib/intraday/types';

export function classifyRegime(
  b: MinuteBar,
  ctx: BarContext,
  config: EmaTrendDayV2Config,
): MarketRegime {
  if (!Number.isFinite(ctx.ema9) || !Number.isFinite(ctx.ema20)) return 'UNKNOWN';

  const chopByCross =
    ctx.emaCrossCount30 > config.maxEmaCrossCount30 ||
    ctx.vwapCrossCount30 > config.maxVwapCrossCount30;
  const chopBySpread = Math.abs(ctx.emaSpreadPct) < config.minEmaSpreadPctChop;
  const chopBySlope =
    Math.abs(ctx.ema9Slope) < config.flatSlopeAbsMax &&
    Math.abs(ctx.ema20Slope) < config.flatSlopeAbsMax;

  if (chopByCross || (chopBySpread && chopBySlope)) return 'CHOP';

  if (ctx.ema9 < ctx.ema20 && ctx.ema9Slope <= 0) return 'BEARISH';

  const bull =
    ctx.ema9 > ctx.ema20 &&
    ctx.ema9Slope > 0 &&
    ctx.ema20Slope > 0 &&
    b.c > ctx.vwap &&
    ctx.emaSpreadPct >= config.minEmaSpreadPctBull;

  if (bull) return 'BULL_TREND';

  if (ctx.ema9 < ctx.ema20) return 'BEARISH';

  return 'UNKNOWN';
}
