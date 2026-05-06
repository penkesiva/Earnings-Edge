/**
 * Test the engine locally on one ticker.
 * Run: pnpm tsx scripts/scan-local.ts NVDA
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import {
  getStockSnapshot,
  getOptionChain,
  getHistoricalBars,
  computeIvRank,
  computeExpectedMove,
} from '../lib/alpaca';
import {
  computeBeatStats,
  getNetRevisions30d,
  getNetInsiderBuying90d,
  getSectorEtf,
} from '../lib/fmp';
import { computeBeatScore } from '../lib/beatScore';
import { suggestStructure } from '../lib/structure';

const ticker = process.argv[2]?.toUpperCase() || 'NVDA';

async function main() {
  console.log(`\n▸ Scanning ${ticker}...\n`);

  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const fiveDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const nextFri = nextFridayAfter(today);

  const [snap, beatStats, revisions, insider, sectorEtf, chain, yearBars] =
    await Promise.all([
      getStockSnapshot(ticker),
      computeBeatStats(ticker, 4),
      getNetRevisions30d(ticker),
      getNetInsiderBuying90d(ticker),
      getSectorEtf(ticker),
      getOptionChain(ticker, nextFri),
      getHistoricalBars(ticker, yearAgo, today),
    ]);

  const sectorBars = await getHistoricalBars(sectorEtf, fiveDaysAgo, today);
  const sectorReturn5d = sectorBars.length >= 2
    ? ((sectorBars[sectorBars.length - 1].c - sectorBars[0].c) / sectorBars[0].c) * 100
    : 0;

  const expected = computeExpectedMove(chain);
  const ivHistory = computeRollingRealizedVol(yearBars, 30);
  const currentIv = chain.calls[Math.floor(chain.calls.length / 2)]?.iv ?? 0.3;
  const ivRank = computeIvRank(currentIv, ivHistory);

  const score = computeBeatScore({
    beatsLast4: beatStats.beatsLastN,
    totalQuarters: beatStats.totalQuarters,
    avgSurprisePct: beatStats.avgSurprisePct,
    netRevisions30d: revisions,
    netInsiderBuying90d: insider,
    ivRank,
    sectorReturn5d,
  });

  const structure = suggestStructure({
    spot: snap.price,
    ivRank,
    expectedMovePct: expected.pct,
    expectedMoveDollar: expected.dollar,
    composite: score.composite,
    signal: score.signal,
    preferredExpiry: chain.expiry,
  });

  console.log('─'.repeat(60));
  console.log(`${ticker}  $${snap.price.toFixed(2)}  (${snap.pctChange.toFixed(2)}%)`);
  console.log('─'.repeat(60));
  console.log(`SCORE: ${score.composite}  SIGNAL: ${score.signal}`);
  console.log('');
  console.log('COMPONENTS:');
  Object.entries(score.components).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(28)} ${v}`);
  });
  console.log('');
  console.log('OPTIONS:');
  console.log(`  IV (30d ATM):     ${(currentIv * 100).toFixed(1)}%`);
  console.log(`  IV Rank:          ${ivRank}`);
  console.log(`  Expected Move:    ±$${expected.dollar.toFixed(2)} (${expected.pct.toFixed(1)}%)`);
  console.log(`  ATM Call/Put:     $${expected.atmCall} / $${expected.atmPut}`);
  console.log('');
  console.log('REASONING:');
  score.reasoning.forEach(r => console.log(`  · ${r}`));
  console.log('');
  console.log('STRUCTURE:');
  console.log(`  Action:    ${structure.action}`);
  console.log(`  Rationale: ${structure.rationale}`);
  if (structure.legs) {
    structure.legs.forEach(l => {
      console.log(`  ${l.side} ${l.type} $${l.strike} ${l.expiry}`);
    });
  }
  console.log('─'.repeat(60));
}

function nextFridayAfter(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const daysUntilFri = day <= 5 ? 5 - day : 5 + 7 - day;
  d.setDate(d.getDate() + (daysUntilFri || 7));
  return d.toISOString().slice(0, 10);
}

function computeRollingRealizedVol(bars: any[], window: number): number[] {
  const result: number[] = [];
  for (let i = window; i < bars.length; i++) {
    const slice = bars.slice(i - window, i);
    const returns: number[] = [];
    for (let j = 1; j < slice.length; j++) {
      returns.push(Math.log(slice[j].c / slice[j - 1].c));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    result.push(Math.sqrt(variance) * Math.sqrt(252));
  }
  return result;
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
