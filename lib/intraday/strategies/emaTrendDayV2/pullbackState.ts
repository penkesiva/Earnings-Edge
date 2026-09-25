import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import type { EmaTrendDayV2Config } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type PullbackPhase =
  | 'idle'
  | 'uptrend'
  | 'pullback_detected'
  | 'support_zone'
  | 'wait_momentum';

/** Pullback entry state machine (momentum mode only). */
export class PullbackStateMachine {
  phase: PullbackPhase = 'idle';
  barsInPhase = 0;

  reset() {
    this.phase = 'idle';
    this.barsInPhase = 0;
  }

  tick(
    b: MinuteBar,
    prev: MinuteBar,
    ctx: BarContext,
    config: EmaTrendDayV2Config,
  ): PullbackPhase {
    this.barsInPhase += 1;
    const zone = config.pullbackZonePct / 100;
    const inEmaZone = Math.abs(b.l - ctx.ema9) / ctx.ema9 <= zone;
    const uptrend = ctx.ema9 > ctx.ema20;

    if (!uptrend) {
      this.reset();
      return this.phase;
    }

    switch (this.phase) {
      case 'idle':
        this.phase = 'uptrend';
        this.barsInPhase = 0;
        break;
      case 'uptrend':
        if (b.c < ctx.ema9 || b.c < prev.c) {
          this.phase = 'pullback_detected';
          this.barsInPhase = 0;
        }
        break;
      case 'pullback_detected':
        if (inEmaZone || b.l <= ctx.ema9 * (1 + zone)) {
          this.phase = 'support_zone';
          this.barsInPhase = 0;
        } else if (this.barsInPhase > 15) this.reset();
        break;
      case 'support_zone':
        this.phase = 'wait_momentum';
        this.barsInPhase = 0;
        break;
      case 'wait_momentum':
        if (b.c < ctx.ema20) this.reset();
        else if (this.barsInPhase > 20) this.reset();
        break;
    }
    return this.phase;
  }

  readyForMomentumEntry(): boolean {
    return this.phase === 'wait_momentum';
  }
}
