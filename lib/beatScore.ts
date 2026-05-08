/**
 * Beat score: composite 0-100 score predicting earnings beat likelihood.
 *
 * Each sub-score is normalized 0-100, then weighted. All weights tunable.
 * After ~10-15 logged outcomes, run /api/calibrate to tune.
 */

export type BeatScoreInputs = {
  // From FMP
  beatsLast4: number;          // 0-4
  totalQuarters: number;       // typically 4
  avgSurprisePct: number;      // can be negative
  netRevisions30d: number;     // upgrades - downgrades
  netInsiderBuying90d: number; // millions of dollars, signed

  // Whisper (optional, manually entered for v1)
  whisperEps?: number;
  consensusEps?: number;

  // From Alpaca
  ivRank: number;              // 0-100
  sectorReturn5d: number;      // pct, signed
};

export type BeatScoreResult = {
  composite: number;
  components: {
    beatStreakScore: number;
    surpriseMagnitudeScore: number;
    revisionTrendScore: number;
    whisperDeltaScore: number;
    ivRankScore: number;
    sectorMomentumScore: number;
    insiderScore: number;
  };
  signal: 'SKIP' | 'SMALL_SPREAD' | 'DIRECTIONAL' | 'HIGH_CONVICTION';
  reasoning: string[];
};

// Weights — TUNE THESE after logging outcomes
const WEIGHTS = {
  beatStreak: 0.20,
  surpriseMagnitude: 0.15,
  revisionTrend: 0.20,
  whisperDelta: 0.15,
  ivRank: 0.10,         // inverted (high IV = priced in)
  sectorMomentum: 0.10,
  insider: 0.10,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function computeBeatScore(inputs: BeatScoreInputs): BeatScoreResult {
  const reasoning: string[] = [];

  // 1. Beat streak: 4-of-4 = 100, 0-of-4 = 0
  const beatStreakScore =
    inputs.totalQuarters > 0
      ? (inputs.beatsLast4 / inputs.totalQuarters) * 100
      : 50;
  if (beatStreakScore >= 75) reasoning.push(`Beat frequency: ${inputs.beatsLast4}/${inputs.totalQuarters} (last ${inputs.totalQuarters}Q)`);
  if (beatStreakScore <= 25) reasoning.push(`Weak beat history: ${inputs.beatsLast4}/${inputs.totalQuarters} (last ${inputs.totalQuarters}Q)`);

  // 2. Surprise magnitude: avg 20%+ → 100; negative → low
  const surpriseMagnitudeScore = clamp(50 + inputs.avgSurprisePct * 2.5, 0, 100);
  if (inputs.avgSurprisePct >= 10) reasoning.push(`Avg surprise +${inputs.avgSurprisePct.toFixed(1)}%`);
  if (inputs.avgSurprisePct < 0) reasoning.push(`Avg surprise NEGATIVE ${inputs.avgSurprisePct.toFixed(1)}%`);

  // 3. Revisions: each net upgrade = +10, neutral = 50
  const revisionScore = clamp(50 + inputs.netRevisions30d * 10, 0, 100);
  if (inputs.netRevisions30d >= 2) reasoning.push(`+${inputs.netRevisions30d} net upgrades 30d`);
  if (inputs.netRevisions30d <= -2) reasoning.push(`${inputs.netRevisions30d} net downgrades 30d`);

  // 4. Whisper vs consensus
  let whisperDeltaScore = 50;
  if (inputs.whisperEps && inputs.consensusEps && inputs.consensusEps !== 0) {
    const deltaPct =
      ((inputs.whisperEps - inputs.consensusEps) / Math.abs(inputs.consensusEps)) * 100;
    whisperDeltaScore = clamp(50 + deltaPct * 5, 0, 100);
    if (deltaPct >= 3) reasoning.push(`Whisper > consensus by ${deltaPct.toFixed(1)}%`);
    if (deltaPct <= -3) reasoning.push(`Whisper < consensus by ${deltaPct.toFixed(1)}%`);
  }

  // 5. IV rank (inverted): low IV = good entry, high IV = priced in
  const ivRankScore = 100 - inputs.ivRank;
  if (inputs.ivRank >= 75) reasoning.push(`IV rank ${inputs.ivRank} — priced in`);
  if (inputs.ivRank <= 30) reasoning.push(`IV rank ${inputs.ivRank} — cheap vol`);

  // 6. Sector momentum: each 1% return = 10 points
  const sectorScore = clamp(50 + inputs.sectorReturn5d * 10, 0, 100);
  if (inputs.sectorReturn5d >= 3) reasoning.push(`Sector +${inputs.sectorReturn5d.toFixed(1)}% 5d`);
  if (inputs.sectorReturn5d <= -3) reasoning.push(`Sector ${inputs.sectorReturn5d.toFixed(1)}% 5d`);

  // 7. Insider buying: $5M+ = bullish
  const insiderScore = clamp(50 + inputs.netInsiderBuying90d * 5, 0, 100);
  if (inputs.netInsiderBuying90d >= 1) reasoning.push(`Insider buying $${inputs.netInsiderBuying90d.toFixed(1)}M`);
  if (inputs.netInsiderBuying90d <= -5) reasoning.push(`Insider selling $${Math.abs(inputs.netInsiderBuying90d).toFixed(1)}M`);

  // Composite
  const composite = Math.round(
    beatStreakScore * WEIGHTS.beatStreak +
      surpriseMagnitudeScore * WEIGHTS.surpriseMagnitude +
      revisionScore * WEIGHTS.revisionTrend +
      whisperDeltaScore * WEIGHTS.whisperDelta +
      ivRankScore * WEIGHTS.ivRank +
      sectorScore * WEIGHTS.sectorMomentum +
      insiderScore * WEIGHTS.insider
  );

  // Signal
  const signal: BeatScoreResult['signal'] =
    composite < 40
      ? 'SKIP'
      : composite < 65
      ? 'SMALL_SPREAD'
      : composite < 85
      ? 'DIRECTIONAL'
      : 'HIGH_CONVICTION';

  return {
    composite,
    components: {
      beatStreakScore: Math.round(beatStreakScore),
      surpriseMagnitudeScore: Math.round(surpriseMagnitudeScore),
      revisionTrendScore: Math.round(revisionScore),
      whisperDeltaScore: Math.round(whisperDeltaScore),
      ivRankScore: Math.round(ivRankScore),
      sectorMomentumScore: Math.round(sectorScore),
      insiderScore: Math.round(insiderScore),
    },
    signal,
    reasoning,
  };
}
