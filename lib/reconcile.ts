/**
 * reconcileSignals — single authority for what to actually do on earnings.
 *
 * Takes beat score, scream test, and IV rank and returns ONE final_action.
 * All other signals (beat score badge, suggested structure, scream recommendation)
 * are relegated to audit-only display on the detail page.
 *
 * Rules:
 *   1. If scream score < 4:
 *        – IV rank > 70 → IRON_CONDOR (sell premium, vol is rich)
 *        – otherwise   → SKIP
 *   2. Scream qualifies (score ≥ 4, single directional bias = 'bullish' or 'bearish'):
 *        – Direction bearish  → PUT_DEBIT_SPREAD  (scream + beat-score bearish)
 *        – Direction bullish:
 *            · IV rank > 70  → CALL_DEBIT_SPREAD   (cap vega exposure)
 *            · IV rank ≤ 70  → beat signal decides:
 *                HIGH_CONVICTION  → LONG_CALL
 *                DIRECTIONAL      → CALL_DEBIT_SPREAD
 *                SMALL_SPREAD     → CALL_DEBIT_SPREAD
 *                SKIP             → SKIP  (beat score says no edge regardless)
 */

import type { BeatScoreResult } from './beatScore';
import type { ScreamTestResult } from './screamTest';

export type FinalAction =
  | 'SKIP'
  | 'IRON_CONDOR'
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
    if (ivRank > 70) {
      // When setup filter (filter 4) shows bearish signals but chain is mixed,
      // flag the asymmetry: a symmetric condor risks the put wing blowing out.
      const setupIsBearish =
        scream.filters.setupConfirmation.direction === 'bearish';
      const chainIsMixed =
        scream.filters.chainConviction.direction === 'mixed' ||
        scream.filters.chainConviction.direction === 'none';
      const asymmetryNote =
        setupIsBearish && chainIsMixed
          ? ` ⚠ Bearish narrative (setup: ${scream.filters.setupConfirmation.detail.split(' signal')[0]}) but options chain is mixed — condor put wing carries downside skew risk. Consider widening put wing or skipping.`
          : '';

      return {
        final_action: 'IRON_CONDOR',
        rationale:
          `Scream test did not qualify (${scream.score}/5, mixed chain). ` +
          `IV rank ${ivRank} is elevated — sell vol via iron condor.` +
          asymmetryNote,
      };
    }
    return {
      final_action: 'SKIP',
      rationale:
        `Scream test did not qualify (${scream.score}/5, ${scream.directionalBias}) ` +
        `and IV rank ${ivRank} is not elevated enough to sell. No edge — skip.`,
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
