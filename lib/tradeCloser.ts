/**
 * Close auto-trade positions after the earnings reaction resolves.
 *
 * Reaction day: BMO report on date D → D itself; AMC (or unknown) → next
 * trading day after D. The close cron runs ~10 min before the close of the
 * reaction day; each position is flattened with an offsetting market order
 * and realized paper P&L is written back to trade_orders.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAlpacaAuthForUser, type AlpacaEnvironment } from '@/lib/alpacaCredentials';
import { getStockSnapshot } from '@/lib/alpaca';
import { getOrderFill, placeMarketOrder } from '@/lib/alpacaTrading';
import { addCalendarDays, earningsSessionDate } from '@/lib/earningsDate';
import { isTradingDay } from '@/lib/usMarketCalendar';

export type CloseTradesResult = {
  attempted: number;
  closed: number;
  failed: number;
  messages: string[];
};

type OpenOrderRow = {
  id: string;
  user_id: string;
  ticker: string;
  earnings_date: string;
  environment: AlpacaEnvironment;
  side: 'buy' | 'sell';
  qty: number;
  notional_usd: number | null;
};

export function nextTradingDayAfter(iso: string): string {
  let d = addCalendarDays(iso, 1);
  while (!isTradingDay(d)) d = addCalendarDays(d, 1);
  return d;
}

/** Reaction day whose close ends the trade. */
export function tradeExitDate(earningsDate: string, timing: 'BMO' | 'AMC' | 'UNK'): string {
  return timing === 'BMO' ? earningsDate : nextTradingDayAfter(earningsDate);
}

async function loadOpenOrders(sb: SupabaseClient, userId: string): Promise<OpenOrderRow[]> {
  const { data, error } = await sb
    .from('trade_orders')
    .select('id, user_id, ticker, earnings_date, environment, side, qty, notional_usd, closed_at, status')
    .eq('user_id', userId)
    .in('status', ['submitted', 'filled'])
    .is('closed_at', null)
    .gt('qty', 0);

  if (error) throw new Error(error.message);
  return (data ?? []) as OpenOrderRow[];
}

async function timingLookup(
  sb: SupabaseClient,
  userId: string,
  orders: OpenOrderRow[],
): Promise<Map<string, 'BMO' | 'AMC' | 'UNK'>> {
  if (!orders.length) return new Map();
  const { data } = await sb
    .from('earnings_events')
    .select('ticker, earnings_date, timing')
    .eq('user_id', userId)
    .in('ticker', [...new Set(orders.map(o => o.ticker))]);

  return new Map(
    (data ?? []).map(e => [
      `${e.ticker}:${e.earnings_date}`,
      (e.timing ?? 'UNK') as 'BMO' | 'AMC' | 'UNK',
    ]),
  );
}

/** Close one order row with an offsetting market order; write exit + P&L. */
export async function closeTradeOrder(
  sb: SupabaseClient,
  userId: string,
  order: OpenOrderRow,
): Promise<{ ok: boolean; detail: string }> {
  const auth = await resolveAlpacaAuthForUser(userId, order.environment);
  if (!auth) {
    return { ok: false, detail: `${order.ticker}: no ${order.environment} Alpaca keys.` };
  }

  const closeSide = order.side === 'buy' ? 'sell' : 'buy';
  const placed = await placeMarketOrder(auth, {
    symbol: order.ticker,
    qty: order.qty,
    side: closeSide,
  });

  if (!placed.ok) {
    return { ok: false, detail: `${order.ticker}: close failed — ${placed.error.slice(0, 120)}` };
  }

  // Give the market order a moment to fill, then read the fill price.
  await new Promise(r => setTimeout(r, 1500));
  const fill = await getOrderFill(auth, placed.order.id);
  let exitPrice = fill?.filledAvgPrice ?? null;
  if (exitPrice == null) {
    try {
      const snap = await getStockSnapshot(order.ticker, auth);
      exitPrice = snap.price > 0 ? snap.price : null;
    } catch {
      exitPrice = null;
    }
  }

  const entryPrice =
    order.notional_usd != null && order.qty > 0 ? order.notional_usd / order.qty : null;
  let pnl: number | null = null;
  if (exitPrice != null && entryPrice != null) {
    const raw =
      order.side === 'buy'
        ? (exitPrice - entryPrice) * order.qty
        : (entryPrice - exitPrice) * order.qty;
    pnl = Math.round(raw * 100) / 100;
  }

  const { error } = await sb
    .from('trade_orders')
    .update({
      status: 'closed',
      exit_price: exitPrice,
      realized_pnl_usd: pnl,
      close_order_id: placed.order.id,
      closed_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('user_id', userId);

  if (error) {
    return {
      ok: false,
      detail: `${order.ticker}: closed on Alpaca but log write failed — ${error.message}`,
    };
  }

  const pnlText = pnl != null ? ` P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '';
  return {
    ok: true,
    detail: `${order.ticker}: closed ${order.qty} @ ~$${exitPrice?.toFixed(2) ?? '?'}${pnlText} [${order.environment}]`,
  };
}

/** Close a single order by id — used by the manual button on /trade. */
export async function closeTradeOrderById(
  sb: SupabaseClient,
  userId: string,
  orderId: string,
): Promise<{ ok: boolean; detail: string }> {
  const { data, error } = await sb
    .from('trade_orders')
    .select('id, user_id, ticker, earnings_date, environment, side, qty, notional_usd, status, closed_at')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return { ok: false, detail: error.message };
  if (!data) return { ok: false, detail: 'Order not found.' };
  if (data.closed_at || data.status === 'closed') {
    return { ok: false, detail: `${data.ticker}: already closed.` };
  }
  if (!['submitted', 'filled'].includes(data.status) || Number(data.qty) <= 0) {
    return { ok: false, detail: `${data.ticker}: nothing to close (status ${data.status}).` };
  }

  return closeTradeOrder(sb, userId, { ...(data as OpenOrderRow), qty: Number(data.qty) });
}

/** Cron path: close every open position whose reaction day has arrived. */
export async function closeDueTrades(
  sb: SupabaseClient,
  userId: string,
): Promise<CloseTradesResult> {
  const result: CloseTradesResult = { attempted: 0, closed: 0, failed: 0, messages: [] };
  const today = earningsSessionDate();

  const orders = await loadOpenOrders(sb, userId);
  if (!orders.length) return result;

  const timings = await timingLookup(sb, userId, orders);

  for (const order of orders) {
    const timing = timings.get(`${order.ticker}:${order.earnings_date}`) ?? 'UNK';
    const exitDate = tradeExitDate(order.earnings_date, timing);
    if (today < exitDate) continue;

    result.attempted += 1;
    const outcome = await closeTradeOrder(sb, userId, { ...order, qty: Number(order.qty) });
    result.messages.push(outcome.detail);
    if (outcome.ok) result.closed += 1;
    else result.failed += 1;
  }

  return result;
}
