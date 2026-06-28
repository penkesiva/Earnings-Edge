/** Standard discovery filters — price, size, exclude pharma/biotech/therapeutics. */

export const EARNINGS_DISCOVERY_DAYS = 14;
export const MIN_DISCOVERY_PRICE = 5;
export const MIN_DISCOVERY_MARKET_CAP = 2_000_000_000;

const EXCLUDED_INDUSTRY_RE =
  /pharma|biotech|biopharm|therapeutic|drug manufacturer|medicinal|oncology|clinical[- ]stage|biologics/i;

export type DiscoveryProfile = {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  price: number | null;
  marketCap: number | null;
};

export type DiscoveryFilterReject =
  | 'penny_stock'
  | 'small_cap'
  | 'pharma_excluded'
  | 'missing_price'
  | 'missing_market_cap';

export function isPharmaOrTherapeutic(sector: string | null, industry: string | null): boolean {
  const hay = `${sector ?? ''} ${industry ?? ''}`.trim();
  if (!hay) return false;
  return EXCLUDED_INDUSTRY_RE.test(hay);
}

export function passesDiscoveryFilter(
  profile: DiscoveryProfile,
): { ok: true } | { ok: false; reason: DiscoveryFilterReject } {
  if (profile.price == null || profile.price < MIN_DISCOVERY_PRICE) {
    return { ok: false, reason: profile.price == null ? 'missing_price' : 'penny_stock' };
  }
  if (profile.marketCap == null || profile.marketCap < MIN_DISCOVERY_MARKET_CAP) {
    return {
      ok: false,
      reason: profile.marketCap == null ? 'missing_market_cap' : 'small_cap',
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
