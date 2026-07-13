/**
 * Quick assertions for discovery symbol / filter gating.
 * Run: npx tsx lib/__tests__/earningsDiscoveryFilter.test.ts
 */
import {
  isLikelyOtcticker,
  isNonCommonEquitySymbol,
  isPreferredShareName,
  isUsListedExchange,
  passesDiscoveryFilter,
  MIN_DISCOVERY_MARKET_CAP,
} from '../earningsDiscoveryFilter';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

for (const t of ['BAC-PK', 'BAC-PKPB', 'BAC-P', 'WFC-PL', 'GS.PRD', 'XYZ-WS', 'ABC.U', 'FOO-A-B']) {
  assert(isNonCommonEquitySymbol(t), `expected non-common: ${t}`);
}

for (const t of ['BAC', 'BRK.B', 'BF-B', 'GOOGL', 'AAPL', 'JPM']) {
  assert(!isNonCommonEquitySymbol(t), `expected common: ${t}`);
}

assert(isLikelyOtcticker('CWQXY'), 'CWQXY is OTC-like');
assert(!isLikelyOtcticker('BAC'), 'BAC not OTC-like');
assert(!isLikelyOtcticker('AAPL'), 'AAPL not OTC-like');

assert(isUsListedExchange('NYSE'), 'NYSE');
assert(isUsListedExchange('NASDAQ'), 'NASDAQ');
assert(!isUsListedExchange('OTCQX'), 'OTCQX');
assert(!isUsListedExchange('Stockholm'), 'Stockholm');

assert(isPreferredShareName('Bank of America Corp Preferred Shares Series K'), 'name preferred');
assert(!isPreferredShareName('Bank of America Corporation'), 'name common');

const bacOk = passesDiscoveryFilter({
  ticker: 'BAC',
  companyName: 'Bank of America Corporation',
  sector: 'Financial Services',
  industry: 'Banks',
  price: 40,
  marketCap: 300_000_000_000,
  exchange: 'NYSE',
});
assert(bacOk.ok, 'BAC should pass');

const cwqxy = passesDiscoveryFilter({
  ticker: 'CWQXY',
  companyName: 'Castellum AB (publ)',
  sector: 'Real Estate',
  industry: 'REIT',
  price: 20,
  marketCap: 6_100_000_000,
  exchange: 'OTC',
});
assert(!cwqxy.ok && cwqxy.reason === 'non_us_listed', 'CWQXY rejected');

const bacPref = passesDiscoveryFilter({
  ticker: 'BAC-PK',
  companyName: 'Bank of America Preferred Shares K',
  sector: 'Financial Services',
  industry: 'Banks',
  price: 25,
  marketCap: 300_000_000_000,
  exchange: 'NYSE',
});
assert(!bacPref.ok && bacPref.reason === 'non_common_equity', 'BAC-PK rejected');

const small = passesDiscoveryFilter({
  ticker: 'SMALL',
  companyName: 'Small Co',
  sector: 'Tech',
  industry: 'Software',
  price: 20,
  marketCap: MIN_DISCOVERY_MARKET_CAP - 1,
  exchange: 'NASDAQ',
});
assert(!small.ok && small.reason === 'small_cap', 'under $2B rejected');

console.log('earningsDiscoveryFilter.test.ts: ok');
