import { barEtHHMM } from '@/lib/intraday/indicators/engine';
import { findBarIndexByTimeEt } from '@/lib/intraday/diagnostics/barIndex';
import { entryConfirmationClass } from '@/lib/intraday/diagnostics/delayedEntryGate';
import { DEFAULT_EMA_TREND_DAY_V2_CONFIG } from '@/lib/intraday/strategies/emaTrendDayV2/config';
import { buildBarContexts } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import { evaluateMomentum } from '@/lib/intraday/strategies/emaTrendDayV2/momentumEngine';
import { PullbackStateMachine } from '@/lib/intraday/strategies/emaTrendDayV2/pullbackState';
import type { EmaTrendDayV2Config, MinuteBar } from '@/lib/intraday/types';

export type PullbackMomentumTimeline = {
  sessionDate: string;
  entryTimeEt: string;
  pullbackDetectedTime: string | null;
  momentumConfirmedTime: string | null;
  entryTime: string;
  confirmationClass: string;
};

export function replayPullbackMomentumTimeline(
  sessionDate: string,
  bars: MinuteBar[],
  entryTimeEt: string,
  config: EmaTrendDayV2Config = DEFAULT_EMA_TREND_DAY_V2_CONFIG,
): PullbackMomentumTimeline {
  const contexts = buildBarContexts(bars);
  const fsm = new PullbackStateMachine();
  const warmup = config.warmupBars;
  let pullbackDetectedTime: string | null = null;
  let momentumConfirmedTime: string | null = null;
  const entryIdx = findBarIndexByTimeEt(bars, entryTimeEt);

  for (let i = warmup; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const ctx = contexts[i];
    const ctxPrev = contexts[i - 1];
    if (!Number.isFinite(ctx.ema9)) continue;

    const phaseBefore = fsm.phase;
    if (config.allowPullbackEntry) fsm.tick(b, prev, ctx, config);
    if (phaseBefore !== 'pullback_detected' && fsm.phase === 'pullback_detected') {
      pullbackDetectedTime = barEtHHMM(b.t);
    }

    const mom = evaluateMomentum(bars, i, b, ctx, ctxPrev, config);
    if (
      momentumConfirmedTime == null &&
      fsm.phase === 'wait_momentum' &&
      mom.score >= config.minMomentumScore
    ) {
      momentumConfirmedTime = barEtHHMM(b.t);
    }
  }

  let confirmationClass = '—';
  if (entryIdx >= 0) {
    confirmationClass = entryConfirmationClass(
      bars,
      entryIdx,
      bars[entryIdx],
      contexts[entryIdx],
      config,
    );
  }

  return {
    sessionDate,
    entryTimeEt,
    pullbackDetectedTime,
    momentumConfirmedTime,
    entryTime: entryTimeEt,
    confirmationClass,
  };
}
