/**
 * reconcileSignals — single authority for what to actually do on earnings.
 *
 * Structured in three tiers:
 *
 * Tier A — Scream qualifies (score ≥ 4, single clear bias):
 *   Strong enough for a directional debit trade.
 *
 * Tier B — Scream warns (score = 3, single clear bias) but below threshold:
 *   Not conviction-level, but the directional bias must influence structure.
 *   A 3/5 bearish scream blocks iron condor and put credit spreads.
 *   With high IV and no extreme downside risk → CALL_CREDIT_SPREAD.
 *   With extreme downside risk (put skew + selling + misses) → SKIP.
 *
 * Tier C — Scream inconclusive (score < 3 or mixed bias):
 *   Only sell vol if IV is high AND a numeric tilt score (built from F1, F2,
 *   beat history, setup, insider selling, unresolved risks) shows a clear lean.
 *   Iron condor requires genuine neutrality — not confusion.
 *
 * Key fix: the high-IV fallback path previously used only F1 chain volume and
 * beatStreakScore for tilt. It now uses a 7-signal numeric tilt score including
 * F2 IV skew, insider dollar selling, unresolved risk count, and F4 setup.
 * A 25Δ put skew of ≥15pts combined with any one material bearish signal will
 * set asymmetricDownsideRisk = true and block both IRON_CONDOR and
 * PUT_CREDIT_SPREAD regardless of tilt result.
 */

import type { BeatScoreResult } from './beatScore';
import type { ScreamTestResult } from './screamTest';

export type FinalAction =
  | 'SKIP'
  | 'IRON_CONDOR'
  | 'PUT_CREDIT_SPREAD'   // sell put spread — bullish tilt, sell vol
  | 'CALL_CREDIT_SPREAD'  // sell call spread — bearish tilt, sell vol
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
  /** From getNetInsiderBuying90d — negative = net selling in millions. */
  netInsiderBuying90d: number;
  /** 5-day sector ETF return %. */
  sectorReturn5d: number;
}): ReconcileResult {
  const { beatScore, scream, ivRank, netInsiderBuying90d, sectorReturn5d } = opts;

  // ── Tier gate vars ────────────────────────────────────────────────────────
  const screamQualifies =
    scream.score >= 4 &&
    scream.directionalBias !== 'mixed' &&
    scream.directionalBias !== 'none';

  const screamWarns =
    !screamQualifies &&
    scream.score >= 3 &&
    scream.directionalBias !== 'mixed' &&
    scream.directionalBias !== 'none';

  // ── Shared derived values ─────────────────────────────────────────────────
  const beatStreakScore = beatScore.components.beatStreakScore;
  const beatIsSkip = beatScore.signal === 'SKIP';
  const unresolvedCount = scream.unresolvedOverhangs.length;
  const setupIsBearish = scream.filters.setupConfirmation.direction === 'bearish';

  // putSkewPts: positive = puts richer = bearish market fear
  const putSkewPts = scream.putSkewPts ?? 0;
  const callSkewPts = -putSkewPts; // positive = calls richer = bullish demand

  // ── Asymmetric risk detection ─────────────────────────────────────────────
  // These flags block structures that short exposure on the threatened side.
  const extremePutSkew = putSkewPts >= 15;   // e.g. NET +20.2pts
  const strongPutSkew  = putSkewPts >= 10;
  const extremeCallSkew = callSkewPts >= 15;
  const strongCallSkew  = callSkewPts >= 10;

  const materialInsiderSelling = netInsiderBuying90d <= -5;   // ≤ -$5M
  const unresolvedRisky        = unresolvedCount >= 2;
  const weakEarningsHistory    = beatStreakScore <= 35;        // ≤ 1/4 beats

  const bearCountInFilters = Object.values(scream.filters)
    .filter(f => f.passed && f.direction === 'bearish').length;
  const bearishScreamPressure =
    scream.directionalBias === 'bearish' || bearCountInFilters >= 2;

  // Downside asymmetry: extreme put skew alone is enough if any one other
  // bearish factor present; moderate put skew needs scream pressure + factor.
  const asymmetricDownsideRisk =
    (extremePutSkew &&
      (materialInsiderSelling || unresolvedRisky || weakEarningsHistory)) ||
    (strongPutSkew &&
      bearishScreamPressure &&
      (materialInsiderSelling || unresolvedRisky || weakEarningsHistory));

  const asymmetricUpsideRisk =
    extremeCallSkew && unresolvedRisky;

  // ── Numeric tilt score (range ≈ −12 to +12) ──────────────────────────────
  // ≥ +3 = bullish, ≤ −3 = bearish, else mixed.
  // Sources: F1 chain volume, F2 IV skew, beat frequency, F4 setup,
  //          insider dollar flow, unresolved risk count, sector momentum.
  let tiltScore = 0;

  // F1 — chain volume conviction
  if (scream.filters.chainConviction.direction === 'bullish') tiltScore += 2;
  if (scream.filters.chainConviction.direction === 'bearish') tiltScore -= 2;

  // F2 — 25Δ IV skew
  if (putSkewPts >= 15)       tiltScore -= 3;
  else if (putSkewPts >= 10)  tiltScore -= 2;
  else if (putSkewPts >= 2)   tiltScore -= 1;
  if (putSkewPts <= -15)      tiltScore += 3;
  else if (putSkewPts <= -10) tiltScore += 2;
  else if (putSkewPts <= -2)  tiltScore += 1;

  // Beat frequency
  if (beatStreakScore >= 75) tiltScore += 2;
  if (beatStreakScore <= 35) tiltScore -= 2;

  // F4 setup overhangs
  if (setupIsBearish) tiltScore -= 2;

  // Insider flow (dollar-weighted, millions)
  if (netInsiderBuying90d <= -25) tiltScore -= 2;
  else if (netInsiderBuying90d <= -5) tiltScore -= 1;
  else if (netInsiderBuying90d >= 5) tiltScore += 1;

  // Unresolved narrative risks
  if (unresolvedCount >= 3)      tiltScore -= 2;
  else if (unresolvedCount >= 1) tiltScore -= 1;

  // Sector momentum
  if (sectorReturn5d >= 5)  tiltScore += 1;
  if (sectorReturn5d <= -5) tiltScore -= 1;

  const tilt: 'bullish' | 'bearish' | 'mixed' =
    tiltScore >= 3 ? 'bullish' : tiltScore <= -3 ? 'bearish' : 'mixed';

  // ── True neutrality (required for iron condor) ────────────────────────────
  // Iron condor means "I believe realized vol will be lower than implied,
  // with no directional skew." All of the following must hold:
  const trulyNeutral =
    tilt === 'mixed' &&
    !screamWarns &&                        // 3/5 directional warns blocks condor
    !asymmetricDownsideRisk &&
    !asymmetricUpsideRisk &&
    unresolvedCount === 0 &&
    Math.abs(putSkewPts) < 8;             // skew within ±8pts = no pricing asymmetry

  // ── Tier A: Scream qualifies directionally (score ≥ 4) ───────────────────
  if (screamQualifies) {
    if (scream.directionalBias === 'bearish') {
      return {
        final_action: 'PUT_DEBIT_SPREAD',
        rationale:
          `Scream qualifies bearish (${scream.score}/5). Defined-risk put spread. ` +
          `Beat score ${beatScore.composite}, IV rank ${ivRank}.`,
      };
    }
    // Bullish
    if (ivRank > 70) {
      return {
        final_action: 'CALL_DEBIT_SPREAD',
        rationale:
          `Scream qualifies bullish (${scream.score}/5) but IV rank ${ivRank} is elevated — ` +
          `spread limits crush exposure.`,
      };
    }
    if (beatIsSkip) {
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
          `is high conviction with IV rank ${ivRank} — go directional.`,
      };
    }
    return {
      final_action: 'CALL_DEBIT_SPREAD',
      rationale:
        `Scream qualifies bullish (${scream.score}/5), beat score ${beatScore.composite} ` +
        `(${beatScore.signal}), IV rank ${ivRank} — call spread balances edge with risk control.`,
    };
  }

  // ── Tier B: Scream warns (score = 3, clear bias) ──────────────────────────
  // The directional signal is real but below the conviction bar.
  // It should influence which structures are safe, even if it can't greenlight a debit trade.
  if (screamWarns) {
    if (scream.directionalBias === 'bearish') {
      if (asymmetricDownsideRisk) {
        // Extreme put skew + bearish signals = too risky for short-put exposure.
        // Not enough conviction to buy puts outright at 3/5.
        return {
          final_action: 'SKIP',
          rationale:
            `Scream warns bearish (${scream.score}/5, tilt score ${tiltScore}) — below the ` +
            `4/5 bar for a directional trade. Asymmetric downside risk detected: ` +
            `put skew ${putSkewPts.toFixed(1)}pts` +
            (materialInsiderSelling
              ? `, insider net selling $${Math.abs(netInsiderBuying90d).toFixed(0)}M`
              : '') +
            (unresolvedRisky ? `, ${unresolvedCount} unresolved risks` : '') +
            (weakEarningsHistory ? `, weak beat history (streak score ${beatStreakScore})` : '') +
            `. Iron condor and put credit spread blocked — selling put exposure into ` +
            `this setup risks a gap through the wing. Skip.`,
        };
      }
      // Bearish lean with high IV but manageable risk: sell upside calls only.
      if (ivRank > 70) {
        return {
          final_action: 'CALL_CREDIT_SPREAD',
          rationale:
            `Scream warns bearish (${scream.score}/5, tilt score ${tiltScore}). ` +
            `Below the directional trade threshold, but IV rank ${ivRank} is elevated. ` +
            `Selling upside calls with defined risk. Iron condor blocked — ` +
            `bearish scream pressure prevents a safe symmetric structure.`,
        };
      }
      return {
        final_action: 'SKIP',
        rationale:
          `Scream warns bearish (${scream.score}/5) but IV rank ${ivRank} is not ` +
          `elevated enough to sell. No edge — skip.`,
      };
    }

    // Bullish warns
    if (asymmetricUpsideRisk) {
      return {
        final_action: 'SKIP',
        rationale:
          `Scream warns bullish (${scream.score}/5) but asymmetric upside risk detected ` +
          `(call skew ${callSkewPts.toFixed(1)}pts, ${unresolvedCount} unresolved risks). Skip.`,
      };
    }
    if (ivRank > 70) {
      return {
        final_action: 'PUT_CREDIT_SPREAD',
        rationale:
          `Scream warns bullish (${scream.score}/5, tilt score ${tiltScore}). ` +
          `IV rank ${ivRank} is elevated with no asymmetric downside risk — ` +
          `sell put credit spread with bullish bias.`,
      };
    }
    return {
      final_action: 'SKIP',
      rationale:
        `Scream warns bullish (${scream.score}/5) but IV rank ${ivRank} is not ` +
        `elevated enough to sell. Skip.`,
    };
  }

  // ── Tier C: Scream inconclusive (score < 3 or mixed/none bias) ───────────
  if (ivRank <= 70) {
    return {
      final_action: 'SKIP',
      rationale:
        `Scream test inconclusive (${scream.score}/5, ${scream.directionalBias}) ` +
        `and IV rank ${ivRank} is not elevated enough to sell. No edge — skip.`,
    };
  }

  // High IV + inconclusive scream. Use numeric tilt to pick a side.
  if (tilt === 'bearish') {
    if (beatIsSkip && beatStreakScore > 35) {
      return {
        final_action: 'SKIP',
        rationale:
          `IV rank ${ivRank} is elevated and tilt score is ${tiltScore} (bearish), ` +
          `but beat score ${beatScore.composite} is SKIP without a clear bearish frequency ` +
          `signal. No thesis — skip.`,
      };
    }
    return {
      final_action: 'CALL_CREDIT_SPREAD',
      rationale:
        `Scream inconclusive (${scream.score}/5) but tilt score is ${tiltScore} (bearish). ` +
        `IV rank ${ivRank} is elevated — sell upside calls with defined risk. ` +
        `Put side excluded because bearish tilt makes a symmetric condor unsafe.`,
    };
  }

  if (tilt === 'bullish') {
    const bigUnresolvedDrop = scream.unresolvedOverhangs.some(
      (o) => !o.resolved && o.drawdownPct != null && o.drawdownPct < -7,
    );
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
      if (setupIsBearish) reasons.push('bearish setup signals contradict bullish tilt');
      if (beatIsSkip)     reasons.push(`beat score ${beatScore.composite} is SKIP`);
      return {
        final_action: 'SKIP',
        rationale:
          `Tilt score ${tiltScore} (bullish) but safety blockers prevent selling put ` +
          `exposure: ${reasons.join('; ')}.`,
      };
    }
    return {
      final_action: 'PUT_CREDIT_SPREAD',
      rationale:
        `Scream inconclusive (${scream.score}/5) but tilt score is ${tiltScore} (bullish). ` +
        `IV rank ${ivRank} is elevated with clean downside — sell put credit spread.`,
    };
  }

  // Mixed tilt: only sell vol if the setup is genuinely balanced.
  if (ivRank > 70 && trulyNeutral) {
    return {
      final_action: 'IRON_CONDOR',
      rationale:
        `Scream inconclusive (${scream.score}/5, mixed), tilt score is ${tiltScore} (balanced), ` +
        `no asymmetric risk, no unresolved overhangs, skew within ±8pts. ` +
        `IV rank ${ivRank} — symmetric iron condor.`,
    };
  }

  return {
    final_action: 'SKIP',
    rationale:
      `Scream inconclusive (${scream.score}/5, ${scream.directionalBias}), ` +
      `tilt score ${tiltScore} is mixed but conditions are not neutral enough for a ` +
      `symmetric iron condor (requires: tilt=mixed, no directional scream warn, ` +
      `no asymmetric risk, 0 unresolved risks, |skew| < 8pts). Skip.`,
  };
}
