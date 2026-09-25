import { bollingerAtBar } from '@/lib/intraday/diagnostics/bollingerAtBar';
import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { MinuteBar } from '@/lib/intraday/types';

export type MomentumPhase = 'BUILDING' | 'EXPANDING' | 'EXTENDED' | 'FADING';

export type MomentumPhaseSnapshot = {
  phase: MomentumPhase;
  lines: string[];
};

export function classifyMomentumPhase(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  ctxPrev: BarContext,
): MomentumPhaseSnapshot {
  const lines: string[] = [];
  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  const ret5 = i >= 5 ? b.c / bars[i - 5].c - 1 : 0;
  const distEma9 = ((b.c - ctx.ema9) / ctx.ema9) * 100;
  const distVwap = ((b.c - ctx.vwap) / ctx.vwap) * 100;
  const spreadDelta = ctx.emaSpreadPct - ctxPrev.emaSpreadPct;
  const bb = bollingerAtBar(bars, i);
  const percentB = bb?.percentB ?? 0.5;
  const bwDelta = bb?.bandwidthSlope ?? 0;
  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volAccel = volPrev5 > 0 ? b.v / volPrev5 : 1;

  if (percentB > 1.0 || distVwap > 0.3 || (ret5 > 0.004 && distEma9 > 0.25)) {
    lines.push('extended: high %B or far from VWAP/EMA9');
    return { phase: 'EXTENDED', lines };
  }

  if (ret1 < 0 && ret3 > 0 && spreadDelta <= 0) {
    lines.push('fading: 1m down while 3m still up, spread not expanding');
    return { phase: 'FADING', lines };
  }

  if (ret3 > 0 && ret5 > 0 && spreadDelta > 0 && volAccel >= 1.05 && percentB >= 0.5 && percentB <= 0.9) {
    lines.push('expanding: 3m/5m up, spread up, moderate vol');
    return { phase: 'EXPANDING', lines };
  }

  if (ret1 > 0 && ret3 >= 0 && distVwap <= 0.15 && distEma9 <= 0.2 && spreadDelta >= 0) {
    lines.push('building: short returns turning up near VWAP/EMA9');
    return { phase: 'BUILDING', lines };
  }

  if (spreadDelta < 0 || ret3 < 0) {
    lines.push('fading: negative 3m or contracting spread');
    return { phase: 'FADING', lines };
  }

  lines.push(`neutral→building: bwΔ ${bwDelta.toFixed(4)}`);
  return { phase: 'BUILDING', lines };
}
