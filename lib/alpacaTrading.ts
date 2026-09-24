import type { AlpacaAuth } from '@/lib/alpaca';
import { tradingBaseUrl, type AlpacaEnvironment } from '@/lib/alpacaCredentials';

export type AlpacaTradingAccount = {
  id: string;
  status: string;
  equity: string;
  buyingPower: string;
  patternDayTrader: boolean;
};

export type AlpacaOrderResult = {
  id: string;
  status: string;
  symbol: string;
  qty: string;
  side: string;
  filledQty?: string;
};

export type OptionLegOrder = {
  symbol: string;
  side: 'buy' | 'sell';
  ratioQty?: number;
};

/** Single-leg option market order (1 contract minimum). */
export async function placeOptionMarketOrder(
  auth: AlpacaAuth,
  params: { symbol: string; qty: number; side: 'buy' | 'sell' },
): Promise<{ ok: true; order: AlpacaOrderResult } | { ok: false; error: string }> {
  const qty = Math.floor(params.qty);
  if (qty < 1) {
    return { ok: false, error: 'Option size too small (qty < 1 contract).' };
  }

  const base = resolveTradingBase(auth);
  try {
    const res = await fetch(`${base}/v2/orders`, {
      method: 'POST',
      headers: {
        ...tradingHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: params.symbol.toUpperCase(),
        qty: String(qty),
        side: params.side,
        type: 'market',
        time_in_force: 'day',
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `Alpaca option order rejected (${res.status}).` };
    }

    const data = (await res.json()) as {
      id?: string;
      status?: string;
      symbol?: string;
      qty?: string;
      side?: string;
      filled_qty?: string;
    };

    if (!data.id) return { ok: false, error: 'Alpaca returned no order id.' };

    return {
      ok: true,
      order: {
        id: data.id,
        status: data.status ?? 'submitted',
        symbol: data.symbol ?? params.symbol,
        qty: data.qty ?? String(qty),
        side: data.side ?? params.side,
        filledQty: data.filled_qty,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Multi-leg option order (spreads / condors). Uses net debit/credit limit when provided. */
export async function placeOptionMultiLegOrder(
  auth: AlpacaAuth,
  params: {
    qty: number;
    legs: OptionLegOrder[];
    limitPrice?: number | null;
  },
): Promise<{ ok: true; order: AlpacaOrderResult } | { ok: false; error: string }> {
  const qty = Math.floor(params.qty);
  if (qty < 1) return { ok: false, error: 'Spread size too small (qty < 1).' };
  if (params.legs.length < 2) {
    return { ok: false, error: 'Multi-leg order requires at least 2 legs.' };
  }

  const base = resolveTradingBase(auth);
  const orderType = params.limitPrice != null && params.limitPrice > 0 ? 'limit' : 'market';
  const body: Record<string, unknown> = {
    order_class: 'mleg',
    qty: String(qty),
    type: orderType,
    time_in_force: 'day',
    legs: params.legs.map(leg => ({
      symbol: leg.symbol.toUpperCase(),
      side: leg.side,
      ratio_qty: String(leg.ratioQty ?? 1),
    })),
  };
  if (orderType === 'limit' && params.limitPrice != null) {
    body.limit_price = String(params.limitPrice);
  }

  try {
    const res = await fetch(`${base}/v2/orders`, {
      method: 'POST',
      headers: {
        ...tradingHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text || `Alpaca mleg order rejected (${res.status}).` };
    }

    const data = (await res.json()) as {
      id?: string;
      status?: string;
      qty?: string;
    };
    if (!data.id) return { ok: false, error: 'Alpaca returned no order id.' };

    return {
      ok: true,
      order: {
        id: data.id,
        status: data.status ?? 'submitted',
        symbol: params.legs.map(l => l.symbol).join('+'),
        qty: data.qty ?? String(qty),
        side: 'buy',
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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

/** Fetch one order (fill price/status) after placement. */
export async function getOrderFill(
  auth: AlpacaAuth,
  orderId: string,
): Promise<{ status: string; filledAvgPrice: number | null } | null> {
  const base = resolveTradingBase(auth);
  try {
    const res = await fetch(`${base}/v2/orders/${encodeURIComponent(orderId)}`, {
      headers: tradingHeaders(auth),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; filled_avg_price?: string | null };
    const avg = data.filled_avg_price != null ? Number(data.filled_avg_price) : NaN;
    return {
      status: data.status ?? 'unknown',
      filledAvgPrice: Number.isFinite(avg) && avg > 0 ? avg : null,
    };
  } catch {
    return null;
  }
}

/** Market order on underlying equity — directional proxy for consensus GO trades. */
export async function placeMarketOrder(
  auth: AlpacaAuth,
  params: { symbol: string; qty: number; side: 'buy' | 'sell' },
): Promise<{ ok: true; order: AlpacaOrderResult } | { ok: false; error: string }> {
  const qty = Math.floor(params.qty);
  if (qty < 1) {
    return { ok: false, error: 'Order size too small (qty < 1).' };
  }

  const base = resolveTradingBase(auth);
  try {
    const res = await fetch(`${base}/v2/orders`, {
      method: 'POST',
      headers: {
        ...tradingHeaders(auth),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: params.symbol.toUpperCase(),
        qty: String(qty),
        side: params.side,
        type: 'market',
        time_in_force: 'day',
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `Alpaca order rejected (${res.status}).` };
    }

    const data = (await res.json()) as {
      id?: string;
      status?: string;
      symbol?: string;
      qty?: string;
      side?: string;
      filled_qty?: string;
    };

    if (!data.id) return { ok: false, error: 'Alpaca returned no order id.' };

    return {
      ok: true,
      order: {
        id: data.id,
        status: data.status ?? 'submitted',
        symbol: data.symbol ?? params.symbol,
        qty: data.qty ?? String(qty),
        side: data.side ?? params.side,
        filledQty: data.filled_qty,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
