/** Discovery filters — liquid common equity only (no preferreds / warrants / units). */

export const EARNINGS_DISCOVERY_DAYS = 14;
export const MIN_DISCOVERY_PRICE = 5;
/** Large/mid-cap floor — cuts thin names that clutter the 14-day list. */
export const MIN_DISCOVERY_MARKET_CAP = 5_000_000_000;
/** Prefer names with real trading interest (FMP quote avgVolume when present). */
export const MIN_DISCOVERY_AVG_VOLUME = 500_000;

const EXCLUDED_INDUSTRY_RE =
  /pharma|biotech|biopharm|therapeutic|drug manufacturer|medicinal|oncology|clinical[- ]stage|biologics/i;

const PREFERRED_NAME_RE =
  /\b(preferred|pref\.?|depositary shares?|dep(?:ository)?\.?\s*shares?)\b/i;

export type DiscoveryProfile = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  marketCap: number | null;
  avgVolume?: number | null;
};

export type DiscoveryFilterReject =
  | 'penny_stock'
  | 'small_cap'
  | 'low_volume'
  | 'pharma_excluded'
  | 'non_common_equity'
  | 'missing_price'
  | 'missing_market_cap';

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

export function isPreferredShareName(companyName: string | null): boolean {
  if (!companyName?.trim()) return false;
  return PREFERRED_NAME_RE.test(companyName);
}

export function isPharmaOrTherapeutic(sector: string | null, industry: string | null): boolean {
  const hay = `${sector ?? ''} ${industry ?? ''}`.trim();
  if (!hay) return false;
  return EXCLUDED_INDUSTRY_RE.test(hay);
}

export function passesDiscoveryFilter(
  profile: DiscoveryProfile,
): { ok: true } | { ok: false; reason: DiscoveryFilterReject } {
  if (isNonCommonEquitySymbol(profile.ticker) || isPreferredShareName(profile.companyName)) {
    return { ok: false, reason: 'non_common_equity' };
  }
  if (profile.price == null || profile.price < MIN_DISCOVERY_PRICE) {
    return { ok: false, reason: profile.price == null ? 'missing_price' : 'penny_stock' };
  }
  if (profile.marketCap == null || profile.marketCap < MIN_DISCOVERY_MARKET_CAP) {
    return {
      ok: false,
      reason: profile.marketCap == null ? 'missing_market_cap' : 'small_cap',
    };
  }
  if (
    profile.avgVolume != null &&
    profile.avgVolume > 0 &&
    profile.avgVolume < MIN_DISCOVERY_AVG_VOLUME
  ) {
    return { ok: false, reason: 'low_volume' };
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
  return `FMP calendar · common equity · price ≥ $5 · cap ≥ $5B · avg vol ≥ 500k · no pharma/biotech`;
}
