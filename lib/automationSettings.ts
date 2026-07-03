import type { SupabaseClient } from '@supabase/supabase-js';

export type AutomationSettings = {
  userId: string;
  autoTradeEnabled: boolean;
  killSwitch: boolean;
  liveTradingEnabled: boolean;
  maxNotionalUsd: number;
  updatedAt: string;
};

export type TradeOrderRow = {
  id: string;
  briefId: string;
  ticker: string;
  earningsDate: string;
  environment: 'paper' | 'live';
  direction: 'UP' | 'DOWN';
  verdict: string;
  side: 'buy' | 'sell';
  qty: number;
  notionalUsd: number | null;
  alpacaOrderId: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

type SettingsRow = {
  user_id: string;
  auto_trade_enabled: boolean;
  kill_switch: boolean;
  live_trading_enabled: boolean;
  max_notional_usd: number;
  updated_at: string;
};

type OrderRow = {
  id: string;
  brief_id: string;
  ticker: string;
  earnings_date: string;
  environment: 'paper' | 'live';
  direction: 'UP' | 'DOWN';
  verdict: string;
  side: 'buy' | 'sell';
  qty: number;
  notional_usd: number | null;
  alpaca_order_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

function mapSettings(row: SettingsRow): AutomationSettings {
  return {
    userId: row.user_id,
    autoTradeEnabled: row.auto_trade_enabled,
    killSwitch: row.kill_switch,
    liveTradingEnabled: row.live_trading_enabled,
    maxNotionalUsd: Number(row.max_notional_usd),
    updatedAt: row.updated_at,
  };
}

function mapOrder(row: OrderRow): TradeOrderRow {
  return {
    id: row.id,
    briefId: row.brief_id,
    ticker: row.ticker,
    earningsDate: row.earnings_date,
    environment: row.environment,
    direction: row.direction,
    verdict: row.verdict,
    side: row.side,
    qty: Number(row.qty),
    notionalUsd: row.notional_usd != null ? Number(row.notional_usd) : null,
    alpacaOrderId: row.alpaca_order_id,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export async function getOrCreateAutomationSettings(
  sb: SupabaseClient,
  userId: string,
): Promise<AutomationSettings> {
  const { data, error } = await sb
    .from('automation_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return mapSettings(data as SettingsRow);

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await sb
    .from('automation_settings')
    .insert({ user_id: userId, updated_at: now })
    .select('*')
    .single();

  if (insertError) throw new Error(insertError.message);
  return mapSettings(inserted as SettingsRow);
}

export async function updateAutomationSettings(
  sb: SupabaseClient,
  userId: string,
  patch: Partial<{
    autoTradeEnabled: boolean;
    killSwitch: boolean;
    liveTradingEnabled: boolean;
    maxNotionalUsd: number;
  }>,
): Promise<AutomationSettings> {
  await getOrCreateAutomationSettings(sb, userId);

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.autoTradeEnabled !== undefined) {
    payload.auto_trade_enabled = patch.autoTradeEnabled;
  }
  if (patch.killSwitch !== undefined) payload.kill_switch = patch.killSwitch;
  if (patch.liveTradingEnabled !== undefined) {
    payload.live_trading_enabled = patch.liveTradingEnabled;
  }
  if (patch.maxNotionalUsd !== undefined) {
    const n = Math.round(patch.maxNotionalUsd);
    if (n < 100 || n > 100_000) {
      throw new Error('Max notional must be between $100 and $100,000.');
    }
    payload.max_notional_usd = n;
  }

  const { data, error } = await sb
    .from('automation_settings')
    .update(payload)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return mapSettings(data as SettingsRow);
}

export async function listRecentTradeOrders(
  sb: SupabaseClient,
  userId: string,
  limit = 30,
): Promise<TradeOrderRow[]> {
  const { data, error } = await sb
    .from('trade_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map(row => mapOrder(row as OrderRow));
}

export async function getTradedBriefIds(
  sb: SupabaseClient,
  userId: string,
  briefIds: string[],
): Promise<Set<string>> {
  if (briefIds.length === 0) return new Set();
  const { data, error } = await sb
    .from('trade_orders')
    .select('brief_id')
    .eq('user_id', userId)
    .in('brief_id', briefIds);

  if (error) throw new Error(error.message);
  return new Set((data ?? []).map(r => r.brief_id as string));
}
