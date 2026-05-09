/**
 * Regression tests for reconcileSignals.
 * Run with: npx tsx lib/__tests__/reconcile.regression.ts
 */

import { reconcileSignals, type FinalAction } from '../reconcile';
import type { BeatScoreResult } from '../beatScore';
import type { ScreamTestResult } from '../screamTest';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeBeat(
  composite: number,
  signal: BeatScoreResult['signal'],
  beatStreakScore = 50,
): BeatScoreResult {
  return {
    composite,
    signal,
    components: {
      beatStreakScore,
      surpriseMagnitudeScore: 50,
      revisionTrendScore: 50,
      whisperDeltaScore: 50,
      ivRankScore: 50,
      sectorMomentumScore: 50,
      insiderScore: 50,
    },
    reasoning: [],
  };
}

type FilterDir = 'bullish' | 'bearish' | 'mixed' | 'none';

function makeFilter(
  passed: boolean,
  direction: FilterDir = 'none',
): { passed: boolean; direction: FilterDir; detail: string; triggers?: string[] } {
  return { passed, direction, detail: '' };
}

/**
 * Build a ScreamTestResult for use in reconcile regression tests.
 *
 * Filters are built from the supplied directions:
 *  - chainDir   → F1 chain conviction
 *  - skewDir    → F2 IV skew (auto-computed from putSkewPts if omitted)
 *  - beatDir    → F3 beat history (default: fails / 'none')
 *  - setupDir   → F4 setup confirmation
 *  - sectorDir  → F5 sector tailwind
 *
 * All new ScreamTestResult fields (bullishConfirmCount, bearishConfirmCount,
 * primaryOpposingSignalExtreme, etc.) are derived from the constructed filters
 * and the chainVolRatio option — matching what computeScreamTest now produces.
 *
 * The `score` param is kept to allow explicit overrides for cases where the
 * helper's filter construction doesn't match the desired score (e.g. when
 * testing Tier B paths without all 4 filters).
 */
function makeScream(
  score: number,
  bias: FilterDir,
  putSkewPts: number,
  chainDir: FilterDir = 'none',
  setupDir: FilterDir = 'none',
  sectorDir: FilterDir = 'none',
  unresolvedCount = 0,
  opts: {
    chainVolRatio?: number;
    beatDir?: FilterDir;
    skewDirOverride?: FilterDir;
  } = {},
): ScreamTestResult {
  const unresolvedOverhangs = Array.from({ length: unresolvedCount }, (_, i) => ({
    id: `risk-${i}`,
    category: 'guidance_concern' as const,
    description: 'test risk',
    detectedDate: '2026-01-01',
    source: 'test',
    resolved: false,
    drawdownPct: -10,
  }));

  // Auto-derive skew direction from putSkewPts (mirrors computeScreamTest).
  const autoSkewDir: FilterDir =
    putSkewPts > 2 ? 'bearish' : putSkewPts < -2 ? 'bullish' : 'none';
  const skewDir = opts.skewDirOverride ?? autoSkewDir;
  const skewPasses = Math.abs(putSkewPts) > 5;

  // A filter passes whenever it has a real directional signal — regardless of
  // whether that direction matches the candidate bias. An opposing chain conviction
  // (e.g. call vol 22× for a bearish candidate) is still a PASSED filter; it just
  // contributes to bullishConfirmCount, not bearishConfirmCount. This mirrors
  // computeScreamTest where filter1 fires on volume ratio ≥ 3 in either direction.
  const chainPassed  = chainDir !== 'none' && chainDir !== 'mixed';
  const skewPassed   = skewPasses && skewDir !== 'none';
  const beatDir      = opts.beatDir ?? ('none' as FilterDir);
  const beatPassed   = beatDir !== 'none' && beatDir !== 'mixed';
  const setupPassed  = setupDir !== 'none' && setupDir !== 'mixed';
  const sectorPassed = sectorDir !== 'none' && sectorDir !== 'mixed';

  const filters = {
    chainConviction:   makeFilter(chainPassed,  chainDir),
    skewAlignment:     makeFilter(skewPassed,   skewDir),
    beatHistory:       makeFilter(beatPassed,   beatDir),
    setupConfirmation: makeFilter(setupPassed,  setupDir),
    sectorTailwind:    makeFilter(sectorPassed, sectorDir),
  };

  // Derive directional confirm counts from the actual filters built above.
  const allFilters = Object.values(filters);
  const bullishConfirmCount = allFilters.filter(f => f.passed && f.direction === 'bullish').length;
  const bearishConfirmCount = allFilters.filter(f => f.passed && f.direction === 'bearish').length;

  const sameDirectionConfirmCount =
    bias === 'bearish' ? bearishConfirmCount :
    bias === 'bullish' ? bullishConfirmCount : 0;
  const opposingCount =
    bias === 'bearish' ? bullishConfirmCount :
    bias === 'bullish' ? bearishConfirmCount : 0;

  // chainVolRatio = nearMoneyCallVol / nearMoneyPutVol.
  // Caller supplies this when testing opposing signal strength.
  const chainVolRatio = opts.chainVolRatio ?? 1;

  const f1OpposesCandidate =
    filters.chainConviction.passed &&
    filters.chainConviction.direction !== bias &&
    filters.chainConviction.direction !== 'none' &&
    filters.chainConviction.direction !== 'mixed';

  const opposingChainRatio =
    bias === 'bearish' ? chainVolRatio :
    bias === 'bullish' ? (chainVolRatio > 0 ? 1 / chainVolRatio : 0) : 0;

  const primaryOpposingSignalStrong  = f1OpposesCandidate && opposingChainRatio >= 5;
  const primaryOpposingSignalExtreme = f1OpposesCandidate && opposingChainRatio >= 10;

  // New qualification: requires ≥4 same-direction confirmations with no extreme opposing.
  const qualifies =
    sameDirectionConfirmCount >= 4 &&
    bias !== 'mixed' &&
    bias !== 'none' &&
    !primaryOpposingSignalExtreme &&
    (opposingCount === 0 || (opposingCount === 1 && !primaryOpposingSignalStrong));

  return {
    ticker: 'TEST',
    score,
    directionalBias: bias,
    qualifies,
    recommendation: 'skip',
    filters,
    notes: [],
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

const BASE_OPTS = {
  spot: 100,
  expectedMoveDollar: 5,
  preferredExpiry: '2026-06-20',
};

// ── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(
  name: string,
  actual: FinalAction,
  expected: FinalAction | FinalAction[],
) {
  const ok = Array.isArray(expected)
    ? expected.includes(actual)
    : actual === expected;

  if (ok) {
    console.log(`  ✓  ${name}  →  ${actual}`);
    passed++;
  } else {
    const exp = Array.isArray(expected) ? expected.join(' | ') : expected;
    console.error(`  ✗  ${name}`);
    console.error(`       expected: ${exp}`);
    console.error(`       got:      ${actual}`);
    failed++;
  }
}

// ── Cases ──────────────────────────────────────────────────────────────────

console.log('\nReconcile regression suite\n');

// ── Case 1: NET-style ──────────────────────────────────────────────────────
// IV 100, put skew 20, scream 3/5 bearish, heavy insider selling, 3 unresolved risks
// Expected: SKIP_ASYMMETRIC_DOWNSIDE_RISK (Tier B bearish path, extreme put skew blocks)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(40, 'SKIP', 30),
    scream:    makeScream(3, 'bearish', 20, 'none', 'none', 'none', 3),
    ivRank:    100,
    netInsiderBuying90d: -166.7,
    sectorReturn5d:      6.2,
  });
  assert('Case 1 — NET-style (heavy put skew + selling + risks)',
    result.final_action, 'SKIP_ASYMMETRIC_DOWNSIDE_RISK');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 2: True neutral vol ───────────────────────────────────────────────
// IV 90, put skew 2, scream 1/5 mixed, no unresolved risks
// Expected: IRON_CONDOR
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(55, 'SMALL_SPREAD', 55),
    scream:    makeScream(1, 'mixed', 2),
    ivRank:    90,
    netInsiderBuying90d: 0,
    sectorReturn5d:      0,
  });
  assert('Case 2 — True neutral vol (low skew, clean setup)',
    result.final_action, 'IRON_CONDOR');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 3a: Bearish warns, manageable → CALL_CREDIT_SPREAD ───────────────
// IV 85, put skew 6, scream warns, no blockers
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(50, 'SMALL_SPREAD', 50),
    scream:    makeScream(3, 'bearish', 6),
    ivRank:    85,
    netInsiderBuying90d: -2,
    sectorReturn5d:      1,
  });
  assert('Case 3a — Bearish warns, manageable (put skew 6, no blockers)',
    result.final_action, 'CALL_CREDIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 3b: Bearish warns, low IV → BEARISH_WATCH ────────────────────────
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(50, 'SMALL_SPREAD', 50),
    scream:    makeScream(3, 'bearish', 6),
    ivRank:    55,
    netInsiderBuying90d: 0,
    sectorReturn5d:      0,
  });
  assert('Case 3b — Bearish warns, low IV → BEARISH_WATCH',
    result.final_action, 'BEARISH_WATCH');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 4: Clean bearish 4/5 — scream QUALIFIES ──────────────────────────
// All 4 active filters confirm bearish (chain + skew + setup + sector).
// 0 opposing signals. Expected: PUT_DEBIT_SPREAD (Tier A)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(38, 'SKIP', 20),
    scream:    makeScream(4, 'bearish', 8, 'bearish', 'bearish', 'bearish'),
    ivRank:    65,
    netInsiderBuying90d: -8,
    sectorReturn5d:      0,
  });
  assert('Case 4 — Clean bearish 4/5 (4 same-direction, 0 opposing)',
    result.final_action, 'PUT_DEBIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 5: Clean bullish 4/5, high IV → CALL_DEBIT_SPREAD ────────────────
// All 4 active filters confirm bullish. IV 90. Expected: CALL_DEBIT_SPREAD (IV cap)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(80, 'HIGH_CONVICTION', 85),
    scream:    makeScream(4, 'bullish', -8, 'bullish', 'bullish', 'bullish'),
    ivRank:    90,
    netInsiderBuying90d: 10,
    sectorReturn5d:      4,
  });
  assert('Case 5 — Clean bullish 4/5, high IV → CALL_DEBIT_SPREAD',
    result.final_action, 'CALL_DEBIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 6: Upside squeeze risk ───────────────────────────────────────────
// IV 95, call skew 18 (putSkewPts = -18), positive revisions, sector tailwind
// Expected: SKIP_ASYMMETRIC_UPSIDE_RISK or CALL_DEBIT_SPREAD
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(75, 'DIRECTIONAL', 78),
    scream:    makeScream(3, 'bullish', -18, 'bullish', 'none', 'bullish'),
    ivRank:    95,
    netInsiderBuying90d: 15,
    sectorReturn5d:      6,
  });
  assert('Case 6 — Upside squeeze risk (extreme call skew + bullish catalysts)',
    result.final_action,
    ['SKIP_ASYMMETRIC_UPSIDE_RISK', 'CALL_DEBIT_SPREAD']);
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 7: Medium put skew + Tier B warns + blockers ─────────────────────
// putSkew 12, IV 80, 3 bearish-confirming filters (chain + skew + setup), 1 unresolved.
// scream warns (score 3 >= 3), not qualified (sameDir=3 < 4).
// Expected: SKIP_ASYMMETRIC_DOWNSIDE_RISK (mediumPutSkewDownsideRisk path in Tier B)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(50, 'SMALL_SPREAD', 50),
    scream:    makeScream(3, 'bearish', 12, 'bearish', 'bearish', 'none', 1),
    ivRank:    80,
    netInsiderBuying90d: 0,
    sectorReturn5d:      0,
  });
  assert('Case 7 — Medium put skew + many bearish warns (mediumPutSkewDownsideRisk)',
    result.final_action, 'SKIP_ASYMMETRIC_DOWNSIDE_RISK');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 8: CSCO-style ────────────────────────────────────────────────────
// High beat score + call-heavy chain + high IV → tilt bullish → PUT_CREDIT_SPREAD
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(78, 'HIGH_CONVICTION', 90),
    scream:    makeScream(2, 'mixed', 2, 'bullish'),
    ivRank:    95,
    netInsiderBuying90d: -4,
    sectorReturn5d:      4.8,
  });
  assert('Case 8 — CSCO-style (4/4 beats, call-heavy, high IV, low skew)',
    result.final_action, 'PUT_CREDIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 9: NBIS-style ────────────────────────────────────────────────────
// Extreme call skew (putSkewPts=-21 → callSkewPts=21 ≥ 15), bearish warns
// Expected: SKIP_CONFLICT (blockCallCreditSpread path in Tier B)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(38, 'SKIP', 10),
    scream:    makeScream(3, 'bearish', -21, 'none', 'bearish', 'none', 3),
    ivRank:    100,
    netInsiderBuying90d: -16,
    sectorReturn5d:      0,
  });
  assert('Case 9 — NBIS-style (extreme call skew + bearish warns = SKIP_CONFLICT)',
    result.final_action, 'SKIP_CONFLICT');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 10: HIMS-style conflict ──────────────────────────────────────────
// The key new case. F1 chain conviction is STRONGLY bullish (callVol 22× putVol)
// but F2/F4/F5 are bearish → 3 bearish confirms, 1 bullish opposing.
// primaryOpposingSignalExtreme=true (22 >= 10) → must force SKIP_CONFLICT.
// Old (broken) behaviour: "4 active = qualifies → PUT_DEBIT_SPREAD"
// New (correct) behaviour: directional edge is not clean → SKIP_CONFLICT
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(51, 'SMALL_SPREAD', 50),
    scream: makeScream(
      4,          // 4 filters active
      'bearish',
      23.3,       // F2: put IV richer by 23.3 pts (bearish)
      'bullish',  // F1: chain conviction — BULLISH OPPOSING
      'bearish',  // F4: setup/overhangs — bearish
      'bearish',  // F5: sector — bearish (3 bearish confirmations)
      1,          // 1 unresolved overhang
      { chainVolRatio: 22 }, // 22× call volume = extreme opposing primary signal
    ),
    ivRank:    81,
    netInsiderBuying90d: -5.2,  // insider selling $5.2M
    sectorReturn5d:      0,
  });
  assert('Case 10 — HIMS conflict (extreme opposing chain 22×, 3 bearish + 1 bullish)',
    result.final_action, 'SKIP_CONFLICT');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
  // Verify key scream properties
  const scream = makeScream(4, 'bearish', 23.3, 'bullish', 'bearish', 'bearish', 1, { chainVolRatio: 22 });
  console.log(`       scream fields: bearishConfirm=${scream.bearishConfirmCount} bullishConfirm=${scream.bullishConfirmCount} opposing=${scream.opposingCount} extreme=${scream.primaryOpposingSignalExtreme} qualifies=${scream.qualifies}`);
}

// ── Case 11: Bullish with extreme bearish chain opposition (mirror of HIMS) ─
// F1: chain bearish (putVol 12× callVol → chainVolRatio=1/12≈0.083)
// F2/F4/F5: bullish. 3 bullish confirms, 1 extreme bearish opposing.
// Expected: SKIP_CONFLICT
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(72, 'HIGH_CONVICTION', 85),
    scream: makeScream(
      4,
      'bullish',
      -15,       // F2: call skew 15pts (bullish)
      'bearish', // F1: chain — BEARISH OPPOSING
      'bullish', // F4: setup — bullish
      'bullish', // F5: sector — bullish
      0,
      { chainVolRatio: 1 / 12 }, // putVol 12× callVol = extreme opposing for bullish candidate
    ),
    ivRank:    85,
    netInsiderBuying90d: 8,
    sectorReturn5d:      5,
  });
  assert('Case 11 — Bullish with extreme bearish chain opposition (12× put vol)',
    result.final_action, 'SKIP_CONFLICT');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 12: Bearish with 1 weak opposing (F5 sector bullish) — still qualifies ─
// F1 chain bearish + F2 skew bearish + F3 beat bearish + F4 setup bearish = 4 same-dir.
// F5 sector bullish = 1 opposing, but NOT the primary chain signal (F1 is bearish).
// primaryOpposingSignalStrong=false (chain is confirming, not opposing).
// qualifies=true (4 same-dir, 1 weak opposing, !primaryOpposingSignalStrong).
// Expected: PUT_DEBIT_SPREAD (Tier A — qualified despite 1 non-primary opposing signal)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(40, 'SKIP', 25),
    scream: makeScream(
      5,         // 5 active (chain + skew + beat + setup + sector all pass)
      'bearish',
      10,        // F2 skew: bearish (putSkewPts=10)
      'bearish', // F1 chain: bearish (confirming, not opposing)
      'bearish', // F4 setup: bearish
      'bullish', // F5 sector: bullish (1 opposing, non-primary)
      0,
      { chainVolRatio: 0.2, beatDir: 'bearish' }, // F3 beat: bearish; chain is put-heavy (bearish)
    ),
    ivRank:    65,
    netInsiderBuying90d: -4,
    sectorReturn5d:      5,
  });
  assert('Case 12 — 4 bearish + 1 weak sector opposing (non-primary) → still qualifies',
    result.final_action, 'PUT_DEBIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
