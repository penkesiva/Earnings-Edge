import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config, MinuteBar } from '@/lib/intraday/types';
import { priorBarHigh } from '@/lib/intraday/diagnostics/barIndex';

export type GateVerdict = { pass: boolean; reason: string };

export type DelayedGateAuditRow = {
  sessionDate: string;
  timeEt: string;
  setupType: string;
  acceptedInProduction: boolean;
  close: number;
  B: GateVerdict;
  C: GateVerdict;
  D: GateVerdict;
  E: GateVerdict;
};

function volumeAccel(bars: MinuteBar[], i: number, b: MinuteBar): number {
  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  return volPrev5 > 0 ? b.v / volPrev5 : 1;
}

export function evaluateGateB(bars: MinuteBar[], i: number, b: MinuteBar): GateVerdict {
  const high1 = priorBarHigh(bars, i, 1);
  if (high1 == null) return { pass: false, reason: 'need 1 prior bar' };
  if (b.c > high1) return { pass: true, reason: `close ${b.c.toFixed(4)} > prior 1-bar high ${high1.toFixed(4)}` };
  return { pass: false, reason: `close ${b.c.toFixed(4)} <= prior 1-bar high ${high1.toFixed(4)}` };
}

export function evaluateGateC(bars: MinuteBar[], i: number, b: MinuteBar): GateVerdict {
  const high2 = priorBarHigh(bars, i, 2);
  if (high2 == null) return { pass: false, reason: 'need 2 prior bars' };
  if (b.c > high2) return { pass: true, reason: `close ${b.c.toFixed(4)} > prior 2-bar high ${high2.toFixed(4)}` };
  return { pass: false, reason: `close ${b.c.toFixed(4)} <= prior 2-bar high ${high2.toFixed(4)}` };
}

export function evaluateGateD(bars: MinuteBar[], i: number, b: MinuteBar): GateVerdict {
  const c = evaluateGateC(bars, i, b);
  if (!c.pass) return { pass: false, reason: `C fail: ${c.reason}` };
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  if (ret3 > 0) return { pass: true, reason: `${c.reason}; ret3 ${(ret3 * 100).toFixed(3)}% > 0` };
  return { pass: false, reason: `${c.reason}; ret3 ${(ret3 * 100).toFixed(3)}% <= 0` };
}

export function evaluateGateE(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  config: EmaTrendDayV2Config,
): GateVerdict {
  const d = evaluateGateD(bars, i, b);
  if (!d.pass) return { pass: false, reason: `D fail: ${d.reason}` };
  const va = volumeAccel(bars, i, b);
  const rel = ctx.relVolume;
  const volOk = va >= 1.1 && rel >= config.minRelativeVolumePrefer;
  if (volOk) {
    return {
      pass: true,
      reason: `${d.reason}; volAccel ${va.toFixed(2)} >= 1.1; relVol ${rel.toFixed(2)} >= ${config.minRelativeVolumePrefer}`,
    };
  }
  return {
    pass: false,
    reason: `${d.reason}; volAccel ${va.toFixed(2)} or relVol ${rel.toFixed(2)} below require`,
  };
}

export function auditDelayedGatesAtBar(
  sessionDate: string,
  timeEt: string,
  setupType: string,
  acceptedInProduction: boolean,
  bars: MinuteBar[],
  i: number,
  ctx: BarContext,
  config: EmaTrendDayV2Config,
): DelayedGateAuditRow {
  const b = bars[i];
  return {
    sessionDate,
    timeEt,
    setupType,
    acceptedInProduction,
    close: b.c,
    B: evaluateGateB(bars, i, b),
    C: evaluateGateC(bars, i, b),
    D: evaluateGateD(bars, i, b),
    E: evaluateGateE(bars, i, b, ctx, config),
  };
}

export function variantEntryFingerprint(trades: { sessionDate: string; entryTimeEt: string }[]): string {
  return trades
    .map(t => `${t.sessionDate}T${t.entryTimeEt}`)
    .sort()
    .join('|');
}
