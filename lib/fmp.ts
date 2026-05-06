/**
 * Financial Modeling Prep API client.
 *
 * Pricing: Starter $25/mo at https://site.financialmodelingprep.com/developer/docs/pricing
 *
 * Endpoints used:
 *  - /v3/earning_calendar — upcoming earnings dates
 *  - /v3/earnings-surprises/{ticker} — historical surprises
 *  - /v3/analyst-estimates/{ticker} — current consensus
 *  - /v4/upgrades-downgrades-rss-feed — analyst revisions
 *  - /v4/insider-trading — insider buying/selling
 */

const BASE = 'https://financialmodelingprep.com';
const KEY = process.env.FMP_API_KEY!;

async function fmp(path: string) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apikey=${KEY}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`FMP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ----- Types -----
export type EarningsCalendarEntry = {
  date: string;
  symbol: string;
  eps: number | null;
  epsEstimated: number | null;
  revenue: number | null;
  revenueEstimated: number | null;
  time: string; // "amc" | "bmo"
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

// ----- Earnings calendar -----
export async function getEarningsCalendar(from: string, to: string) {
  const data = await fmp(`/v3/earning_calendar?from=${from}&to=${to}`);
  return data as EarningsCalendarEntry[];
}

export async function getTickerEarningsCalendar(ticker: string, limit = 4) {
  const data = await fmp(
    `/v3/historical/earning_calendar/${ticker}?limit=${limit}`
  );
  return data as EarningsCalendarEntry[];
}

// ----- Surprise history -----
export async function getEarningsSurprises(ticker: string) {
  const data = await fmp(`/v3/earnings-surprises/${ticker}`);
  return data as EarningsSurprise[];
}

/**
 * Compute the last N quarters: how many beats, average surprise %.
 */
export async function computeBeatStats(ticker: string, lookback = 4) {
  const surprises = await getEarningsSurprises(ticker);
  const recent = surprises.slice(0, lookback);

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

// ----- Analyst estimates / revisions -----
export async function getAnalystEstimates(ticker: string) {
  return fmp(`/v3/analyst-estimates/${ticker}?period=quarter`);
}

/**
 * Net analyst revisions in last 30 days (upgrades - downgrades).
 * Returns +N or -N. Higher = more bullish revisions.
 */
export async function getNetRevisions30d(ticker: string): Promise<number> {
  const data = await fmp(
    `/v4/upgrades-downgrades-rss-feed?symbol=${ticker}&page=0`
  );
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  let net = 0;
  for (const item of data || []) {
    const itemDate = new Date(item.publishedDate).getTime();
    if (itemDate < cutoff) continue;

    const grade = (item.newGrade || '').toLowerCase();
    if (
      grade.includes('buy') ||
      grade.includes('outperform') ||
      grade.includes('overweight')
    )
      net++;
    else if (
      grade.includes('sell') ||
      grade.includes('underperform') ||
      grade.includes('underweight')
    )
      net--;
  }

  return net;
}

// ----- Insider trades -----
/**
 * Net insider buying in last 90 days, in dollars.
 * Positive = net buying (bullish).
 */
export async function getNetInsiderBuying90d(ticker: string): Promise<number> {
  const data = await fmp(
    `/v4/insider-trading?symbol=${ticker}&page=0`
  );
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

  let net = 0;
  for (const trade of data || []) {
    const tradeDate = new Date(trade.transactionDate).getTime();
    if (tradeDate < cutoff) continue;

    const dollarValue = (trade.securitiesTransacted || 0) * (trade.price || 0);
    const isPurchase = (trade.transactionType || '')
      .toLowerCase()
      .includes('purchase');
    const isSale = (trade.transactionType || '').toLowerCase().includes('sale');

    if (isPurchase) net += dollarValue;
    else if (isSale) net -= dollarValue;
  }

  // Return in millions for easier scoring
  return net / 1_000_000;
}

// ----- Sector momentum -----
/**
 * Get the 5-day return of the ticker's sector ETF.
 * Approximation: map ticker → sector → ETF.
 */
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

export async function getSectorEtf(ticker: string): Promise<string> {
  const profile = await fmp(`/v3/profile/${ticker}`);
  const sector = profile?.[0]?.sector;
  return SECTOR_ETFS[sector] || 'SPY';
}
