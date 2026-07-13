/**
 * Quick assertions for discovery symbol / filter gating.
 * Run: npx tsx lib/__tests__/earningsDiscoveryFilter.test.ts
 */
import {
  isNonCommonEquitySymbol,
  isPreferredShareName,
  passesDiscoveryFilter,
  MIN_DISCOVERY_MARKET_CAP,
} from '../earningsDiscoveryFilter';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Preferred / structured — reject
for (const t of ['BAC-PK', 'BAC-PKPB', 'BAC-P', 'WFC-PL', 'GS.PRD', 'XYZ-WS', 'ABC.U', 'FOO-A-B']) {
  assert(isNonCommonEquitySymbol(t), `expected non-common: ${t}`);
}

// Common equity — keep
for (const t of ['BAC', 'BRK.B', 'BF-B', 'GOOGL', 'AAPL', 'JPM']) {
  assert(!isNonCommonEquitySymbol(t), `expected common: ${t}`);
}

assert(isPreferredShareName('Bank of America Corp Preferred Shares Series K'), 'name preferred');
assert(!isPreferredShareName('Bank of America Corporation'), 'name common');
assert(!isPreferredShareName('Prefabricated Home Builders Inc'), 'loose pref must not match');

const bacOk = passesDiscoveryFilter({
  ticker: 'BAC',
  companyName: 'Bank of America Corporation',
  sector: 'Financial Services',
  industry: 'Banks',
  price: 40,
  marketCap: 300_000_000_000,
});
assert(bacOk.ok, 'BAC should pass');

const bacPref = passesDiscoveryFilter({
  ticker: 'BAC-PK',
  companyName: 'Bank of America Preferred Shares K',
  sector: 'Financial Services',
  industry: 'Banks',
  price: 25,
  marketCap: 300_000_000_000,
});
assert(!bacPref.ok && bacPref.reason === 'non_common_equity', 'BAC-PK rejected');

const small = passesDiscoveryFilter({
  ticker: 'SMALL',
  companyName: 'Small Co',
  sector: 'Tech',
  industry: 'Software',
  price: 20,
  marketCap: MIN_DISCOVERY_MARKET_CAP - 1,
});
assert(!small.ok && small.reason === 'small_cap', 'under $5B rejected');

const missingCap = passesDiscoveryFilter({
  ticker: 'BAC',
  companyName: 'Bank of America Corporation',
  sector: null,
  industry: null,
  price: 40,
  marketCap: null,
});
assert(!missingCap.ok && missingCap.reason === 'missing_market_cap', 'missing cap');

console.log('earningsDiscoveryFilter.test.ts: ok');
