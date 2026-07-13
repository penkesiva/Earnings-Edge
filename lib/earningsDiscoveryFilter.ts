/** Discovery filters — US-listed liquid common equity (no preferreds / OTC / foreign). */

export const EARNINGS_DISCOVERY_DAYS = 14;
export const MIN_DISCOVERY_PRICE = 5;
/** Mid-cap+ floor once the name is confirmed US-listed. */
export const MIN_DISCOVERY_MARKET_CAP = 2_000_000_000;

const EXCLUDED_INDUSTRY_RE =
  /pharma|biotech|biopharm|therapeutic|drug manufacturer|medicinal|oncology|clinical[- ]stage|biologics/i;

/** Prefer clear preferred-share names — avoid loose "pref" matches on common names. */
const PREFERRED_NAME_RE =
  /\b(preferred\s+(stock|shares?)|pref\.?\s*shares?|depositary\s+shares?|dep(?:ository)?\.?\s*shares?)\b/i;

const US_EXCHANGE_ALLOW = new Set([
  'NYSE',
  'NASDAQ',
  'AMEX',
  'NYSEARCA',
  'NYSE AMERICAN',
  'NYSE ARCA',
  'BATS',
  'CBOE',
  'ARCA',
  'NASDAQGS',
  'NASDAQGM',
  'NASDAQCM',
  'NASDAQ GLOBAL SELECT',
  'NASDAQ GLOBAL MARKET',
  'NASDAQ CAPITAL MARKET',
  'NEW YORK STOCK EXCHANGE',
  'NYSE MKT',
]);

export type DiscoveryProfile = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  marketCap: number | null;
  exchange?: string | null;
  isEtf?: boolean;
  isFund?: boolean;
};

export type DiscoveryFilterReject =
  | 'penny_stock'
  | 'small_cap'
  | 'pharma_excluded'
  | 'non_common_equity'
  | 'non_us_listed'
  | 'etf_or_fund'
  | 'missing_price'
  | 'missing_market_cap'
  | 'missing_exchange';

/**
 * Drop preferred shares, warrants, units, rights — keeps common class shares
 * like BRK.B / BF-B / GOOGL.
 */
export function isNonCommonEquitySymbol(ticker: string): boolean {
  const t = ticker.toUpperCase().trim();
  if (!t) return true;

  // Preferred series: BAC-P, BAC-PK, BAC-PKPB, WFC-PL
  if (/^[A-Z]+-P[A-Z0-9]*$/.test(t)) return true;
  // Preferred: XXX.PR / XXX.PRA
  if (/^[A-Z]+\.PR[A-Z]?$/.test(t)) return true;
  // Warrants / units / rights (dash or dot forms)
  if (/^[A-Z]+-(W|WS|U|R)[A-Z0-9]*$/.test(t)) return true;
  if (/^[A-Z]+\.(W|WS|U|R)$/.test(t)) return true;
  // Structured / multi-series junk (e.g. FOO-A-B)
  if ((t.match(/-/g) ?? []).length >= 2) return true;

  return false;
}

/** Cheap reject for common OTC ADR patterns (e.g. CWQXY) before profile calls. */
export function isLikelyOtcticker(ticker: string): boolean {
  const t = ticker.toUpperCase().trim();
  // 5-letter tickers ending in Y/F are usually OTC foreign / ADR junk on the FMP calendar.
  if (/^[A-Z]{5}[YF]$/.test(t)) return true;
  return false;
}

export function isPreferredShareName(companyName: string | null): boolean {
  if (!companyName?.trim()) return false;
  return PREFERRED_NAME_RE.test(companyName);
}

export function isPharmaOrTherapeutic(sector: string | null, industry: string | null): boolean {
  const hay = `${sector ?? ''} ${industry ?? ''}`.trim();
  if (!hay) return false;
  return EXCLUDED_INDUSTRY_RE.test(hay);
}

/** NYSE / Nasdaq / Amex / Arca — drops OTC foreign listings like CWQXY. */
export function isUsListedExchange(exchange: string | null | undefined): boolean {
  if (!exchange?.trim()) return false;
  const e = exchange.trim().toUpperCase();
  if (/OTC|PINK|GREY|GRAY|EXPERT|TOKYO|LONDON|STOCKHOLM|TSX|EURONEXT|FRANKFURT/i.test(e)) {
    return false;
  }
  if (US_EXCHANGE_ALLOW.has(e)) return true;
  if (/^NYSE\b/.test(e) || /^NASDAQ\b/.test(e) || /^AMEX\b/.test(e)) return true;
  return false;
}

export function normalizeMarketCap(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function passesDiscoveryFilter(
  profile: DiscoveryProfile,
): { ok: true } | { ok: false; reason: DiscoveryFilterReject } {
  if (isNonCommonEquitySymbol(profile.ticker) || isPreferredShareName(profile.companyName)) {
    return { ok: false, reason: 'non_common_equity' };
  }
  if (profile.isEtf || profile.isFund) {
    return { ok: false, reason: 'etf_or_fund' };
  }
  if (profile.exchange != null && profile.exchange !== '') {
    if (!isUsListedExchange(profile.exchange)) {
      return { ok: false, reason: 'non_us_listed' };
    }
  } else if (profile.exchange === null || profile.exchange === '') {
    // Profile was loaded but exchange missing — do not keep OTC unknowns.
    return { ok: false, reason: 'missing_exchange' };
  }
  // When exchange is undefined, quote-only draft — caller should load profile before final pass.

  if (profile.price == null || profile.price < MIN_DISCOVERY_PRICE) {
    return { ok: false, reason: profile.price == null ? 'missing_price' : 'penny_stock' };
  }
  const mcap = normalizeMarketCap(profile.marketCap);
  if (mcap == null || mcap < MIN_DISCOVERY_MARKET_CAP) {
    return {
      ok: false,
      reason: mcap == null ? 'missing_market_cap' : 'small_cap',
    };
  }
  if (isPharmaOrTherapeutic(profile.sector, profile.industry)) {
    return { ok: false, reason: 'pharma_excluded' };
  }
  return { ok: true };
}

export function calendarTiming(raw: string): 'BMO' | 'AMC' | 'UNK' {
  const t = raw.toLowerCase();
  if (t === 'bmo' || t.includes('before')) return 'BMO';
  if (t === 'amc' || t.includes('after')) return 'AMC';
  return 'UNK';
}

/** Short label for the Watchlist discovery panel. */
export function discoveryFilterSummary(): string {
  return `FMP calendar · US-listed common · price ≥ $5 · cap ≥ $2B · no pharma/biotech`;
}
