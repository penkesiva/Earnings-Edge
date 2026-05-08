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
  score: number; // 0-5
  directionalBias: Direction; // dominant direction across passing filters
  qualifies: boolean; // score >= 4 AND consistent direction (not mixed/none)
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
  return {
    passed: false,
    direction: 'mixed',
    detail: `Vol ratio ${ratio.toFixed(2)} (${side} slightly heavier); ${oiLabel} — not one-sided enough`,
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

  // Bullish: 4+/4 streak AND positive ESP
  if (beatStreak >= 4 && streakPct >= 1.0 && espBullish) {
    return {
      passed: true,
      direction: 'bullish',
      detail: `${beatStreak}/${totalQuartersTracked} streak + ESP +${(zacksEsp! * 100).toFixed(2)}%`,
    };
  }
  // Bearish: 2+ recent misses or negative ESP
  if (totalQuartersTracked - beatStreak >= 2 || espBearish) {
    return {
      passed: true,
      direction: 'bearish',
      detail: `${totalQuartersTracked - beatStreak} misses in last ${totalQuartersTracked}; ESP ${zacksEsp != null ? `${(zacksEsp * 100).toFixed(2)}%` : 'n/a'}`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: `Streak ${beatStreak}/${totalQuartersTracked}, ESP ${zacksEsp != null ? `${(zacksEsp * 100).toFixed(2)}%` : 'n/a'}`,
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
    triggers.push(
      `Stretched valuation (YTD +${i.ytdReturnPct.toFixed(1)}%, fwd P/E ${i.forwardPe ?? 'n/a'})`
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

  const filters = {
    chainConviction: filter1ChainConviction(inputs),
    skewAlignment: filter2SkewAlignment(inputs),
    beatHistory: filter3BeatHistory(inputs),
    setupConfirmation: filter4SetupConfirmation(inputs),
    sectorTailwind: filter5SectorTailwind(inputs),
  };

  const passing = Object.values(filters).filter(f => f.passed);
  const score = passing.length;

  // Determine dominant direction among passing filters
  const dirs = passing.map(f => f.direction);
  const bullCount = dirs.filter(d => d === 'bullish').length;
  const bearCount = dirs.filter(d => d === 'bearish').length;

  let directionalBias: Direction = 'mixed';
  if (bullCount > bearCount && bullCount >= 3) directionalBias = 'bullish';
  else if (bearCount > bullCount && bearCount >= 3) directionalBias = 'bearish';
  else if (bullCount === 0 && bearCount === 0) directionalBias = 'none';

  const qualifies =
    score >= 4 &&
    directionalBias !== 'mixed' &&
    directionalBias !== 'none';

  let recommendation: ScreamTestResult['recommendation'];
  if (!qualifies) {
    recommendation = score >= 3 ? 'stock-only' : 'skip';
  } else if (directionalBias === 'bullish') {
    recommendation = 'calls';
  } else {
    recommendation = 'puts';
  }

  const notes: string[] = [];
  if (score < 4)
    notes.push('Below scream threshold — most prints are noise, default to no trade');
  if (directionalBias === 'mixed' && score >= 4) {
    notes.push('Filters pass but direction is split — chain is hedged, avoid directional options');
  }
  if (directionalBias === 'none' && score >= 4) {
    notes.push('Passing filters lack a 3+ directional cluster — no clear scream bias');
  }
  if (unresolvedOverhangs.length > 0) {
    notes.push(
      `${unresolvedOverhangs.length} unresolved narrative risk(s) in the lookback window`
    );
  }
  if (score === 5) notes.push('Maximum conviction — rare setup, size accordingly');

  return {
    ticker: inputs.ticker,
    score,
    directionalBias,
    qualifies,
    recommendation,
    filters,
    notes,
    unresolvedOverhangs,
  };
}
