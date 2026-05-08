/**
 * reconcileSignals — single authority for what to actually do on earnings.
 *
 * Takes beat score, scream test, and IV rank and returns ONE final_action.
 * All other signals (beat score badge, suggested structure, scream recommendation)
 * are relegated to audit-only display on the detail page.
 *
 * Rules:
 *   1. Scream score < 4 (no clean directional gate):
 *        – IV rank ≤ 70 → SKIP
 *        – IV rank > 70:
 *            · Safety blockers present (unresolved drawdowns, bearish setup
 *              with bullish/mixed tilt, beat score SKIP) → SKIP
 *            · Otherwise infer directional tilt from beat-streak score and
 *              chain conviction:
 *                bullish tilt → PUT_CREDIT_SPREAD  (sell vol with bullish bias)
 *                bearish tilt → CALL_CREDIT_SPREAD (sell vol with bearish bias)
 *                mixed        → IRON_CONDOR        (symmetric)
 *   2. Scream qualifies (score ≥ 4, single directional bias):
 *        – bearish  → PUT_DEBIT_SPREAD
 *        – bullish + IV rank > 70 → CALL_DEBIT_SPREAD
 *        – bullish + IV rank ≤ 70:
 *            HIGH_CONVICTION → LONG_CALL
 *            DIRECTIONAL/SMALL_SPREAD → CALL_DEBIT_SPREAD
 *            SKIP → SKIP
 */

import type { BeatScoreResult } from './beatScore';
import type { ScreamTestResult } from './screamTest';

export type FinalAction =
  | 'SKIP'
  | 'IRON_CONDOR'
  | 'PUT_CREDIT_SPREAD'   // sell put credit spread — bullish tilt, sell vol
  | 'CALL_CREDIT_SPREAD'  // sell call credit spread — bearish tilt, sell vol
  | 'LONG_CALL'
  | 'LONG_PUT'
  | 'CALL_DEBIT_SPREAD'
  | 'PUT_DEBIT_SPREAD';

export type ReconcileResult = {
  final_action: FinalAction;
  rationale: string;
};

export function reconcileSignals(opts: {
  beatScore: BeatScoreResult;
  scream: ScreamTestResult;
  ivRank: number;
  spot: number;
  expectedMoveDollar: number;
  preferredExpiry: string;
}): ReconcileResult {
  const { beatScore, scream, ivRank } = opts;
  const screamPasses = scream.score >= 4 &&
    scream.directionalBias !== 'mixed' &&
    scream.directionalBias !== 'none';

  // ── Gate 1: scream test failed ─────────────────────────────────────────────
  if (!screamPasses) {
    if (ivRank <= 70) {
      return {
        final_action: 'SKIP',
        rationale:
          `Scream test did not qualify (${scream.score}/5, ${scream.directionalBias}) ` +
          `and IV rank ${ivRank} is not elevated enough to sell. No edge — skip.`,
      };
    }

    // High IV path. We may sell vol — but with directional tilt when warranted,
    // and never when downside is unhedgeable.

    // Detect directional tilt from the two most reliable bull/bear signals.
    // Use beatScore.components.beatStreakScore (always populated) instead of
    // scream filter 3's strict bullish/bearish (which requires Zacks ESP).
    const beatStreakBullish = beatScore.components.beatStreakScore >= 75;
    const beatStreakBearish = beatScore.components.beatStreakScore <= 25;
    const chainBullish = scream.filters.chainConviction.direction === 'bullish';
    const chainBearish = scream.filters.chainConviction.direction === 'bearish';

    const tiltBullish =
      (beatStreakBullish && !chainBearish) ||
      (chainBullish && !beatStreakBearish);
    const tiltBearish =
      (beatStreakBearish && !chainBullish) ||
      (chainBearish && !beatStreakBullish);

    const tilt: 'bullish' | 'bearish' | 'mixed' =
      tiltBullish ? 'bullish' : tiltBearish ? 'bearish' : 'mixed';

    // Safety blockers — selling premium requires the realized move to stay
    // between the short strikes. These conditions blow that up on the put side:
    //   1. Unresolved unexplained drawdowns < -7% (gap/jump risk)
    //   2. Bearish setup signals (insider selling, regulatory, stretched val)
    //   3. Beat score signal is SKIP (no fundamental thesis)
    // Bearish-tilted CALL_CREDIT_SPREAD is NOT blocked by 1 or 2 — those
    // conditions confirm the bearish thesis. It is blocked by 3 (no thesis).
    const bigUnresolvedDrop = scream.unresolvedOverhangs.some(
      (o) => !o.resolved && o.drawdownPct != null && o.drawdownPct < -7,
    );
    const setupIsBearish =
      scream.filters.setupConfirmation.direction === 'bearish';
    const beatIsSkip = beatScore.signal === 'SKIP';

    // Bearish tilt: bearish setup + drawdowns CONFIRM the trade.
    if (tilt === 'bearish') {
      if (beatIsSkip && !beatStreakBearish) {
        // Beat score is SKIP but not from low beat frequency — no thesis at all.
        return {
          final_action: 'SKIP',
          rationale:
            `IV rank ${ivRank} is elevated and chain leans bearish, but beat score ` +
            `${beatScore.composite} is SKIP without a clear bearish frequency signal. No thesis.`,
        };
      }
      return {
        final_action: 'CALL_CREDIT_SPREAD',
        rationale:
          `Scream did not qualify (${scream.score}/5) but the setup is bearish-leaning ` +
          `(beat-streak ${beatScore.components.beatStreakScore}, chain conviction ${scream.filters.chainConviction.direction}` +
          `${setupIsBearish ? ', bearish setup' : ''}). ` +
          `IV rank ${ivRank} is elevated — sell upside calls with defined risk. ` +
          `Skip the put side because the bearish narrative makes a symmetric condor unsafe.`,
      };
    }

    // Bullish or mixed tilt: short put exposure means downside risks DO matter.
    if (bigUnresolvedDrop || setupIsBearish || beatIsSkip) {
      const reasons: string[] = [];
      if (bigUnresolvedDrop) {
        const worst = scream.unresolvedOverhangs
          .filter((o) => !o.resolved && o.drawdownPct != null && o.drawdownPct < -7)
          .sort((a, b) => (a.drawdownPct ?? 0) - (b.drawdownPct ?? 0))[0];
        reasons.push(
          `unresolved ${worst?.drawdownPct?.toFixed(1)}% drawdown could blow through put wing`,
        );
      }
      if (setupIsBearish) reasons.push('bearish setup signals contradict bullish/mixed tilt');
      if (beatIsSkip) reasons.push(`beat score ${beatScore.composite} is SKIP — no fundamental thesis`);

      return {
        final_action: 'SKIP',
        rationale:
          `IV rank ${ivRank} is elevated, but high IV alone is not a thesis. ` +
          `Skip selling vol because: ${reasons.join('; ')}. ` +
          `Wait for a setup where realized vol can be reasonably bounded.`,
      };
    }

    if (tilt === 'bullish') {
      return {
        final_action: 'PUT_CREDIT_SPREAD',
        rationale:
          `Scream did not qualify (${scream.score}/5) but the setup is bullish-leaning ` +
          `(beat-streak ${beatScore.components.beatStreakScore}, chain conviction ${scream.filters.chainConviction.direction}). ` +
          `IV rank ${ivRank} is elevated and downside is clean (no big drawdowns, ` +
          `no bearish setup). Sell put credit spread — short-vol with bullish bias, ` +
          `defined risk if the stock gaps down.`,
      };
    }

    // Genuinely mixed setup with high IV and clean downside → symmetric condor.
    return {
      final_action: 'IRON_CONDOR',
      rationale:
        `Scream did not qualify (${scream.score}/5, mixed chain) and the setup is balanced ` +
        `(no clear bullish or bearish tilt). IV rank ${ivRank} is elevated — sell vol via ` +
        `iron condor with wings well outside the expected move.`,
    };
  }

  // ── Gate 2: scream qualifies ───────────────────────────────────────────────
  const dir = scream.directionalBias; // 'bullish' | 'bearish'

  if (dir === 'bearish') {
    return {
      final_action: 'PUT_DEBIT_SPREAD',
      rationale:
        `Scream qualifies bearish (${scream.score}/5). Defined-risk put spread. ` +
        `Beat score ${beatScore.composite}, IV rank ${ivRank}.`,
    };
  }

  // Bullish path
  if (ivRank > 70) {
    return {
      final_action: 'CALL_DEBIT_SPREAD',
      rationale:
        `Scream qualifies bullish (${scream.score}/5) but IV rank ${ivRank} is elevated — ` +
        `spread limits crush exposure.`,
    };
  }

  if (beatScore.signal === 'SKIP') {
    return {
      final_action: 'SKIP',
      rationale:
        `Scream qualifies bullish but beat score composite ${beatScore.composite} is below ` +
        `threshold — insufficient fundamental edge to trade.`,
    };
  }

  if (beatScore.signal === 'HIGH_CONVICTION') {
    return {
      final_action: 'LONG_CALL',
      rationale:
        `Scream qualifies bullish (${scream.score}/5) and beat score ${beatScore.composite} ` +
        `is high conviction with low-moderate IV rank ${ivRank} — cheap vol, go directional.`,
    };
  }

  // DIRECTIONAL or SMALL_SPREAD — defined-risk is the prudent default
  return {
    final_action: 'CALL_DEBIT_SPREAD',
    rationale:
      `Scream qualifies bullish (${scream.score}/5), beat score ${beatScore.composite} ` +
      `(${beatScore.signal}), IV rank ${ivRank} — call spread balances edge with risk control.`,
  };
}
