import type { AlpacaAuth } from '@/lib/alpaca';
import { tradingBaseUrl, type AlpacaEnvironment } from '@/lib/alpacaCredentials';

export type AlpacaTradingAccount = {
  id: string;
  status: string;
  equity: string;
  buyingPower: string;
  patternDayTrader: boolean;
};

function tradingHeaders(auth: AlpacaAuth): Record<string, string> {
  return {
    'APCA-API-KEY-ID': auth.keyId.trim(),
    'APCA-API-SECRET-KEY': auth.secret.trim(),
  };
}

function resolveTradingBase(auth: AlpacaAuth): string {
  if (auth.tradingBaseUrl) return auth.tradingBaseUrl;
  const env = auth.environment ?? 'paper';
  return tradingBaseUrl(env as AlpacaEnvironment);
}

/** Live account snapshot from Alpaca trading API — used before placing orders. */
export async function getTradingAccount(
  auth: AlpacaAuth,
): Promise<AlpacaTradingAccount | null> {
  const base = resolveTradingBase(auth);
  try {
    const res = await fetch(`${base}/v2/account`, {
      headers: tradingHeaders(auth),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id?: string;
      status?: string;
      equity?: string;
      buying_power?: string;
      pattern_day_trader?: boolean;
    };
    if (!data.id) return null;
    return {
      id: data.id,
      status: data.status ?? 'unknown',
      equity: data.equity ?? '0',
      buyingPower: data.buying_power ?? '0',
      patternDayTrader: !!data.pattern_day_trader,
    };
  } catch {
    return null;
  }
}
