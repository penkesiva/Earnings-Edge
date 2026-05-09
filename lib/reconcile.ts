/**
 * reconcileSignals — single authority for what to actually do on earnings.
 *
 * Three tiers:
 *
 * Tier A — Scream qualifies (score ≥ 4, single clear bias):
 *   Strong enough for a directional debit trade.
 *
 * Tier B — Scream warns (score = 3, single clear bias) but below threshold:
 *   The bias must block opposite/neutral structures.
 *   With asymmetric risk: SKIP_ASYMMETRIC_DOWNSIDE_RISK or _UPSIDE_RISK.
 *   With high IV and manageable risk: CALL_CREDIT_SPREAD or PUT_CREDIT_SPREAD.
 *   With low IV: BEARISH_WATCH or BULLISH_WATCH — "monitor, don't trade."
 *
 * Tier C — Scream inconclusive (score < 3 or mixed bias):
 *   Use a 7-signal numeric tilt score.
 *   IRON_CONDOR requires trulyNeutral (no scream warn, no asymmetric risk,
 *   no unresolved risks, skew within ±8pts).
 *   Everything else that can't route → SKIP_NO_EDGE.
 */

import type { BeatScoreResult } from './beatScore';
import type { ScreamTestResult } from './screamTest';

export type FinalAction =
  // ── SKIP variants (granular reason surfaced to UI) ─────────────────────────
  | 'SKIP'                           // legacy / backward-compat for old DB rows
  | 'SKIP_NO_EDGE'                   // no signal, low IV, no qualifying path
  | 'SKIP_CONFLICT'                  // conflicting signals, direction unclear
  | 'SKIP_ASYMMETRIC_DOWNSIDE_RISK'  // extreme put skew + bearish pile-up
  | 'SKIP_ASYMMETRIC_UPSIDE_RISK'    // extreme call skew + bullish pile-up
  // ── WATCH (scream warns but trade bar not met) ─────────────────────────────
  | 'BEARISH_WATCH'                  // 3/5 bearish, no IV to sell, monitor
  | 'BULLISH_WATCH'                  // 3/5 bullish, no IV to sell, monitor
  // ── TRADE ─────────────────────────────────────────────────────────────────
  | 'PUT_DEBIT_SPREAD'
  | 'CALL_DEBIT_SPREAD'
  | 'LONG_CALL'
  | 'LONG_PUT'
  | 'PUT_CREDIT_SPREAD'
  | 'CALL_CREDIT_SPREAD'
  | 'IRON_CONDOR';

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
  /** From getNetInsiderBuying90d — negative = net selling, in millions. */
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
  const beatIsSkip      = beatScore.signal === 'SKIP';
  const unresolvedCount = scream.unresolvedOverhangs.length;
  const setupIsBearish  = scream.filters.setupConfirmation.direction === 'bearish';

  // putSkewPts: positive = puts richer = downside fear.
  const putSkewPts  = scream.putSkewPts ?? 0;
  const callSkewPts = -putSkewPts;              // positive = calls richer = upside demand

  // ── Bearish signal counts (feeds mediumPutSkewDownsideRisk) ──────────────
  const bearCountInFilters = Object.values(scream.filters)
    .filter(f => f.passed && f.direction === 'bearish').length;
  const bearishOverhangCount = unresolvedCount + bearCountInFilters;

  // ── Asymmetric downside risk ──────────────────────────────────────────────
  // Blocks both IRON_CONDOR and PUT_CREDIT_SPREAD in every tier.
  const extremePutSkew = putSkewPts >= 15;
  const strongPutSkew  = putSkewPts >= 10;

  const materialInsiderSelling = netInsiderBuying90d <= -5;   // ≤ −$5M
  const unresolvedRisky        = unresolvedCount >= 2;
  const weakEarningsHistory    = beatStreakScore <= 35;        // ≤ 1/4 beats

  const bearishScreamPressure =
    scream.directionalBias === 'bearish' || bearCountInFilters >= 2;

  // Extreme put skew (≥15) + any one bearish signal → block.
  const extremePutSkewDownsideRisk =
    extremePutSkew &&
    (materialInsiderSelling || unresolvedRisky || weakEarningsHistory);

  // Moderate put skew (≥10) + high IV + multiple bearish overhangs → block.
  const mediumPutSkewDownsideRisk =
    strongPutSkew &&
    ivRank >= 70 &&
    bearishOverhangCount >= 2;

  // Moderate put skew + scream pressure + any one bearish signal → also block.
  const mediumPutSkewScreamBlock =
    strongPutSkew &&
    bearishScreamPressure &&
    (materialInsiderSelling || unresolvedRisky || weakEarningsHistory);

  const asymmetricDownsideRisk =
    extremePutSkewDownsideRisk ||
    mediumPutSkewDownsideRisk ||
    mediumPutSkewScreamBlock;

  // ── Asymmetric upside risk (mirror) ───────────────────────────────────────
  // Blocks both IRON_CONDOR and CALL_CREDIT_SPREAD when upside is priced in.
  const extremeCallSkew = callSkewPts >= 15;
  const strongCallSkew  = callSkewPts >= 10;

  const strongBeatHistory   = beatStreakScore >= 75;
  const sectorTailwindStrong = sectorReturn5d >= 5;
  const insiderBuying        = netInsiderBuying90d >= 5; // ≥ +$5M

  // Count distinct bullish catalysts for medium-skew threshold.
  let positiveCatalystCount = 0;
  if (scream.filters.chainConviction.direction === 'bullish') positiveCatalystCount++;
  if (sectorTailwindStrong || scream.filters.sectorTailwind.direction === 'bullish')
    positiveCatalystCount++;
  if (strongBeatHistory)  positiveCatalystCount++;
  if (insiderBuying)      positiveCatalystCount++;

  // Extreme call skew (≥15) + any one bullish signal → block.
  const extremeCallSkewUpsideRisk =
    extremeCallSkew &&
    (insiderBuying || strongBeatHistory || sectorTailwindStrong || positiveCatalystCount >= 2);

  // Moderate call skew (≥10) + high IV + multiple bullish catalysts → block.
  const mediumCallSkewUpsideRisk =
    strongCallSkew && ivRank >= 70 && positiveCatalystCount >= 2;

  const asymmetricUpsideRisk =
    extremeCallSkewUpsideRisk || mediumCallSkewUpsideRisk;

  // ── Numeric tilt score (range ≈ −12 to +12) ──────────────────────────────
  // ≥ +3 = bullish, ≤ −3 = bearish, else mixed.
  let tiltScore = 0;

  // F1 — chain volume
  if (scream.filters.chainConviction.direction === 'bullish') tiltScore += 2;
  if (scream.filters.chainConviction.direction === 'bearish') tiltScore -= 2;

  // F2 — 25Δ IV skew (put skew = bearish pressure)
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
  if (netInsiderBuying90d <= -25)     tiltScore -= 2;
  else if (netInsiderBuying90d <= -5) tiltScore -= 1;
  else if (netInsiderBuying90d >= 5)  tiltScore += 1;

  // Unresolved narrative risks
  if (unresolvedCount >= 3)      tiltScore -= 2;
  else if (unresolvedCount >= 1) tiltScore -= 1;

  // Sector momentum
  if (sectorReturn5d >= 5)  tiltScore += 1;
  if (sectorReturn5d <= -5) tiltScore -= 1;

  const tilt: 'bullish' | 'bearish' | 'mixed' =
    tiltScore >= 3 ? 'bullish' : tiltScore <= -3 ? 'bearish' : 'mixed';

  // ── True neutrality — required for IRON_CONDOR ───────────────────────────
  // Iron condor means realized vol will stay inside wings with no directional
  // skew. Every condition below must hold — confusion is NOT neutrality.
  const trulyNeutral =
    tilt === 'mixed' &&
    !screamWarns &&               // any directional warn blocks condor
    !asymmetricDownsideRisk &&
    !asymmetricUpsideRisk &&
    unresolvedCount === 0 &&
    Math.abs(putSkewPts) < 8;     // market prices risk symmetrically

  // ─────────────────────────────────────────────────────────────────────────
  // TIER A — Scream qualifies directionally (score ≥ 4)
  // ─────────────────────────────────────────────────────────────────────────
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
          `call spread limits vega crush exposure.`,
      };
    }
    if (beatIsSkip) {
      return {
        final_action: 'SKIP_CONFLICT',
        rationale:
          `Scream qualifies bullish but beat score composite ${beatScore.composite} is SKIP — ` +
          `options signal is bullish but fundamentals lack edge.`,
      };
    }
    if (beatScore.signal === 'HIGH_CONVICTION') {
      return {
        final_action: 'LONG_CALL',
        rationale:
          `Scream qualifies bullish (${scream.score}/5) and beat score ${beatScore.composite} ` +
          `is HIGH_CONVICTION with IV rank ${ivRank} — vol is cheap, go directional.`,
      };
    }
    return {
      final_action: 'CALL_DEBIT_SPREAD',
      rationale:
        `Scream qualifies bullish (${scream.score}/5), beat score ${beatScore.composite} ` +
        `(${beatScore.signal}), IV rank ${ivRank} — call spread for edge with risk control.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TIER B — Scream warns (score = 3, clear single bias)
  // ─────────────────────────────────────────────────────────────────────────
  if (screamWarns) {
    if (scream.directionalBias === 'bearish') {
      if (asymmetricDownsideRisk) {
        return {
          final_action: 'SKIP_ASYMMETRIC_DOWNSIDE_RISK',
          rationale:
            `Scream warns bearish (${scream.score}/5, tilt ${tiltScore}). ` +
            `Asymmetric downside risk: put skew ${putSkewPts.toFixed(1)}pts` +
            (materialInsiderSelling
              ? `, insider net selling $${Math.abs(netInsiderBuying90d).toFixed(0)}M`
              : '') +
            (unresolvedRisky ? `, ${unresolvedCount} unresolved risks` : '') +
            (weakEarningsHistory
              ? `, weak beat history (streak score ${beatStreakScore})`
              : '') +
            `. Iron condor and put credit spread blocked — selling put exposure ` +
            `into a bearish skew risks blowing through the wing.`,
        };
      }
      if (ivRank > 70) {
        return {
          final_action: 'CALL_CREDIT_SPREAD',
          rationale:
            `Scream warns bearish (${scream.score}/5, tilt ${tiltScore}). Below the 4/5 ` +
            `directional bar but IV rank ${ivRank} is elevated — sell upside calls ` +
            `with defined risk. Iron condor blocked by bearish scream pressure.`,
        };
      }
      return {
        final_action: 'BEARISH_WATCH',
        rationale:
          `Scream warns bearish (${scream.score}/5) but IV rank ${ivRank} is not elevated ` +
          `enough to sell. No tradeable edge yet — monitor for a score upgrade or IV pop.`,
      };
    }

    // Bullish warns
    if (asymmetricUpsideRisk) {
      return {
        final_action: 'SKIP_ASYMMETRIC_UPSIDE_RISK',
        rationale:
          `Scream warns bullish (${scream.score}/5, tilt ${tiltScore}). ` +
          `Asymmetric upside risk: call skew ${callSkewPts.toFixed(1)}pts` +
          (insiderBuying
            ? `, insider buying $${netInsiderBuying90d.toFixed(0)}M`
            : '') +
          (strongBeatHistory ? `, strong beat history (${beatStreakScore})` : '') +
          (sectorTailwindStrong ? `, sector +${sectorReturn5d.toFixed(1)}%` : '') +
          `. Iron condor and call credit spread blocked — selling call exposure ` +
          `into a bullish squeeze risks blowing through the call wing.`,
      };
    }
    if (ivRank > 70) {
      return {
        final_action: 'PUT_CREDIT_SPREAD',
        rationale:
          `Scream warns bullish (${scream.score}/5, tilt ${tiltScore}). IV rank ` +
          `${ivRank} is elevated with no asymmetric upside risk — sell put credit spread.`,
      };
    }
    return {
      final_action: 'BULLISH_WATCH',
      rationale:
        `Scream warns bullish (${scream.score}/5) but IV rank ${ivRank} is not elevated ` +
        `enough to sell. No tradeable edge yet — monitor for a score upgrade or IV pop.`,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TIER C — Scream inconclusive (score < 3 or mixed bias)
  // ─────────────────────────────────────────────────────────────────────────
  if (ivRank <= 70) {
    return {
      final_action: 'SKIP_NO_EDGE',
      rationale:
        `Scream inconclusive (${scream.score}/5, ${scream.directionalBias}) ` +
        `and IV rank ${ivRank} is not elevated enough to sell vol. No edge.`,
    };
  }

  // High IV + inconclusive scream → use numeric tilt to pick a side.
  if (tilt === 'bearish') {
    if (beatIsSkip && beatStreakScore > 35) {
      return {
        final_action: 'SKIP_NO_EDGE',
        rationale:
          `Tilt score ${tiltScore} (bearish) but beat score ${beatScore.composite} is SKIP ` +
          `without a clear miss-frequency signal. No thesis for a directional trade.`,
      };
    }
    return {
      final_action: 'CALL_CREDIT_SPREAD',
      rationale:
        `Scream inconclusive (${scream.score}/5) but tilt score ${tiltScore} is bearish. ` +
        `IV rank ${ivRank} is elevated — sell upside calls. Put side excluded to avoid ` +
        `short put exposure on a bearish-tilted setup.`,
    };
  }

  if (tilt === 'bullish') {
    // Additional safety check: even a bullish tilt should not short put exposure
    // if there is an unresolved downside catalyst.
    const bigUnresolvedDrop = scream.unresolvedOverhangs.some(
      o => !o.resolved && o.drawdownPct != null && o.drawdownPct < -7,
    );
    if (bigUnresolvedDrop || setupIsBearish || beatIsSkip) {
      const reasons: string[] = [];
      if (bigUnresolvedDrop) {
        const worst = scream.unresolvedOverhangs
          .filter(o => !o.resolved && o.drawdownPct != null && o.drawdownPct < -7)
          .sort((a, b) => (a.drawdownPct ?? 0) - (b.drawdownPct ?? 0))[0];
        reasons.push(`unresolved ${worst?.drawdownPct?.toFixed(1)}% drawdown`);
      }
      if (setupIsBearish) reasons.push('bearish setup signals contradict bullish tilt');
      if (beatIsSkip)     reasons.push(`beat score ${beatScore.composite} is SKIP`);
      return {
        final_action: 'SKIP_CONFLICT',
        rationale:
          `Tilt score ${tiltScore} (bullish) but safety blockers prevent selling put ` +
          `exposure: ${reasons.join('; ')}.`,
      };
    }
    return {
      final_action: 'PUT_CREDIT_SPREAD',
      rationale:
        `Scream inconclusive (${scream.score}/5) but tilt score ${tiltScore} is bullish. ` +
        `IV rank ${ivRank} is elevated with clean downside — sell put credit spread.`,
    };
  }

  // Mixed tilt — iron condor only when setup is genuinely balanced.
  if (trulyNeutral) {
    return {
      final_action: 'IRON_CONDOR',
      rationale:
        `Scream inconclusive (${scream.score}/5, mixed), tilt score ${tiltScore} (balanced), ` +
        `no asymmetric risk, no unresolved risks, |skew| < 8pts. ` +
        `IV rank ${ivRank} — symmetric iron condor.`,
    };
  }

  return {
    final_action: 'SKIP_NO_EDGE',
    rationale:
      `Scream inconclusive (${scream.score}/5, ${scream.directionalBias}), ` +
      `tilt score ${tiltScore} (mixed). Conditions are not neutral enough for a symmetric ` +
      `iron condor (need: tilt=mixed, no scream warn, no asymmetric risk, ` +
      `0 unresolved risks, |skew| < 8pts).`,
  };
}
