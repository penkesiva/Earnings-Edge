import type { BarContext } from '@/lib/intraday/strategies/emaTrendDayV2/indicators';
import {
  inResetZone,
  isMomentumExtended,
} from '@/lib/intraday/strategies/trendResumptionV1/resumption';
import { classifyMomentumPhase } from '@/lib/intraday/diagnostics/momentumPhase';
import type { TrendResumptionV1Config } from '@/lib/intraday/types';
import type { MinuteBar } from '@/lib/intraday/types';

export type ResumptionPhase =
  | 'wait_for_trend'
  | 'trend_confirmed'
  | 'wait_for_pullback'
  | 'pullback'
  | 'reset_zone'
  | 'waiting_for_resumption'
  | 'building'
  | 'expanding';

export class TrendResumptionFsm {
  phase: ResumptionPhase = 'wait_for_trend';
  barsInPhase = 0;
  prevMomentumPhase: ReturnType<typeof classifyMomentumPhase>['phase'] = 'FADING';

  reset() {
    this.phase = 'wait_for_trend';
    this.barsInPhase = 0;
  }

  tick(
    bars: MinuteBar[],
    i: number,
    b: MinuteBar,
    ctx: BarContext,
    ctxPrev: BarContext,
    config: TrendResumptionV1Config,
  ): void {
    this.barsInPhase += 1;
    const trendOk = ctx.ema9 > ctx.ema20 && ctx.ema9Slope > 0 && ctx.ema20Slope >= 0;

    if (!trendOk) {
      this.reset();
      return;
    }

    const mom = classifyMomentumPhase(bars, i, b, ctx, ctxPrev);
    if (isMomentumExtended(bars, i, b, ctx, ctxPrev, config)) {
      if (this.phase !== 'wait_for_trend' && this.phase !== 'trend_confirmed') {
        this.phase = 'wait_for_pullback';
        this.barsInPhase = 0;
      }
      this.prevMomentumPhase = mom.phase;
      return;
    }

    switch (this.phase) {
      case 'wait_for_trend':
        this.phase = 'trend_confirmed';
        this.barsInPhase = 0;
        break;
      case 'trend_confirmed':
        if (b.c < ctx.ema9 || inResetZone(b, ctx, config)) {
          this.phase = 'wait_for_pullback';
          this.barsInPhase = 0;
        }
        break;
      case 'wait_for_pullback':
        if (b.c < ctx.ema9 || b.c < ctx.vwap) {
          this.phase = 'pullback';
          this.barsInPhase = 0;
        }
        break;
      case 'pullback':
        if (inResetZone(b, ctx, config)) {
          this.phase = 'reset_zone';
          this.barsInPhase = 0;
        } else if (this.barsInPhase > 25) this.phase = 'wait_for_pullback';
        break;
      case 'reset_zone':
        this.phase = 'waiting_for_resumption';
        this.barsInPhase = 0;
        break;
      case 'waiting_for_resumption':
        if (mom.phase === 'BUILDING') {
          this.phase = 'building';
          this.barsInPhase = 0;
        } else if (this.barsInPhase > 30) this.phase = 'wait_for_pullback';
        break;
      case 'building':
        if (mom.phase === 'EXPANDING') {
          this.phase = 'expanding';
          this.barsInPhase = 0;
        }
        break;
      case 'expanding':
        break;
    }

    this.prevMomentumPhase = mom.phase;
  }

  readyEarlyEntry(): boolean {
    return this.phase === 'building';
  }

  readyConfirmedEntry(): boolean {
    return this.phase === 'expanding';
  }
}
