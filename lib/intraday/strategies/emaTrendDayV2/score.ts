import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config, MarketRegime } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type ScoreResult = { score: number; lines: string[] };

export function scoreEntryCandidate(
  signalType: 'ema_cross_up_confirmed' | 'ema_pullback_confirmed',
  b: MinuteBar,
  ctx: BarContext,
  regime: MarketRegime,
  config: EmaTrendDayV2Config,
): ScoreResult {
  const lines: string[] = [];
  let score = 40;

  if (ctx.ema9 > ctx.ema20) {
    score += 12;
    lines.push('+ EMA9 > EMA20');
  } else {
    lines.push('- EMA9 not above EMA20');
  }
  if (ctx.ema9Slope > 0) {
    score += 8;
    lines.push('+ EMA9 rising');
  }
  if (ctx.ema20Slope >= 0) {
    score += 6;
    lines.push('+ EMA20 flat/rising');
  }
  if (b.c > ctx.vwap) {
    score += 10;
    lines.push('+ price above VWAP');
  } else {
    lines.push('- below VWAP');
  }
  if (ctx.emaSpreadPct >= config.minEmaSpreadPctBull) {
    score += 8;
    lines.push('+ EMA spread OK');
  } else {
    lines.push('- tight EMA spread');
  }
  if (ctx.relVolume >= config.minRelativeVolumePrefer) {
    score += 6;
    lines.push(`+ volume ${ctx.relVolume.toFixed(2)}x`);
  } else if (config.volumeFilterMode !== 'OFF') {
    lines.push(`- volume ${ctx.relVolume.toFixed(2)}x`);
  }

  if (signalType === 'ema_pullback_confirmed') {
    score += 5;
    lines.push('+ pullback rejection');
    if (b.c > b.o) lines.push('+ green bar');
  }

  if (regime === 'BULL_TREND') {
    score += 10;
    lines.push('+ BULL_TREND regime');
  } else if (regime === 'CHOP') {
    score -= 15;
    lines.push('- CHOP regime');
  }

  if (ctx.emaCrossCount30 > 1) {
    score -= 5;
    lines.push(`- ${ctx.emaCrossCount30} EMA crosses/30m`);
  }

  return { score: Math.max(0, Math.min(100, score)), lines };
}

export function passesVolumeFilter(ctx: BarContext, config: EmaTrendDayV2Config): boolean {
  if (config.volumeFilterMode === 'OFF') return true;
  if (config.volumeFilterMode === 'REQUIRE') {
    return ctx.relVolume >= config.minRelativeVolumeRequire;
  }
  return ctx.relVolume >= config.minRelativeVolumePrefer;
}

export function isPriceExtended(b: MinuteBar, ctx: BarContext, config: EmaTrendDayV2Config): boolean {
  const distEma9 = ((b.c - ctx.ema9) / ctx.ema9) * 100;
  const distVwap = ((b.c - ctx.vwap) / ctx.vwap) * 100;
  return (
    distEma9 > config.maxExtensionFromEma9Pct || distVwap > config.maxExtensionFromVwapPct
  );
}

export function distPctFromEma9(b: MinuteBar, ctx: BarContext): number {
  return ((b.c - ctx.ema9) / ctx.ema9) * 100;
}

export function distPctFromVwap(b: MinuteBar, ctx: BarContext): number {
  return ((b.c - ctx.vwap) / ctx.vwap) * 100;
}
