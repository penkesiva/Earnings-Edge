/**
 * Scream Test — 5-filter directional conviction scoring.
 *
 * Companion to beatScore.ts. While beatScore predicts whether a company will
 * beat estimates, screamTest decides whether the OPTIONS CHAIN is screaming
 * loud enough in one direction to justify a directional options trade.
 *
 * Score >= 4 of 5 = trade qualifies. Score < 4 = skip, stay in cash.
 *
 * Design principle: most earnings prints are not edges — they're noise.
 * The scream test is a high-bar filter that rejects ~80% of setups by design.
 */

export type Direction = 'bullish' | 'bearish' | 'mixed' | 'none';

/** Narrative / price-action risk bucket for Filter 4. */
export type OverhangCategory =
  | 'competitive'
  | 'sector_repricing'
  | 'downgrade'
  | 'guidance_concern'
  | 'customer_loss'
  | 'regulatory'
  | 'macro_specific';

export interface NarrativeOverhang {
  category: OverhangCategory;
  description: string;
  detectedDate: string;
  drawdownPct: number | null;
  resolved: boolean;
  source: string;
}

export interface ScreamTestInputs {
  ticker: string;
  spot: number;

  // Filter 1 — chain conviction (from Alpaca options snapshot)
  nearMoneyCallVol: number; // sum of call volume within ±5% of spot
  nearMoneyPutVol: number; // sum of put volume within ±5% of spot
  largestOiCluster: number; // single largest OI on either side
  largestOiSide: 'call' | 'put';

  // Filter 2 — IV skew (25-delta)
  iv25dCall: number | null; // e.g. 0.55 = 55% IV
  iv25dPut: number | null;

  // Filter 3 — beat history + Zacks ESP (from FMP)
  beatStreak: number; // consecutive quarterly beats
  totalQuartersTracked: number; // denominator for streak
  zacksEsp: number | null; // e.g. 0.0308 = +3.08%

  // Filter 4 — setup overhangs (structured + narrative + valuation)
  hasInsiderSellingCluster: boolean; // ≥2 insiders selling in past 60 days
  hasRegulatoryOverhang: boolean; // SEC probe, lawsuit, etc.
  ytdReturnPct: number; // e.g. 72.8 for COHR
  forwardPe: number | null;
  /** From FMP stable news + Alpaca bars (`detectOverhangs`). */
  narrativeOverhangs?: NarrativeOverhang[];

  // Filter 5 — sector tailwind
  peerEarningsReactionsPct: number[]; // e.g. [15.1, 2.5] from peer names
  sectorIndex5dReturnPct: number; // e.g. XLK past 5 days
}

export interface FilterResult {
  passed: boolean;
  direction: Direction;
  detail: string;
  /** Human-readable reasons when passed with bearish tilt (Filter 4, etc.). */
  triggers?: string[];
}

export interface ScreamTestResult {
  ticker: string;
  /**
   * Raw activity count — number of filters that produced any directional pass.
   * Does NOT equal directional conviction. Use bearishConfirmCount /
   * bullishConfirmCount for qualification logic.
   */
  score: number; // 0-5
  directionalBias: Direction; // dominant direction across passing filters
  /**
   * True only when same-direction confirmation count >= 4 AND the opposing
   * primary chain signal is not extreme. "4 active" is no longer sufficient
   * on its own — all 4 must point the same way (or at most 1 weak opposing).
   */
  qualifies: boolean;
  recommendation: 'calls' | 'puts' | 'skip' | 'stock-only';
  filters: {
    chainConviction: FilterResult;
    skewAlignment: FilterResult;
    beatHistory: FilterResult;
    setupConfirmation: FilterResult;
    sectorTailwind: FilterResult;
  };
  notes: string[];
  /** Unresolved narrative rows feeding Filter 4 bearish path (audit / UI). */
  unresolvedOverhangs: NarrativeOverhang[];
  /**
   * 25-delta put-call IV differential in vol points.
   * Positive = puts richer than calls (bearish skew / downside fear).
   * Negative = calls richer than puts (bullish skew / upside demand).
   * Zero when IV data is unavailable.
   */
  putSkewPts: number;

  // ── Directional confirmation breakdown ────────────────────────────────────
  /** Passing filters whose direction is bullish. */
  bullishConfirmCount: number;
  /** Passing filters whose direction is bearish. */
  bearishConfirmCount: number;
  /**
   * Opposing confirmation count relative to the dominant bias.
   * bearish candidate → bullishConfirmCount; bullish candidate → bearishConfirmCount.
   */
  opposingCount: number;
  /**
   * nearMoneyCallVol / nearMoneyPutVol. > 1 = calls heavier. Used for
   * opposing-signal strength classification (strong ≥ 5, extreme ≥ 10).
   */
  chainVolRatio: number;
  /**
   * True when F1 chain conviction OPPOSES the overall directionalBias AND
   * the opposing vol ratio is ≥ 5. Reduces qualification confidence.
   */
  primaryOpposingSignalStrong: boolean;
  /**
   * True when F1 chain conviction OPPOSES the overall directionalBias AND
   * the opposing vol ratio is ≥ 10. Hard blocker — forces SKIP_CONFLICT
   * regardless of other signals.
   */
  primaryOpposingSignalExtreme: boolean;
}

// --- Filter implementations ---

function filter1ChainConviction(i: ScreamTestInputs): FilterResult {
  const { nearMoneyCallVol: cv, nearMoneyPutVol: pv, largestOiCluster, largestOiSide } = i;

  if (cv === 0 && pv === 0) {
    return { passed: false, direction: 'none', detail: 'No volume data' };
  }

  // vol ratio: >1 = calls dominate, <1 = puts dominate
  const ratio = pv === 0 ? Infinity : cv / pv;

  // OI confirmation: only applied when OI data is actually present.
  // When all contracts show 0 OI (common in pre-earnings scans run early),
  // we treat OI as unavailable and gate solely on volume.
  const oiAvailable = largestOiCluster > 0;
  // If OI is present, require it to confirm the same directional side (any nonzero amount).
  const oiConfirmsCall = !oiAvailable || largestOiSide === 'call';
  const oiConfirmsPut  = !oiAvailable || largestOiSide === 'put';
  const oiLabel = oiAvailable ? `${largestOiCluster} OI` : 'OI n/a';

  if (ratio >= 3 && oiConfirmsCall) {
    return {
      passed: true,
      direction: 'bullish',
      detail: `Call vol ${ratio.toFixed(1)}x put vol; ${oiLabel} on calls`,
    };
  }
  if (ratio <= 1 / 3 && oiConfirmsPut) {
    return {
      passed: true,
      direction: 'bearish',
      detail: `Put vol ${(1 / ratio).toFixed(1)}x call vol; ${oiLabel} on puts`,
    };
  }

  const side = ratio >= 1 ? 'calls' : 'puts';
  // Express "how far from the 3x threshold" without using vague "slightly"
  const dominant = ratio >= 1 ? ratio : 1 / ratio;
  const thresholdGap = dominant < 1.5
    ? 'barely one-sided'
    : dominant < 2.0
      ? 'moderately one-sided'
      : 'below 3× threshold';
  return {
    passed: false,
    direction: 'mixed',
    detail: `Near-ATM vol ratio ${ratio.toFixed(2)}× (${side} ${thresholdGap}); ${oiLabel} — not one-sided enough`,
  };
}

function filter2SkewAlignment(i: ScreamTestInputs): FilterResult {
  const { iv25dCall, iv25dPut } = i;
  if (iv25dCall == null || iv25dPut == null) {
    return { passed: false, direction: 'none', detail: 'IV data unavailable' };
  }
  const skewPts = (iv25dCall - iv25dPut) * 100; // convert to vol points
  if (skewPts >= 2) {
    return {
      passed: true,
      direction: 'bullish',
      detail: `Call IV richer by ${skewPts.toFixed(1)} pts (call skew)`,
    };
  }
  if (skewPts <= -2) {
    return {
      passed: true,
      direction: 'bearish',
      detail: `Put IV richer by ${Math.abs(skewPts).toFixed(1)} pts (put skew)`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: `Skew ${skewPts.toFixed(1)} pts — within neutral band`,
  };
}

function filter3BeatHistory(i: ScreamTestInputs): FilterResult {
  const { beatStreak, totalQuartersTracked, zacksEsp } = i;
  const streakPct = totalQuartersTracked > 0 ? beatStreak / totalQuartersTracked : 0;
  const espBullish = zacksEsp != null && zacksEsp > 0;
  const espBearish = zacksEsp != null && zacksEsp < -0.02;

  const espStr = zacksEsp != null ? `ESP ${(zacksEsp * 100).toFixed(2)}%` : 'ESP n/a';
  // beatStreak counts consecutive beats from the most recent quarter backwards;
  // it resets to 0 on any miss. So beatStreak=0 means the most recent quarter
  // missed, NOT that every tracked quarter missed.
  const streakLabel =
    beatStreak === 0
      ? `no active beat streak (last ${totalQuartersTracked}Q tracked)`
      : `${beatStreak} consec. beat${beatStreak === 1 ? '' : 's'} (last ${totalQuartersTracked}Q tracked)`;

  // Bullish: 4+ consecutive beats at ≥75% strike rate.
  // Negative ESP overrides even a strong streak (analyst sees a miss coming).
  // No ESP = neutral on the forward estimate dimension — history still counts.
  if (beatStreak >= 4 && streakPct >= 0.75) {
    if (espBearish) {
      return {
        passed: true,
        direction: 'bearish',
        detail: `${streakLabel}; ${espStr} — negative ESP overrides streak`,
      };
    }
    return {
      passed: true,
      direction: 'bullish',
      detail: `${streakLabel}; ${espStr}`,
    };
  }
  // Bearish: streak is stale (2+ missed quarters in window) or negative ESP confirms
  if (totalQuartersTracked - beatStreak >= 2 || espBearish) {
    return {
      passed: true,
      direction: 'bearish',
      detail: `${streakLabel}; ${espStr}`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: `${streakLabel}; ${espStr}`,
  };
}

function filter4SetupConfirmation(i: ScreamTestInputs): FilterResult {
  const narrative = i.narrativeOverhangs ?? [];
  const unresolved = narrative.filter(n => !n.resolved);
  const narrativeBearish = unresolved.length > 0;

  const stretchedValuation =
    (i.forwardPe != null && i.forwardPe > 45) || i.ytdReturnPct > 60;
  const structuredOverhang =
    i.hasInsiderSellingCluster || i.hasRegulatoryOverhang;

  const triggers: string[] = [];
  for (const u of unresolved) {
    const dd =
      u.drawdownPct != null ? `, −${u.drawdownPct}% same window` : '';
    triggers.push(`${u.category.replace(/_/g, ' ')} (${u.detectedDate})${dd}`);
  }
  if (i.hasInsiderSellingCluster) triggers.push('Insider selling cluster (60d)');
  if (i.hasRegulatoryOverhang) triggers.push('Regulatory / legal overhang');
  if (stretchedValuation) {
    const peStr = i.forwardPe != null ? i.forwardPe.toFixed(1) : 'n/a';
    triggers.push(
      `Stretched valuation (YTD +${i.ytdReturnPct.toFixed(1)}%, fwd P/E ${peStr})`
    );
  }

  const bearishSignals =
    narrativeBearish || structuredOverhang || stretchedValuation;

  if (!bearishSignals) {
    return {
      passed: true,
      direction: 'bullish',
      detail:
        'Clean setup: no unresolved narrative risks, no insider/regulatory flags, valuation reasonable',
      triggers: [],
    };
  }

  return {
    passed: true,
    direction: 'bearish',
    detail: `Bearish setup: ${triggers.length} signal(s) — narrative, structural, and/or valuation`,
    triggers,
  };
}

function filter5SectorTailwind(i: ScreamTestInputs): FilterResult {
  const { peerEarningsReactionsPct: peers, sectorIndex5dReturnPct: idx } = i;
  if (peers.length === 0) {
    return { passed: false, direction: 'none', detail: 'No peer reactions to evaluate' };
  }
  const avgPeer = peers.reduce((a, b) => a + b, 0) / peers.length;

  if (avgPeer >= 5 && idx >= 2) {
    return {
      passed: true,
      direction: 'bullish',
      detail: `Peers avg +${avgPeer.toFixed(1)}%; sector +${idx.toFixed(1)}% past 5d`,
    };
  }
  if (avgPeer <= -5 && idx <= -2) {
    return {
      passed: true,
      direction: 'bearish',
      detail: `Peers avg ${avgPeer.toFixed(1)}%; sector ${idx.toFixed(1)}% past 5d`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: `Peers avg ${avgPeer.toFixed(1)}%, sector ${idx.toFixed(1)}% — no clear alignment`,
  };
}

// --- Main entry point ---

export function computeScreamTest(inputs: ScreamTestInputs): ScreamTestResult {
  const unresolvedOverhangs = (inputs.narrativeOverhangs ?? []).filter(n => !n.resolved);

  // 25Δ put-call skew in vol points. Positive = puts richer (bearish fear).
  const putSkewPts =
    inputs.iv25dCall != null && inputs.iv25dPut != null
      ? (inputs.iv25dPut - inputs.iv25dCall) * 100
      : 0;

  const filters = {
    chainConviction: filter1ChainConviction(inputs),
    skewAlignment: filter2SkewAlignment(inputs),
    beatHistory: filter3BeatHistory(inputs),
    setupConfirmation: filter4SetupConfirmation(inputs),
    sectorTailwind: filter5SectorTailwind(inputs),
  };

  const passing = Object.values(filters).filter(f => f.passed);
  const score = passing.length;

  // ── Directional breakdown ──────────────────────────────────────────────────
  const bullishConfirmCount = passing.filter(f => f.direction === 'bullish').length;
  const bearishConfirmCount = passing.filter(f => f.direction === 'bearish').length;

  // Dominant direction by simple majority (any imbalance wins — a 2:1 split at
  // score=3 is "warns" not "mixed"; the old ≥3 floor hid real pressure).
  let directionalBias: Direction = 'mixed';
  if (bullishConfirmCount > bearishConfirmCount) directionalBias = 'bullish';
  else if (bearishConfirmCount > bullishConfirmCount) directionalBias = 'bearish';
  else if (bullishConfirmCount === 0 && bearishConfirmCount === 0) directionalBias = 'none';
  // tie with confirmations on both sides → 'mixed' (default)

  const sameDirectionConfirmCount =
    directionalBias === 'bearish' ? bearishConfirmCount :
    directionalBias === 'bullish' ? bullishConfirmCount : 0;
  const opposingCount =
    directionalBias === 'bearish' ? bullishConfirmCount :
    directionalBias === 'bullish' ? bearishConfirmCount : 0;

  // ── F1 opposing signal strength ────────────────────────────────────────────
  // Chain vol ratio = callVol / putVol. > 1 = calls heavier.
  const chainVolRatio =
    inputs.nearMoneyPutVol === 0
      ? (inputs.nearMoneyCallVol > 0 ? Infinity : 1)
      : inputs.nearMoneyCallVol / inputs.nearMoneyPutVol;

  // Is F1 pointing OPPOSITE to the dominant bias?
  const f1OpposesCandidate =
    filters.chainConviction.passed &&
    filters.chainConviction.direction !== directionalBias &&
    filters.chainConviction.direction !== 'none' &&
    filters.chainConviction.direction !== 'mixed';

  // For bearish candidate: how heavily bullish is the opposing chain (callPutRatio)?
  // For bullish candidate: how heavily bearish is the opposing chain (putCallRatio)?
  const opposingChainRatio =
    directionalBias === 'bearish' ? chainVolRatio :
    directionalBias === 'bullish' ? (chainVolRatio > 0 ? 1 / chainVolRatio : 0) : 0;

  const primaryOpposingSignalStrong  = f1OpposesCandidate && opposingChainRatio >= 5;
  const primaryOpposingSignalExtreme = f1OpposesCandidate && opposingChainRatio >= 10;

  // ── Qualification rule ────────────────────────────────────────────────────
  // Must have ≥4 filters confirming the SAME direction. A passing filter that
  // points the opposite way does NOT count as a same-direction confirmation
  // (old system treated "4 active" as "4 directional" — that was the bug).
  //
  // Allowed exception: exactly 1 weak opposing filter that is NOT the primary
  // chain conviction signal (F5 sector going the other way is ignorable noise).
  const qualifies =
    sameDirectionConfirmCount >= 4 &&
    directionalBias !== 'mixed' &&
    directionalBias !== 'none' &&
    !primaryOpposingSignalExtreme &&
    (opposingCount === 0 || (opposingCount === 1 && !primaryOpposingSignalStrong));

  let recommendation: ScreamTestResult['recommendation'];
  if (!qualifies) {
    recommendation =
      sameDirectionConfirmCount >= 3 ? 'stock-only' : 'skip';
  } else if (directionalBias === 'bullish') {
    recommendation = 'calls';
  } else {
    recommendation = 'puts';
  }

  const notes: string[] = [];
  if (sameDirectionConfirmCount < 4 && score >= 4) {
    notes.push(
      `${score} filters active but only ${sameDirectionConfirmCount} confirm direction ` +
      `— ${opposingCount} opposing signal(s) prevent directional qualification`
    );
  } else if (score < 4) {
    notes.push('Below scream threshold — most prints are noise, default to no trade');
  }
  if (primaryOpposingSignalExtreme) {
    notes.push(
      `Extreme opposing chain signal: ${directionalBias === 'bearish'
        ? `call vol ${chainVolRatio.toFixed(1)}× put vol (bullish flow opposing bearish thesis)`
        : `put vol ${(1 / chainVolRatio).toFixed(1)}× call vol (bearish flow opposing bullish thesis)`
      }`
    );
  } else if (primaryOpposingSignalStrong) {
    notes.push(
      `Strong opposing chain signal detected (${directionalBias === 'bearish'
        ? `call vol ${chainVolRatio.toFixed(1)}× put vol`
        : `put vol ${(1 / chainVolRatio).toFixed(1)}× call vol`
      }) — reduces qualification confidence`
    );
  }
  if (directionalBias === 'mixed' && score >= 4) {
    notes.push('Filters pass but direction is split — chain is hedged, avoid directional options');
  }
  if (directionalBias === 'none' && score >= 4) {
    notes.push('Passing filters lack a directional cluster — no clear scream bias');
  }
  if (unresolvedOverhangs.length > 0) {
    notes.push(
      `${unresolvedOverhangs.length} unresolved narrative risk(s) in the lookback window`
    );
  }
  if (qualifies && score === 5) notes.push('Maximum conviction — rare setup, size accordingly');

  return {
    ticker: inputs.ticker,
    score,
    directionalBias,
    qualifies,
    recommendation,
    filters,
    notes,
    unresolvedOverhangs,
    putSkewPts,
    bullishConfirmCount,
    bearishConfirmCount,
    opposingCount,
    chainVolRatio,
    primaryOpposingSignalStrong,
    primaryOpposingSignalExtreme,
  };
}
