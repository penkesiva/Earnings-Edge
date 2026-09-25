import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import { classifyMomentumPhase } from '@/lib/intraday/diagnostics/momentumPhase';
import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { TrendResumptionV1Config } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export function distVwapPct(b: MinuteBar, ctx: BarContext): number {
  return ((b.c - ctx.vwap) / ctx.vwap) * 100;
}

export function distEma9Pct(b: MinuteBar, ctx: BarContext): number {
  return ((b.c - ctx.ema9) / ctx.ema9) * 100;
}

export function isMomentumExtended(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: TrendResumptionV1Config,
): boolean {
  const phase = classifyMomentumPhase(bars, i, b, ctx, ctxPrev).phase;
  if (phase === 'EXTENDED') return true;

  const dv = distVwapPct(b, ctx);
  const de = distEma9Pct(b, ctx);
  const bb = bollingerAtBar(bars, i);
  const ret1 = i >= 1 ? Math.abs((b.c / bars[i - 1].c - 1) * 100) : 0;
  const ret3 = i >= 3 ? Math.abs((b.c / bars[i - 3].c - 1) * 100) : 0;

  if (bb && bb.percentB > config.maxPercentBExtended && dv > config.maxDistVwapExtendedPct * 0.5) {
    return true;
  }
  if (dv > config.maxDistVwapExtendedPct || de > config.maxDistEma9ExtendedPct) return true;
  if (ret1 > config.maxRet1ExtendedPct || ret3 > config.maxRet3ExtendedPct) return true;

  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volAccel = volPrev5 > 0 ? b.v / volPrev5 : 1;
  const range = Math.max(b.h - b.l, 1e-9);
  const bodyPct = ((b.c - b.o) / range) * 100;
  if (volAccel >= config.volumeSpikeAccel && bodyPct > 55 && b.c > b.o) return true;

  return false;
}

export type VolumeClass = 'LOW' | 'NORMAL' | 'INCREASING' | 'SPIKE';

export function classifyVolume(ctx: BarContext, volAccel: number, config: TrendResumptionV1Config): VolumeClass {
  if (volAccel >= config.volumeSpikeAccel) return 'SPIKE';
  if (volAccel >= 1.12) return 'INCREASING';
  if (ctx.relVolume >= 1.05) return 'NORMAL';
  return 'LOW';
}

export type MomentumAccel = {
  deltaReturn1m: number;
  deltaReturn3m: number;
  deltaReturn5m: number;
  deltaEma9Slope: number;
  deltaEmaSpread: number;
  deltaBandWidth: number;
};

export function computeMomentumAccel(
  bars: MinuteBar[],
  i: number,
  ctx: BarContext,
  ctxPrev: BarContext,
): MomentumAccel {
  const ret = (idx: number, look: number) =>
    idx >= look ? bars[idx].c / bars[idx - look].c - 1 : 0;
  const ret1 = ret(i, 1);
  const ret3 = ret(i, 3);
  const ret5 = ret(i, 5);
  const ret1Prev = ret(i - 1, 1);
  const ret3Prev = ret(i - 1, 3);
  const ret5Prev = ret(i - 1, 5);
  const bb = bollingerAtBar(bars, i);
  const bbPrev = i > 0 ? bollingerAtBar(bars, i - 1) : null;
  return {
    deltaReturn1m: ret1 - ret1Prev,
    deltaReturn3m: ret3 - ret3Prev,
    deltaReturn5m: ret5 - ret5Prev,
    deltaEma9Slope: ctx.ema9Slope - ctxPrev.ema9Slope,
    deltaEmaSpread: ctx.emaSpreadPct - ctxPrev.emaSpreadPct,
    deltaBandWidth: (bb?.bandwidth ?? 0) - (bbPrev?.bandwidth ?? 0),
  };
}

export function inResetZone(b: MinuteBar, ctx: BarContext, config: TrendResumptionV1Config): boolean {
  const dv = Math.abs(distVwapPct(b, ctx));
  const de = Math.abs(distEma9Pct(b, ctx));
  return dv <= config.resetZoneVwapPct || de <= config.resetZoneEma9Pct;
}

export function resumptionEvidence(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
  config: TrendResumptionV1Config,
): { ok: boolean; lines: string[]; phase: ReturnType<typeof classifyMomentumPhase>['phase'] } {
  const lines: string[] = [];
  const mom = classifyMomentumPhase(bars, i, b, ctx, ctxPrev);
  const accel = computeMomentumAccel(bars, i, ctx, ctxPrev);
  const range = Math.max(b.h - b.l, 1e-9);
  const closeLoc = (b.c - b.l) / range;

  if (b.c <= b.o) {
    lines.push('- not bullish candle');
    return { ok: false, lines, phase: mom.phase };
  }
  if (closeLoc < config.minCloseLocation) {
    lines.push('- weak close location');
    return { ok: false, lines, phase: mom.phase };
  }
  if (mom.phase === 'EXTENDED' || mom.phase === 'FADING') {
    lines.push(`- momentum phase ${mom.phase}`);
    return { ok: false, lines, phase: mom.phase };
  }

  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  if (ret1 <= 0 && accel.deltaReturn1m <= 0) {
    lines.push('- 1m momentum not turning up');
    return { ok: false, lines, phase: mom.phase };
  }

  lines.push(`+ phase ${mom.phase}`);
  lines.push(`+ Δret3 ${(accel.deltaReturn3m * 100).toFixed(3)}%`);
  if (accel.deltaEmaSpread >= 0) lines.push('+ EMA spread stable/expanding');
  if (b.c >= ctx.vwap * 0.999) lines.push('+ holds VWAP');
  if (accel.deltaBandWidth > 0) lines.push('+ bandwidth expanding');

  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volAccel = volPrev5 > 0 ? b.v / volPrev5 : 1;
  lines.push(`+ vol class ${classifyVolume(ctx, volAccel, config)}`);

  return { ok: true, lines, phase: mom.phase };
}
