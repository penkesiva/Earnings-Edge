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

  // Filter 4 — setup overhangs (manually flagged or from FMP/insider feed)
  hasInsiderSellingCluster: boolean; // ≥2 insiders selling in past 60 days
  hasRegulatoryOverhang: boolean; // SEC probe, lawsuit, etc.
  ytdReturnPct: number; // e.g. 72.8 for COHR
  forwardPe: number | null;

  // Filter 5 — sector tailwind
  peerEarningsReactionsPct: number[]; // e.g. [15.1, 2.5] from peer names
  sectorIndex5dReturnPct: number; // e.g. XLK past 5 days
}

export interface FilterResult {
  passed: boolean;
  direction: Direction;
  detail: string;
}

export interface ScreamTestResult {
  ticker: string;
  score: number; // 0-5
  directionalBias: Direction; // dominant direction across passing filters
  qualifies: boolean; // score >= 4 AND consistent direction
  recommendation: 'calls' | 'puts' | 'skip' | 'stock-only';
  filters: {
    chainConviction: FilterResult;
    skewAlignment: FilterResult;
    beatHistory: FilterResult;
    setupConfirmation: FilterResult;
    sectorTailwind: FilterResult;
  };
  notes: string[];
}

// --- Filter implementations ---

function filter1ChainConviction(i: ScreamTestInputs): FilterResult {
  const { nearMoneyCallVol: cv, nearMoneyPutVol: pv, largestOiCluster, largestOiSide } =
    i;
  if (cv === 0 && pv === 0) {
    return { passed: false, direction: 'none', detail: 'No volume data' };
  }
  const ratio = pv === 0 ? Infinity : cv / pv;
  const oiBig = largestOiCluster >= 5000;

  if (ratio >= 3 && oiBig && largestOiSide === 'call') {
    return {
      passed: true,
      direction: 'bullish',
      detail: `Call vol ${ratio.toFixed(1)}x put vol; ${largestOiCluster} call OI cluster`,
    };
  }
  if (ratio <= 1 / 3 && oiBig && largestOiSide === 'put') {
    return {
      passed: true,
      direction: 'bearish',
      detail: `Put vol ${(1 / ratio).toFixed(1)}x call vol; ${largestOiCluster} put OI cluster`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: `Vol ratio ${ratio.toFixed(2)}, largest OI ${largestOiCluster} on ${largestOiSide}s — not one-sided enough`,
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
  const stretchedValuation =
    (i.forwardPe != null && i.forwardPe > 45) || i.ytdReturnPct > 60;
  const overhangs = i.hasInsiderSellingCluster || i.hasRegulatoryOverhang;

  // Bullish setup: no overhangs, valuation reasonable
  if (!overhangs && !stretchedValuation) {
    return {
      passed: true,
      direction: 'bullish',
      detail: 'Clean setup: no insider selling, no regulatory issues, valuation reasonable',
    };
  }
  // Bearish setup: overhangs OR stretched valuation present
  if (overhangs || stretchedValuation) {
    const reasons: string[] = [];
    if (i.hasInsiderSellingCluster) reasons.push('insider selling');
    if (i.hasRegulatoryOverhang) reasons.push('regulatory overhang');
    if (stretchedValuation)
      reasons.push(`stretched (YTD +${i.ytdReturnPct.toFixed(1)}%, P/E ${i.forwardPe ?? '?'})`);
    return {
      passed: true,
      direction: 'bearish',
      detail: `Bearish overhangs: ${reasons.join(', ')}`,
    };
  }
  return {
    passed: false,
    direction: 'mixed',
    detail: 'Setup factors mixed',
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

  const qualifies = score >= 4 && directionalBias !== 'mixed';

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
  if (score === 5) notes.push('Maximum conviction — rare setup, size accordingly');

  return {
    ticker: inputs.ticker,
    score,
    directionalBias,
    qualifies,
    recommendation,
    filters,
    notes,
  };
}
