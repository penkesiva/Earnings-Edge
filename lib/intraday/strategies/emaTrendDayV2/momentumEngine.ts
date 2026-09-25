import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type MomentumResult = {
  score: number;
  lines: string[];
  microBreakout: boolean;
  closeLocation: number;
  return3m: number;
  volumeAcceleration: number;
};

export function evaluateMomentum(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: EmaTrendDayV2Config,
): MomentumResult {
  const lines: string[] = [];
  let score = 0;

  const wPrice = config.momentumWeightPrice;
  const wCandle = config.momentumWeightCandle;
  const wMicro = config.momentumWeightMicroBreak;
  const wVol = config.momentumWeightVolume;
  const wEma = config.momentumWeightEma;
  const wVwap = config.momentumWeightVwap;

  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  const ret5 = i >= 5 ? b.c / bars[i - 5].c - 1 : 0;

  let pricePts = 0;
  if (ret1 > 0) {
    pricePts += wPrice * 0.35;
    lines.push('+ 1m return positive');
  }
  if (ret3 > 0) {
    pricePts += wPrice * 0.4;
    lines.push('+ 3m momentum positive');
  }
  if (ret5 > 0) pricePts += wPrice * 0.25;
  if (i >= 6 && ret3 > b.c / bars[i - 6].c - 1) {
    pricePts += wPrice * 0.15;
    lines.push('+ 3m accelerating');
  }
  score += Math.min(wPrice, pricePts);

  const range = Math.max(b.h - b.l, 1e-9);
  const body = b.c - b.o;
  const closeLocation = (b.c - b.l) / range;
  const bodyStrength = body / range;
  let candlePts = 0;
  if (b.c > b.o) {
    candlePts += wCandle * 0.4;
    lines.push('+ bullish candle');
  } else {
    lines.push('- bearish candle');
  }
  if (closeLocation >= config.minCloseLocation) {
    candlePts += wCandle * 0.45;
    lines.push('+ close upper range');
  }
  if (bodyStrength >= 0.35) candlePts += wCandle * 0.15;
  if (b.c < b.o && bodyStrength < -0.2) candlePts = 0;
  score += Math.min(wCandle, candlePts);

  const n = config.microBreakoutBars;
  let microBreakout = false;
  if (i >= n) {
    let priorHigh = -Infinity;
    for (let j = i - n; j < i; j++) priorHigh = Math.max(priorHigh, bars[j].h);
    microBreakout = b.c > priorHigh;
  }
  if (microBreakout) {
    score += wMicro;
    lines.push(`+ broke prior ${n}-bar high`);
  }

  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volumeAcceleration = volPrev5 > 0 ? b.v / volPrev5 : 1;

  let volPts = 0;
  if (config.volumeMomentumMode === 'OFF') {
    // volume excluded from score
  } else {
  const volVsPrev = i >= 1 && bars[i - 1].v > 0 ? b.v / bars[i - 1].v : 1;
  if (ctx.relVolume >= config.minRelativeVolumePrefer) {
    volPts += wVol * 0.5;
    lines.push(`+ rel vol ${ctx.relVolume.toFixed(2)}x`);
  } else {
    lines.push('- volume average');
  }
  if (volumeAcceleration >= 1.1) volPts += wVol * 0.3;
  if (volVsPrev >= 1.05 && b.c > b.o) volPts += wVol * 0.2;
  score += Math.min(wVol, volPts);
  }

  let emaPts = 0;
  if (ctx.ema9 > ctx.ema20) emaPts += wEma * 0.25;
  if (ctx.ema9Slope > 0) {
    emaPts += wEma * 0.25;
    lines.push('+ EMA9 slope rising');
  }
  if (ctx.ema20Slope > 0) emaPts += wEma * 0.15;
  if (ctx.ema9Slope > ctxPrev.ema9Slope) {
    emaPts += wEma * 0.15;
    lines.push('+ EMA9 slope increasing');
  }
  if (ctx.emaSpreadPct > ctxPrev.emaSpreadPct) {
    emaPts += wEma * 0.2;
    lines.push('+ EMA spread expanding');
  }
  score += Math.min(wEma, emaPts);

  const vwapSlope = ctxPrev.vwap > 0 ? (ctx.vwap - ctxPrev.vwap) / ctxPrev.vwap : 0;
  let vwapPts = 0;
  if (b.c > ctx.vwap) vwapPts += wVwap * 0.5;
  else {
    vwapPts -= wVwap * 0.3;
    lines.push('- below VWAP');
  }
  if (vwapSlope >= 0 && b.c > ctx.vwap) {
    vwapPts += wVwap * 0.5;
    lines.push('+ above rising VWAP');
  } else if (vwapSlope < 0 && b.c < ctx.vwap) {
    vwapPts = Math.max(0, vwapPts - wVwap * 0.4);
    lines.push('- VWAP falling, price weak');
  } else if (vwapSlope < 0 && b.c > ctx.vwap && ctxPrev.ema9 <= ctxPrev.ema20 && ctx.ema9 > ctx.ema20) {
    vwapPts = Math.max(0, vwapPts - wVwap * 0.5);
    lines.push('- bullish cross below falling VWAP');
  }
  score += Math.max(0, Math.min(wVwap, vwapPts));

  if (config.volumeMomentumMode === 'REQUIRE' && ctx.relVolume < config.minRelativeVolumePrefer) {
    score = Math.min(score, config.minMomentumScore - 1);
    lines.push('- volume REQUIRE fail');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    lines,
    microBreakout,
    closeLocation,
    return3m: ret3,
    volumeAcceleration,
  };
}

export function passesMomentumGate(
  momentum: MomentumResult,
  config: EmaTrendDayV2Config,
  requireMicroBreakForPullback: boolean,
  isPullback: boolean,
): { ok: boolean; reason?: string } {
  if (config.entryMode !== 'EMA_REGIME_MOMENTUM') return { ok: true };
  if (momentum.score < config.minMomentumScore) {
    return { ok: false, reason: 'MOMENTUM_SCORE_LOW' };
  }
  if (isPullback && requireMicroBreakForPullback && !momentum.microBreakout) {
    return { ok: false, reason: 'NO_MICRO_BREAKOUT' };
  }
  if (momentum.closeLocation < config.minCloseLocation && isPullback) {
    return { ok: false, reason: 'WEAK_CANDLE_CLOSE' };
  }
  return { ok: true };
}
