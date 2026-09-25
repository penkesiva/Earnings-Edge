import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config, ForensicsDelayedEntryVariant, MinuteBar } from '@/lib/intraday/types';
import {
  evaluateGateB,
  evaluateGateC,
  evaluateGateD,
  evaluateGateE,
} from '@/lib/intraday/diagnostics/candidateGateAudit';
import { priorBarHigh } from '@/lib/intraday/diagnostics/barIndex';

export function passesForensicsDelayedEntry(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  config: EmaTrendDayV2Config,
): boolean {
  const variant = config.forensicsDelayedEntryVariant ?? 'A';
  if (variant === 'A') return true;
  if (variant === 'B') return evaluateGateB(bars, i, b).pass;
  if (variant === 'C') return evaluateGateC(bars, i, b).pass;
  if (variant === 'D') return evaluateGateD(bars, i, b).pass;
  if (variant === 'E') return evaluateGateE(bars, i, b, ctx, config).pass;
  return true;
}

export function entryConfirmationClass(
  bars: MinuteBar[],
  i: number,
  b: MinuteBar,
  ctx: BarContext,
  config: EmaTrendDayV2Config,
): 'A' | 'B' | 'C' | 'D' | 'E' {
  const inZone =
    Math.abs(b.l - ctx.ema9) / ctx.ema9 <= config.pullbackZonePct / 100 ||
    b.l <= ctx.ema9 * (1 + config.pullbackZonePct / 100);
  const touchOnly = inZone && !(b.c > b.o);
  if (touchOnly) return 'A';

  const ret1 = i >= 1 ? b.c / bars[i - 1].c - 1 : 0;
  const ret3 = i >= 3 ? b.c / bars[i - 3].c - 1 : 0;
  const bullish = b.c > b.o;
  const high2 = priorBarHigh(bars, i, 2);
  const broke2 = high2 != null && b.c > high2;
  const volPrev5 =
    i >= 5
      ? bars.slice(i - 5, i).reduce((a, x) => a + x.v, 0) / 5
      : bars.slice(0, i).reduce((a, x) => a + x.v, 0) / Math.max(i, 1);
  const volumeAcceleration = volPrev5 > 0 ? b.v / volPrev5 : 1;
  const volOk =
    volumeAcceleration >= 1.1 && ctx.relVolume >= config.minRelativeVolumePrefer;

  if (broke2 && ret3 > 0 && volOk) return 'E';
  if (broke2 && ret3 > 0) return 'D';
  if (bullish && (ret1 > 0 || ret3 > 0)) return 'C';
  if (bullish) return 'B';
  return 'A';
}

export const FORENSICS_VARIANTS: ForensicsDelayedEntryVariant[] = ['A', 'B', 'C', 'D', 'E'];
