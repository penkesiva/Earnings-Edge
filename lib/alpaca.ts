/**
 * Alpaca Pro API client — handles prices, options chains, Greeks, IV.
 *
 * Docs: https://docs.alpaca.markets/reference/optionchain
 *
 * Alpaca Pro gives us:
 *  - Real-time stock quotes
 *  - Real-time options chains with Greeks + IV
 *  - Historical bars (used for IV rank computation)
 *  - Historical options data since Feb 2024
 */

const BASE = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

const HEADERS = {
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
};

// ----- Types -----
export type StockSnapshot = {
  ticker: string;
  price: number;
  prevClose: number;
  pctChange: number;
};

export type OptionContract = {
  symbol: string;
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest?: number;
  volume?: number;
};

export type OptionChain = {
  ticker: string;
  spot: number;
  expiry: string;
  calls: OptionContract[];
  puts: OptionContract[];
};

// ----- Helpers -----
async function fetchJson(url: string) {
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`Alpaca ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ----- Stock -----
export async function getStockSnapshot(ticker: string): Promise<StockSnapshot> {
  const data = await fetchJson(
    `${BASE}/v2/stocks/${ticker}/snapshot`
  );
  const price = data.latestTrade?.p ?? data.latestQuote?.ap ?? 0;
  const prevClose = data.prevDailyBar?.c ?? price;
  return {
    ticker,
    price,
    prevClose,
    pctChange: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
  };
}

export async function getHistoricalBars(
  ticker: string,
  start: string,
  end: string,
  timeframe = '1Day'
) {
  const url = `${BASE}/v2/stocks/${ticker}/bars?start=${start}&end=${end}&timeframe=${timeframe}&adjustment=split`;
  const data = await fetchJson(url);
  return data.bars || [];
}

// ----- Options -----
/**
 * Get options chain near-the-money for the closest expiry post-earnings.
 * We fetch a window around spot to keep payload small.
 */
export async function getOptionChain(
  ticker: string,
  expiryAfter: string,
  windowPct = 0.15
): Promise<OptionChain> {
  const snap = await getStockSnapshot(ticker);
  const spot = snap.price;

  // Filter strikes within ±15% of spot
  const minStrike = spot * (1 - windowPct);
  const maxStrike = spot * (1 + windowPct);

  // Alpaca's option chain endpoint
  const url = `${BASE}/v1beta1/options/snapshots/${ticker}?feed=indicative&expiration_date_gte=${expiryAfter}&strike_price_gte=${minStrike}&strike_price_lte=${maxStrike}`;
  const data = await fetchJson(url);

  const snapshots = data.snapshots || {};

  // First pass: collect all contracts and find the nearest available expiry
  type RawContract = OptionContract & { expiry: string };
  const allContracts: RawContract[] = [];

  for (const [symbol, snap] of Object.entries<any>(snapshots)) {
    const parsed = parseOccSymbol(symbol);
    if (!parsed) continue;

    const greeks = snap.greeks || {};
    const quote = snap.latestQuote || {};
    const bid = quote.bp ?? 0;
    const ask = quote.ap ?? 0;
    const day = snap.day || {};
    const vol =
      snap.daily_volume ??
      snap.dailyVolume ??
      day.volume ??
      day.v ??
      day.vw ??
      snap.prevDailyBar?.v ??
      0;
    // OI: try top-level camelCase, snake_case, and inside day object
    const oi =
      snap.openInterest ??
      snap.open_interest ??
      day.openInterest ??
      day.open_interest ??
      0;

    allContracts.push({
      symbol,
      strike: parsed.strike,
      expiry: parsed.expiry,
      type: parsed.type,
      bid,
      ask,
      mid: (bid + ask) / 2,
      iv: snap.implied_volatility ?? snap.impliedVolatility ?? 0,
      delta: greeks.delta ?? 0,
      gamma: greeks.gamma ?? 0,
      theta: greeks.theta ?? 0,
      vega: greeks.vega ?? 0,
      openInterest: typeof oi === 'number' ? oi : 0,
      volume: typeof vol === 'number' ? vol : 0,
    });
  }

  // Pick the nearest weekly expiry on or after expiryAfter and filter to it
  const expiries = [...new Set(allContracts.map(c => c.expiry))].sort();
  const nearestExpiry = expiries.find(e => e >= expiryAfter) ?? expiries[0] ?? expiryAfter;
  const filtered = allContracts.filter(c => c.expiry === nearestExpiry);

  const calls = filtered.filter(c => c.type === 'call').sort((a, b) => a.strike - b.strike);
  const puts  = filtered.filter(c => c.type === 'put').sort((a, b) => a.strike - b.strike);

  return { ticker, spot, expiry: nearestExpiry, calls, puts };
}

/**
 * Parse OCC symbol: AAPL250613C00200000 → expiry 2025-06-13, call, strike 200
 */
function parseOccSymbol(symbol: string) {
  const m = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yy, mm, dd, type, strikeStr] = m;
  return {
    expiry: `20${yy}-${mm}-${dd}`,
    type: (type === 'C' ? 'call' : 'put') as 'call' | 'put',
    strike: parseInt(strikeStr) / 1000,
  };
}

// ----- Derived metrics -----
/**
 * IV rank: where does current 30d IV sit in last 252 trading day range?
 * 100 = at 52-week high IV, 0 = at 52-week low IV.
 *
 * Approximation: we use ATM IV as proxy for 30d IV.
 */
export function computeIvRank(currentIv: number, ivHistory: number[]): number {
  if (ivHistory.length === 0) return 50;
  const min = Math.min(...ivHistory);
  const max = Math.max(...ivHistory);
  if (max === min) return 50;
  const raw = Math.round(((currentIv - min) / (max - min)) * 100);
  // Current IV can sit above the in-sample max (e.g. vol spike); keep 0–100 for UI/score.
  return Math.min(100, Math.max(0, raw));
}

/**
 * Expected move from straddle: (ATM call mid + ATM put mid) ≈ expected $ move
 */
export function computeExpectedMove(
  chain: OptionChain
): { dollar: number; pct: number; atmCall: number; atmPut: number } {
  const atmCall = chain.calls.reduce((closest, c) =>
    Math.abs(c.strike - chain.spot) < Math.abs(closest.strike - chain.spot) ? c : closest,
    chain.calls[0]
  );
  const atmPut = chain.puts.reduce((closest, p) =>
    Math.abs(p.strike - chain.spot) < Math.abs(closest.strike - chain.spot) ? p : closest,
    chain.puts[0]
  );

  const dollar = (atmCall?.mid ?? 0) + (atmPut?.mid ?? 0);
  const pct = chain.spot ? (dollar / chain.spot) * 100 : 0;
  return {
    dollar,
    pct,
    atmCall: atmCall?.strike ?? 0,
    atmPut: atmPut?.strike ?? 0,
  };
}

/**
 * Put/call ratio: total put volume / total call volume across the chain.
 */
export function computePutCallRatio(chain: OptionChain): number {
  const callVol = chain.calls.reduce((sum, c) => sum + (c.volume ?? 0), 0);
  const putVol = chain.puts.reduce((sum, p) => sum + (p.volume ?? 0), 0);
  if (callVol === 0) return 1;
  return putVol / callVol;
}
