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

function makeScream(
  score: number,
  bias: FilterDir,
  putSkewPts: number,
  chainDir: FilterDir = 'none',
  setupDir: FilterDir = 'none',
  sectorDir: FilterDir = 'none',
  unresolvedCount = 0,
): ScreamTestResult {
  const unresolvedOverhangs = Array.from({ length: unresolvedCount }, (_, i) => ({
    id: `risk-${i}`,
    category: 'drawdown' as const,
    summary: 'test risk',
    resolved: false,
    drawdownPct: -10,
  }));

  const chainPassed   = chainDir !== 'none' && chainDir === bias;
  const sectorPassed  = sectorDir !== 'none' && sectorDir === bias;
  const setupPassed   = setupDir !== 'none' && setupDir === bias;
  const skewDirection: FilterDir = putSkewPts > 2 ? 'bearish' : putSkewPts < -2 ? 'bullish' : 'none';

  return {
    ticker: 'TEST',
    score,
    directionalBias: bias,
    qualifies: score >= 4 && bias !== 'mixed' && bias !== 'none',
    recommendation: 'skip',
    filters: {
      chainConviction:   makeFilter(chainPassed,  chainDir),
      skewAlignment:     makeFilter(Math.abs(putSkewPts) > 5, skewDirection),
      beatHistory:       makeFilter(false, 'none'),
      setupConfirmation: makeFilter(setupPassed,  setupDir),
      sectorTailwind:    makeFilter(sectorPassed, sectorDir),
    },
    notes: [],
    unresolvedOverhangs,
    putSkewPts,
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
// Expected: SKIP_ASYMMETRIC_DOWNSIDE_RISK
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(40, 'SKIP', 30),
    scream:    makeScream(3, 'bearish', 20, 'none', 'none', 'none', 3),
    ivRank:    100,
    netInsiderBuying90d: -166.7,   // $166.7M net selling
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

// ── Case 3a: Bearish but manageable — expect CALL_CREDIT_SPREAD ───────────
// IV 85, put skew 6, scream 3/5 bearish, no heavy insider selling, no unresolved risks
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(50, 'SMALL_SPREAD', 50),
    scream:    makeScream(3, 'bearish', 6),
    ivRank:    85,
    netInsiderBuying90d: -2,      // light selling, < $5M threshold
    sectorReturn5d:      1,
  });
  assert('Case 3 — Bearish warns, manageable (put skew 6, no blockers)',
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

// ── Case 4: Strong bearish directional ────────────────────────────────────
// IV 65, scream 4/5 bearish, put skew 8, weak history
// Expected: PUT_DEBIT_SPREAD
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(38, 'SKIP', 20),
    scream:    makeScream(4, 'bearish', 8),
    ivRank:    65,
    netInsiderBuying90d: -8,
    sectorReturn5d:      0,
  });
  assert('Case 4 — Strong bearish directional (scream 4/5)',
    result.final_action, 'PUT_DEBIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 5: Bullish high-IV ────────────────────────────────────────────────
// IV 90, scream 4/5 bullish, call skew 8, strong beat history
// Expected: CALL_DEBIT_SPREAD (IV > 70 caps debit spread even with scream qualifying)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(80, 'HIGH_CONVICTION', 85),
    scream:    makeScream(4, 'bullish', -8, 'bullish'),
    ivRank:    90,
    netInsiderBuying90d: 10,
    sectorReturn5d:      4,
  });
  assert('Case 5 — Bullish high-IV (scream 4/5, IV 90)',
    result.final_action, 'CALL_DEBIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 6: Upside squeeze risk ───────────────────────────────────────────
// IV 95, call skew 18 (putSkewPts = -18), positive revisions, strong sector, scream 3/5 bullish
// Expected: SKIP_ASYMMETRIC_UPSIDE_RISK or CALL_DEBIT_SPREAD — NOT IRON_CONDOR
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(75, 'DIRECTIONAL', 78),
    scream:    makeScream(3, 'bullish', -18, 'bullish', 'none', 'bullish'),
    ivRank:    95,
    netInsiderBuying90d: 15,       // insider buying
    sectorReturn5d:      6,        // sector tailwind
  });
  assert('Case 6 — Upside squeeze risk (extreme call skew + bullish catalysts)',
    result.final_action,
    ['SKIP_ASYMMETRIC_UPSIDE_RISK', 'CALL_DEBIT_SPREAD']);
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 7: Medium put skew + high IV + multiple bearish signals ──────────
// putSkew 12, IV 80, 3 bearish-passing filters + 1 unresolved risk
// Expected: SKIP_ASYMMETRIC_DOWNSIDE_RISK (mediumPutSkewDownsideRisk path)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(50, 'SMALL_SPREAD', 50),
    scream:    makeScream(3, 'bearish', 12, 'bearish', 'bearish', 'bearish', 1),
    ivRank:    80,
    netInsiderBuying90d: 0,
    sectorReturn5d:      0,
  });
  assert('Case 7 — Medium put skew + high IV + many bearish filters (mediumPutSkewDownsideRisk)',
    result.final_action, 'SKIP_ASYMMETRIC_DOWNSIDE_RISK');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Case 8: CSCO-style — 4/4 beats, call-heavy chain, high IV ────────────
// Expected: PUT_CREDIT_SPREAD (tilt bullish from beat history + chain)
{
  const result = reconcileSignals({
    ...BASE_OPTS,
    beatScore: makeBeat(78, 'HIGH_CONVICTION', 90),
    scream:    makeScream(2, 'mixed', 2, 'bullish'),
    ivRank:    95,
    netInsiderBuying90d: -4,      // light selling, below threshold
    sectorReturn5d:      4.8,
  });
  assert('Case 8 — CSCO-style (4/4 beats, call-heavy, high IV, low skew)',
    result.final_action, 'PUT_CREDIT_SPREAD');
  console.log(`       rationale: ${result.rationale.slice(0, 120)}…`);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
