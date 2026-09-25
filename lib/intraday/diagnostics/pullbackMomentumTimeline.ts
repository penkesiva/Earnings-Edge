import { barEtHHMM, etHHMMToMinutes } from '@/lib/intraday/indicators/engine';
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
  timingValid: boolean;
  timingError: string | null;
};

function orderedTimes(a: string | null, b: string | null, c: string | null): { ok: boolean; err: string | null } {
  const seq = [
    { label: 'pullback', t: a },
    { label: 'momentum', t: b },
    { label: 'entry', t: c },
  ].filter(x => x.t) as { label: string; t: string }[];
  for (let i = 1; i < seq.length; i++) {
    if (etHHMMToMinutes(seq[i].t) < etHHMMToMinutes(seq[i - 1].t)) {
      return {
        ok: false,
        err: `${seq[i].label} ${seq[i].t} before ${seq[i - 1].label} ${seq[i - 1].t} (impossible)`,
      };
    }
  }
  return { ok: true, err: null };
}

/** Replay FSM only through entry bar — times for the setup that led to this entry. */
export function replayPullbackMomentumTimeline(
  sessionDate: string,
  bars: MinuteBar[],
  entryTimeEt: string,
  config: EmaTrendDayV2Config = DEFAULT_EMA_TREND_DAY_V2_CONFIG,
): PullbackMomentumTimeline {
  const contexts = buildBarContexts(bars);
  const entryIdx = findBarIndexByTimeEt(bars, entryTimeEt);
  const warmup = config.warmupBars;

  if (entryIdx < warmup) {
    return {
      sessionDate,
      entryTimeEt,
      pullbackDetectedTime: null,
      momentumConfirmedTime: null,
      entryTime: entryTimeEt,
      confirmationClass: '—',
      timingValid: false,
      timingError: 'entry bar not found or before warmup',
    };
  }

  const fsm = new PullbackStateMachine();
  let pullbackForSetup: string | null = null;
  let momentumForSetup: string | null = null;

  for (let i = warmup; i <= entryIdx; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const ctx = contexts[i];
    const ctxPrev = contexts[i - 1];
    if (!Number.isFinite(ctx.ema9)) continue;

    const phaseBefore = fsm.phase;
    if (config.allowPullbackEntry) fsm.tick(b, prev, ctx, config);

    if (phaseBefore === 'wait_momentum' && (fsm.phase === 'idle' || fsm.phase === 'uptrend')) {
      pullbackForSetup = null;
      momentumForSetup = null;
    }

    if (phaseBefore !== 'pullback_detected' && fsm.phase === 'pullback_detected') {
      pullbackForSetup = barEtHHMM(b.t);
      momentumForSetup = null;
    }

    if (fsm.phase === 'wait_momentum') {
      const mom = evaluateMomentum(bars, i, b, ctx, ctxPrev, config);
      if (mom.score >= config.minMomentumScore) {
        momentumForSetup = barEtHHMM(b.t);
      }
    }
  }

  const confirmationClass = entryConfirmationClass(
    bars,
    entryIdx,
    bars[entryIdx],
    contexts[entryIdx],
    config,
  );

  const order = orderedTimes(pullbackForSetup, momentumForSetup, entryTimeEt);
  let timingError: string | null = order.err;
  if (!pullbackForSetup) timingError = timingError ?? 'no pullback_detected before entry';
  if (!momentumForSetup) timingError = timingError ?? 'no momentumConfirmed before entry';

  const timingValid = order.ok && Boolean(pullbackForSetup) && Boolean(momentumForSetup);

  return {
    sessionDate,
    entryTimeEt,
    pullbackDetectedTime: pullbackForSetup,
    momentumConfirmedTime: momentumForSetup,
    entryTime: entryTimeEt,
    confirmationClass,
    timingValid,
    timingError: timingValid ? null : timingError,
  };
}
