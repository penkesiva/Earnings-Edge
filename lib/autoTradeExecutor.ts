import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrCreateAutomationSettings,
  type AutomationSettings,
} from '@/lib/automationSettings';
import { resolveAlpacaAuthForUser } from '@/lib/alpacaCredentials';
import { getStockSnapshot } from '@/lib/alpaca';
import { getTradingAccount, placeMarketOrder } from '@/lib/alpacaTrading';
import { loadGoTradeCandidates, type GoTradeCandidate } from '@/lib/goTradeCandidates';

export type TradeExecutionResult = {
  attempted: number;
  submitted: number;
  failed: number;
  skipped: number;
  messages: string[];
};

export type ExecuteAutoTradeOptions = {
  /** When true, validate only — no Alpaca orders or DB writes. */
  dryRun?: boolean;
  /** Manual run bypasses auto_trade_enabled but still respects kill switch. */
  manual?: boolean;
};

export async function executeAutoTrades(
  sb: SupabaseClient,
  userId: string,
  options: ExecuteAutoTradeOptions = {},
): Promise<TradeExecutionResult> {
  const settings = await getOrCreateAutomationSettings(sb, userId);
  const result: TradeExecutionResult = {
    attempted: 0,
    submitted: 0,
    failed: 0,
    skipped: 0,
    messages: [],
  };

  if (settings.killSwitch) {
    result.messages.push('Kill switch is ON — no orders placed.');
    return result;
  }

  if (!options.manual && !settings.autoTradeEnabled) {
    result.messages.push('Auto-trade is OFF — enable it or use Run now.');
    return result;
  }

  const candidates = await loadGoTradeCandidates(sb, userId);
  if (candidates.length === 0) {
    result.messages.push('No consensus GO candidates in the next 2 trading days.');
    return result;
  }

  const auth = await resolveTradeAuth(userId, settings);
  if (!auth) {
    result.messages.push('Add Paper Alpaca keys in Settings before trading.');
    return result;
  }

  const account = await getTradingAccount(auth);
  if (!account || account.status !== 'ACTIVE') {
    result.messages.push('Alpaca account is not active — check Settings.');
    return result;
  }

  if (options.dryRun) {
    result.attempted = candidates.length;
    result.skipped = candidates.length;
    result.messages.push(
      `Dry run: ${candidates.length} GO candidate(s) ready on ${auth.environment ?? 'paper'}.`,
    );
    return result;
  }

  for (const candidate of candidates) {
    result.attempted += 1;
    const outcome = await executeOneTrade(sb, userId, settings, auth, candidate);
    result.messages.push(outcome.detail);
    if (outcome.status === 'submitted') result.submitted += 1;
    else if (outcome.status === 'failed') result.failed += 1;
    else result.skipped += 1;
  }

  return result;
}

async function resolveTradeAuth(userId: string, settings: AutomationSettings) {
  if (settings.liveTradingEnabled) {
    return resolveAlpacaAuthForUser(userId);
  }
  return resolveAlpacaAuthForUser(userId, 'paper');
}

type TradeOutcome = {
  status: 'submitted' | 'failed' | 'skipped';
  /** One-line summary for the Trade page flash and WhatsApp notification. */
  detail: string;
};

async function executeOneTrade(
  sb: SupabaseClient,
  userId: string,
  settings: AutomationSettings,
  auth: NonNullable<Awaited<ReturnType<typeof resolveTradeAuth>>>,
  candidate: GoTradeCandidate,
): Promise<TradeOutcome> {
  const environment = auth.environment ?? 'paper';
  if (!settings.liveTradingEnabled && environment === 'live') {
    await insertSkippedOrder(sb, userId, candidate, environment, 'Live trading not enabled.');
    return { status: 'skipped', detail: `${candidate.ticker}: skipped — live trading not enabled.` };
  }

  let price: number;
  try {
    const snap = await getStockSnapshot(candidate.ticker, auth);
    price = snap.price;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertFailedOrder(sb, userId, candidate, environment, msg);
    return { status: 'failed', detail: `${candidate.ticker}: failed — ${msg}` };
  }

  if (!price || price <= 0) {
    await insertFailedOrder(sb, userId, candidate, environment, 'Could not fetch live price.');
    return { status: 'failed', detail: `${candidate.ticker}: failed — no live price.` };
  }

  const qty = Math.floor(settings.maxNotionalUsd / price);
  if (qty < 1) {
    const reason = `Notional $${settings.maxNotionalUsd} too small at $${price.toFixed(2)}.`;
    await insertSkippedOrder(sb, userId, candidate, environment, reason);
    return { status: 'skipped', detail: `${candidate.ticker}: skipped — ${reason}` };
  }

  const side = candidate.direction === 'UP' ? 'buy' : 'sell';
  const placed = await placeMarketOrder(auth, {
    symbol: candidate.ticker,
    qty,
    side,
  });

  if (!placed.ok) {
    await insertFailedOrder(sb, userId, candidate, environment, placed.error);
    return { status: 'failed', detail: `${candidate.ticker}: failed — ${placed.error.slice(0, 120)}` };
  }

  const notional = Math.round(qty * price * 100) / 100;
  const status =
    placed.order.status === 'filled' || placed.order.status === 'partially_filled'
      ? 'filled'
      : 'submitted';

  const { error } = await sb.from('trade_orders').insert({
    user_id: userId,
    brief_id: candidate.briefId,
    ticker: candidate.ticker,
    earnings_date: candidate.earningsDate,
    environment,
    direction: candidate.direction,
    verdict: 'GO',
    side,
    qty,
    notional_usd: notional,
    alpaca_order_id: placed.order.id,
    status,
  });

  const detail = `${candidate.ticker}: ${side.toUpperCase()} ${qty} @ ~$${price.toFixed(2)} (~$${notional}) ${status} [${environment}]`;
  if (error) {
    return { status: 'failed', detail: `${detail} — order log write failed: ${error.message}` };
  }

  return { status: 'submitted', detail };
}

async function insertFailedOrder(
  sb: SupabaseClient,
  userId: string,
  candidate: GoTradeCandidate,
  environment: string,
  errorMessage: string,
) {
  await sb.from('trade_orders').upsert(
    {
      user_id: userId,
      brief_id: candidate.briefId,
      ticker: candidate.ticker,
      earnings_date: candidate.earningsDate,
      environment,
      direction: candidate.direction,
      verdict: 'GO',
      side: candidate.direction === 'UP' ? 'buy' : 'sell',
      qty: 0,
      status: 'failed',
      error_message: errorMessage.slice(0, 500),
    },
    { onConflict: 'user_id,brief_id' },
  );
}

async function insertSkippedOrder(
  sb: SupabaseClient,
  userId: string,
  candidate: GoTradeCandidate,
  environment: string,
  reason: string,
) {
  await sb.from('trade_orders').upsert(
    {
      user_id: userId,
      brief_id: candidate.briefId,
      ticker: candidate.ticker,
      earnings_date: candidate.earningsDate,
      environment,
      direction: candidate.direction,
      verdict: 'GO',
      side: candidate.direction === 'UP' ? 'buy' : 'sell',
      qty: 0,
      status: 'skipped',
      error_message: reason.slice(0, 500),
    },
    { onConflict: 'user_id,brief_id' },
  );
}
