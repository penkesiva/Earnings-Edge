import { getStockSnapshot } from '@/lib/alpaca';
import type { AlpacaAuth } from '@/lib/alpaca';
import { getCompanyProfile } from '@/lib/fmp';
import {
  isLikelyOtcticker,
  isNonCommonEquitySymbol,
  isPreferredShareName,
  isUsListedExchange,
} from '@/lib/earningsDiscoveryFilter';

export type ValidatedIntradayTicker = {
  symbol: string;
  companyName: string | null;
  exchange: string | null;
  price: number | null;
};

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeTickerInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export async function validateIntradayTicker(
  raw: string,
  auth: AlpacaAuth | null,
): Promise<{ ok: true; ticker: ValidatedIntradayTicker } | { ok: false; error: string }> {
  const symbol = normalizeTickerInput(raw);
  if (!symbol) return { ok: false, error: 'Enter a ticker symbol.' };
  if (symbol.length > 10) return { ok: false, error: 'Ticker is too long.' };
  if (!TICKER_RE.test(symbol)) {
    return { ok: false, error: 'Invalid ticker format (US letters/numbers only).' };
  }
  if (isNonCommonEquitySymbol(symbol) || isLikelyOtcticker(symbol)) {
    return { ok: false, error: 'Preferred, warrant, unit, or OTC-style symbols are not allowed.' };
  }

  let companyName: string | null = null;
  let exchange: string | null = null;
  let price: number | null = null;

  try {
    const profile = await getCompanyProfile(symbol);
    if (profile.isFund && !profile.isEtf) {
      return { ok: false, error: 'Mutual funds are not supported — use stocks or ETFs.' };
    }
    if (!profile.isEtf && isPreferredShareName(profile.companyName)) {
      return { ok: false, error: 'Preferred shares are not supported.' };
    }
    if (profile.exchange && !isUsListedExchange(profile.exchange)) {
      return { ok: false, error: 'Ticker must be US-listed (NYSE, Nasdaq, or AMEX).' };
    }
    companyName = profile.companyName;
    exchange = profile.exchange;
    price = profile.price;
  } catch {
    /* FMP optional — fall through to Alpaca */
  }

  if (auth) {
    try {
      const snap = await getStockSnapshot(symbol, auth);
      price = snap.price ?? price;
      if (snap.price != null && snap.price < 1) {
        return { ok: false, error: 'Price below $1 — not supported for this strategy.' };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Could not verify symbol on Alpaca: ${msg}` };
    }
  } else if (price == null) {
    return { ok: false, error: 'Add Alpaca keys in Settings to validate and run backtests.' };
  }

  if (exchange && !isUsListedExchange(exchange)) {
    return { ok: false, error: 'Non-US exchange — US stocks and ETFs only.' };
  }

  return {
    ok: true,
    ticker: { symbol, companyName, exchange, price },
  };
}
