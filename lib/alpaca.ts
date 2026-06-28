/**
 * Alpaca Pro API client — handles prices, options chains, Greeks, IV.
 *
 * Docs: https://docs.alpaca.markets/reference/optionchain
 *
 * Credentials: per-user keys from Settings, or ALPACA_* env fallback.
 */

export type AlpacaEnvironment = 'paper' | 'live';

export type AlpacaAuth = {
  keyId: string;
  secret: string;
  dataBaseUrl?: string;
  tradingBaseUrl?: string;
  environment?: AlpacaEnvironment;
};

const DEFAULT_DATA_BASE = process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets';

function envAuth(): AlpacaAuth | null {
  const keyId = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_API_SECRET?.trim();
  if (!keyId || !secret) return null;
  return { keyId, secret, dataBaseUrl: DEFAULT_DATA_BASE, environment: 'paper' };
}

function resolveAuth(auth?: AlpacaAuth | null): AlpacaAuth {
  const resolved = auth ?? envAuth();
  if (!resolved?.keyId || !resolved.secret) {
    throw new Error(
      'Alpaca is not configured — add Paper or Live keys in Settings, or set ALPACA_API_KEY on the server.',
    );
  }
  return {
    ...resolved,
    dataBaseUrl: resolved.dataBaseUrl || DEFAULT_DATA_BASE,
  };
}

function authHeaders(auth: AlpacaAuth): Record<string, string> {
  return {
    'APCA-API-KEY-ID': auth.keyId.trim(),
    'APCA-API-SECRET-KEY': auth.secret.trim(),
  };
}

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
async function fetchJson(url: string, auth: AlpacaAuth) {
  const res = await fetch(url, { headers: authHeaders(auth), next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(`Alpaca ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ----- Stock -----
export async function getStockSnapshot(
  ticker: string,
  auth?: AlpacaAuth | null,
): Promise<StockSnapshot> {
  const a = resolveAuth(auth);
  const data = await fetchJson(`${a.dataBaseUrl}/v2/stocks/${ticker}/snapshot`, a);
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
  timeframe = '1Day',
  auth?: AlpacaAuth | null,
) {
  const a = resolveAuth(auth);
  const url = `${a.dataBaseUrl}/v2/stocks/${ticker}/bars?start=${start}&end=${end}&timeframe=${timeframe}&adjustment=split`;
  const data = await fetchJson(url, a);
  return data.bars || [];
}

// ----- Options -----
export async function getOptionChain(
  ticker: string,
  expiryAfter: string,
  windowPct = 0.15,
  auth?: AlpacaAuth | null,
): Promise<OptionChain> {
  const a = resolveAuth(auth);
  const snap = await getStockSnapshot(ticker, a);
  const spot = snap.price;

  const minStrike = spot * (1 - windowPct);
  const maxStrike = spot * (1 - windowPct + 2 * windowPct);

  const url = `${a.dataBaseUrl}/v1beta1/options/snapshots/${ticker}?feed=indicative&expiration_date_gte=${expiryAfter}&strike_price_gte=${minStrike}&strike_price_lte=${maxStrike}`;
  const data = await fetchJson(url, a);

  const snapshots = data.snapshots || {};

  type RawContract = OptionContract & { expiry: string };
  const allContracts: RawContract[] = [];

  for (const [symbol, snapRow] of Object.entries<any>(snapshots)) {
    const parsed = parseOccSymbol(symbol);
    if (!parsed) continue;

    const greeks = snapRow.greeks || {};
    const quote = snapRow.latestQuote || {};
    const bid = quote.bp ?? 0;
    const ask = quote.ap ?? 0;
    const day = snapRow.day || {};
    const vol =
      snapRow.daily_volume ??
      snapRow.dailyVolume ??
      day.volume ??
      day.v ??
      day.vw ??
      snapRow.prevDailyBar?.v ??
      0;
    const oi =
      snapRow.openInterest ??
      snapRow.open_interest ??
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
      iv: snapRow.implied_volatility ?? snapRow.impliedVolatility ?? 0,
      delta: greeks.delta ?? 0,
      gamma: greeks.gamma ?? 0,
      theta: greeks.theta ?? 0,
      vega: greeks.vega ?? 0,
      openInterest: typeof oi === 'number' ? oi : 0,
      volume: typeof vol === 'number' ? vol : 0,
    });
  }

  const expiries = [...new Set(allContracts.map(c => c.expiry))].sort();
  const nearestExpiry = expiries.find(e => e >= expiryAfter) ?? expiries[0] ?? expiryAfter;
  const filtered = allContracts.filter(c => c.expiry === nearestExpiry);

  const calls = filtered.filter(c => c.type === 'call').sort((a, b) => a.strike - b.strike);
  const puts = filtered.filter(c => c.type === 'put').sort((a, b) => a.strike - b.strike);

  return { ticker, spot, expiry: nearestExpiry, calls, puts };
}

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

export function computeIvRank(currentIv: number, ivHistory: number[]): number {
  if (ivHistory.length === 0) return 50;
  const min = Math.min(...ivHistory);
  const max = Math.max(...ivHistory);
  if (max === min) return 50;
  const raw = Math.round(((currentIv - min) / (max - min)) * 100);
  return Math.min(100, Math.max(0, raw));
}

export function computeExpectedMove(
  chain: OptionChain,
): { dollar: number; pct: number; atmCall: number; atmPut: number } {
  const atmCall = chain.calls.reduce(
    (closest, c) =>
      Math.abs(c.strike - chain.spot) < Math.abs(closest.strike - chain.spot) ? c : closest,
    chain.calls[0],
  );
  const atmPut = chain.puts.reduce(
    (closest, p) =>
      Math.abs(p.strike - chain.spot) < Math.abs(closest.strike - chain.spot) ? p : closest,
    chain.puts[0],
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

export function computePutCallRatio(chain: OptionChain): number {
  const callVol = chain.calls.reduce((sum, c) => sum + (c.volume ?? 0), 0);
  const putVol = chain.puts.reduce((sum, p) => sum + (p.volume ?? 0), 0);
  if (callVol === 0) return 1;
  return putVol / callVol;
}
