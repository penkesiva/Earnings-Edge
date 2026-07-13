/**
 * Financial Modeling Prep API client (Stable API).
 *
 * Uses https://financialmodelingprep.com/stable/... — legacy /v3 and /v4 routes
 * return 403 for accounts created after the legacy cutoff (Aug 2025).
 *
 * Docs: https://site.financialmodelingprep.com/developer/docs/stable
 */

const STABLE = 'https://financialmodelingprep.com/stable';
const KEY = process.env.FMP_API_KEY!;

/**
 * Base FMP fetch.
 * @param noCache - pass true for post-earnings outcome data where we need
 *   the freshest EPS result. Default uses a 1-hour Next.js data cache to
 *   avoid hammering FMP during batch scans.
 */
async function fmp(path: string, noCache = false) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${STABLE}/${path.replace(/^\//, '')}${sep}apikey=${KEY}`;
  const fetchOpts: RequestInit = noCache
    ? { cache: 'no-store' }
    : { next: { revalidate: 3600 } };
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`FMP ${res.status}: ${await res.text()}`);
  return res.json();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ----- Types -----
export type EarningsCalendarEntry = {
  date: string;
  symbol: string;
  eps: number | null;
  epsEstimated: number | null;
  revenue: number | null;
  revenueEstimated: number | null;
  time: string; // "amc" | "bmo" | "" if unknown
};

export type EarningsSurprise = {
  date: string;
  symbol: string;
  actualEarningResult: number;
  estimatedEarning: number;
};

export type InsiderTrade = {
  symbol: string;
  filingDate: string;
  transactionDate: string;
  transactionType: string;
  securitiesTransacted: number;
  price: number;
  reportingName: string;
};

function normalizeCalendarRow(
  raw: Record<string, unknown>,
  ticker?: string
): EarningsCalendarEntry {
  const timeRaw = String(raw.time ?? '').toLowerCase();
  const time =
    timeRaw === 'amc' || timeRaw === 'bmo'
      ? timeRaw
      : timeRaw.includes('after')
        ? 'amc'
        : timeRaw.includes('before')
          ? 'bmo'
          : '';

  return {
    date: String(raw.date ?? ''),
    symbol: String(raw.symbol ?? ticker ?? ''),
    eps: num(raw.epsActual ?? raw.eps),
    epsEstimated: num(raw.epsEstimated),
    revenue: num(raw.revenueActual ?? raw.revenue),
    revenueEstimated: num(raw.revenueEstimated),
    time,
  };
}

// ----- Earnings calendar -----
export async function getEarningsCalendar(from: string, to: string) {
  const data = await fmp(
    `earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r: Record<string, unknown>) => normalizeCalendarRow(r));
}

export async function getTickerEarningsCalendar(ticker: string, limit = 4) {
  const from = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const data = await fmp(
    `earnings-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&symbol=${encodeURIComponent(ticker)}`
  );
  const rows = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) =>
    normalizeCalendarRow(r, ticker)
  );
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return rows.slice(0, limit);
}

/** Per-quarter history (stable); used instead of legacy earnings-surprises. */
async function getEarningsHistoryForSurprises(
  ticker: string,
  noCache = false,
): Promise<EarningsSurprise[]> {
  const data = await fmp(`earnings?symbol=${encodeURIComponent(ticker)}`, noCache);
  const rows = Array.isArray(data) ? data : [];
  const out: EarningsSurprise[] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const act = num(raw.epsActual);
    const est = num(raw.epsEstimated);
    if (act === null || est === null) continue;
    out.push({
      date: String(raw.date ?? ''),
      symbol: String(raw.symbol ?? ticker),
      actualEarningResult: act,
      estimatedEarning: est,
    });
  }
  return out;
}

// ----- Surprise history -----

/**
 * FMP's dedicated earnings-surprises endpoint — different data source from
 * the per-quarter history, often updates faster right after a report.
 * Used as a fallback when the primary earnings history has no recent match.
 */
async function getEarningsSurprisesDedicated(
  ticker: string,
  noCache = false,
): Promise<EarningsSurprise[]> {
  const data = await fmp(`earnings-surprises?symbol=${encodeURIComponent(ticker)}`, noCache);
  const rows = Array.isArray(data) ? data : [];
  const out: EarningsSurprise[] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const act = num(raw.actualEarningResult) ?? num(raw.epsActual);
    const est = num(raw.estimatedEarning) ?? num(raw.epsEstimated);
    if (act === null || est === null) continue;
    out.push({
      date: String(raw.date ?? ''),
      symbol: String(raw.symbol ?? ticker),
      actualEarningResult: act,
      estimatedEarning: est,
    });
  }
  return out;
}

/**
 * Fetch EPS surprise data with fallback:
 *   1. FMP historical earnings (per-quarter, longer history)
 *   2. FMP earnings-surprises endpoint (dedicated, often updates sooner)
 * Both use noCache=true when called right after earnings release.
 */
export async function getEarningsSurprises(ticker: string, noCache = false): Promise<EarningsSurprise[]> {
  const primary = await getEarningsHistoryForSurprises(ticker, noCache).catch(() => []);
  if (primary.length > 0) return primary;
  // Primary returned nothing (FMP plan gap or not yet updated) — try dedicated endpoint
  return getEarningsSurprisesDedicated(ticker, noCache).catch(() => []);
}

/**
 * Compute the last N quarters: how many beats, average surprise %.
 */
export async function computeBeatStats(ticker: string, lookback = 4) {
  const surprises = await getEarningsHistoryForSurprises(ticker);
  const sorted = [...surprises].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recent = sorted.slice(0, lookback);

  let beats = 0;
  let totalSurprisePct = 0;

  for (const s of recent) {
    if (
      s.actualEarningResult !== null &&
      s.estimatedEarning !== null &&
      s.actualEarningResult > s.estimatedEarning
    ) {
      beats++;
    }
    if (s.estimatedEarning && s.estimatedEarning !== 0) {
      const pct =
        ((s.actualEarningResult - s.estimatedEarning) /
          Math.abs(s.estimatedEarning)) *
        100;
      totalSurprisePct += pct;
    }
  }

  return {
    beatsLastN: beats,
    totalQuarters: recent.length,
    avgSurprisePct: recent.length ? totalSurprisePct / recent.length : 0,
  };
}

// ----- Analyst estimates -----
export async function getAnalystEstimates(ticker: string) {
  const sym = encodeURIComponent(ticker);
  // Quarter estimates are a premium tier on some plans; fall back to annual.
  let res = await fetch(
    `${STABLE}/analyst-estimates?symbol=${sym}&period=quarter&page=0&limit=40&apikey=${KEY}`,
    { next: { revalidate: 3600 } }
  );
  if (res.status === 402 || res.status === 403) {
    res = await fetch(
      `${STABLE}/analyst-estimates?symbol=${sym}&period=annual&page=0&limit=40&apikey=${KEY}`,
      { next: { revalidate: 3600 } }
    );
  }
  if (!res.ok) throw new Error(`FMP ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Net analyst revisions in last 30 days (upgrades - downgrades).
 * Uses stable `grades` (action: upgrade | downgrade | maintain).
 */
export async function getNetRevisions30d(ticker: string): Promise<number> {
  const data = await fmp(`grades?symbol=${encodeURIComponent(ticker)}`);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let net = 0;
  for (const item of data || []) {
    const itemDate = new Date(
      (item as { date?: string }).date || 0
    ).getTime();
    if (itemDate < cutoff) continue;

    const action = String(
      (item as { action?: string }).action || ''
    ).toLowerCase();
    if (action === 'upgrade') net++;
    else if (action === 'downgrade') net--;
  }

  return net;
}

// ----- Insider trades -----
function isPurchaseTrade(trade: {
  transactionType?: string;
  acquisitionOrDisposition?: string;
}) {
  const t = (trade.transactionType || '').toLowerCase();
  if (t.includes('purchase') || t.includes('buy') || t.includes('acquisition'))
    return true;
  if (trade.acquisitionOrDisposition === 'A') return true;
  return false;
}

function isSaleTrade(trade: { transactionType?: string }) {
  const t = (trade.transactionType || '').toLowerCase();
  return t.includes('sale') || t.includes('sell');
}

async function fetchInsiderTrades(ticker: string, maxPages = 6) {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await fmp(
      `insider-trading/search?symbol=${encodeURIComponent(ticker)}&page=${page}&limit=500`
    );
    const chunk = Array.isArray(data) ? data : [];
    if (!chunk.length) break;
    all.push(...chunk);
  }
  return all;
}

/**
 * Net insider buying in last 90 days, in dollars.
 * Positive = net buying (bullish).
 */
export async function getNetInsiderBuying90d(ticker: string): Promise<number> {
  const data = await fetchInsiderTrades(ticker);
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

  let net = 0;
  for (const trade of data || []) {
    const tradeDate = new Date(
      String((trade as InsiderTrade).transactionDate || '')
    ).getTime();
    if (tradeDate < cutoff) continue;

    const dollarValue =
      (num((trade as { securitiesTransacted?: unknown }).securitiesTransacted) ||
        0) * (num((trade as { price?: unknown }).price) || 0);

    if (isPurchaseTrade(trade as { transactionType?: string; acquisitionOrDisposition?: string }))
      net += dollarValue;
    else if (isSaleTrade(trade as { transactionType?: string })) net -= dollarValue;
  }

  return net / 1_000_000;
}

// ----- Sector momentum -----
const SECTOR_ETFS: Record<string, string> = {
  Technology: 'XLK',
  Energy: 'XLE',
  Financials: 'XLF',
  Healthcare: 'XLV',
  Industrials: 'XLI',
  'Consumer Cyclical': 'XLY',
  'Consumer Defensive': 'XLP',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  'Basic Materials': 'XLB',
  'Communication Services': 'XLC',
};

// ----- Quote batch (discovery + dashboards) -----
export async function getQuotesBatch(
  tickers: string[],
): Promise<Map<string, { price: number | null; marketCap: number | null; name: string | null }>> {
  const out = new Map<string, { price: number | null; marketCap: number | null; name: string | null }>();
  if (!tickers.length) return out;

  const chunkSize = 50;
  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    const sym = chunk.map(t => encodeURIComponent(t)).join(',');
    const data = await fmp(`quote?symbol=${sym}`);
    const rows = Array.isArray(data) ? data : [];
    for (const raw of rows as Record<string, unknown>[]) {
      const symbol = String(raw.symbol ?? '').toUpperCase();
      if (!symbol) continue;
      const rawName = raw.name ?? raw.companyName;
      out.set(symbol, {
        price: num(raw.price),
        marketCap: num(raw.marketCap ?? raw.market_cap),
        name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
      });
    }
  }
  return out;
}

export async function getCompanyProfile(ticker: string): Promise<{
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  marketCap: number | null;
}> {
  const profile = await fmp(`profile?symbol=${encodeURIComponent(ticker)}`);
  const row = Array.isArray(profile) ? profile[0] : null;
  const rawName = row?.companyName ?? row?.name;
  const companyName =
    typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
  const sector = typeof row?.sector === 'string' ? row.sector : null;
  const industry = typeof row?.industry === 'string' ? row.industry : null;
  const price = num(row?.price);
  const marketCap = num(row?.marketCap ?? row?.mktCap);
  return { companyName, sector, industry, price, marketCap };
}

export async function getCompanyName(ticker: string): Promise<string | null> {
  try {
    const { companyName } = await getCompanyProfile(ticker);
    return companyName;
  } catch {
    return null;
  }
}

export async function getSectorEtf(ticker: string): Promise<string> {
  const { sector } = await getCompanyProfile(ticker);
  return (sector && SECTOR_ETFS[sector]) || 'SPY';
}

/** Consecutive beats from most recent quarter backward (same order as surprises API). */
export async function getConsecutiveBeatStreak(ticker: string, lookback = 8) {
  const surprises = await getEarningsHistoryForSurprises(ticker);
  const sorted = [...surprises].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recent = sorted.slice(0, lookback);
  let streak = 0;
  for (const s of recent) {
    const est = s.estimatedEarning;
    const act = s.actualEarningResult;
    if (
      est != null &&
      act != null &&
      !Number.isNaN(est) &&
      est !== 0 &&
      act > est
    ) {
      streak++;
    } else {
      break;
    }
  }
  return { streak, totalQuarters: recent.length };
}

/** Distinct insiders with sales in trailing window (cluster for scream test). */
export async function hasInsiderSellingCluster60d(ticker: string): Promise<boolean> {
  const data = await fetchInsiderTrades(ticker, 2);
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const names = new Set<string>();
  for (const trade of data || []) {
    const td = new Date(
      String((trade as InsiderTrade).transactionDate || '')
    ).getTime();
    if (td < cutoff) continue;
    const t = (trade as InsiderTrade).transactionType || '';
    if (!isSaleTrade(trade as { transactionType?: string })) continue;
    names.add((trade as InsiderTrade).reportingName || 'unknown');
  }
  return names.size >= 2;
}

/** Forward P/E (TTM ratios) — used for stretched valuation heuristic. */
export async function getForwardPeTtm(ticker: string): Promise<number | null> {
  const data = await fmp(`ratios-ttm?symbol=${encodeURIComponent(ticker)}`);
  const row = Array.isArray(data) ? data[0] : null;
  const fwd =
    row?.forwardPE ??
    row?.forwardPeRatio ??
    row?.peRatioTTM ??
    row?.priceToEarningsRatioTTM ??
    null;
  return typeof fwd === 'number' && fwd > 0 && fwd < 9999 ? fwd : null;
}
