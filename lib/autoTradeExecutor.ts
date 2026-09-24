import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrCreateAutomationSettings,
  type AutomationSettings,
} from '@/lib/automationSettings';
import {
  estimateOptionNotional,
  resolveOptionExecution,
  resolvePlanExpiry,
  resolveTradeLegsForAutoTrade,
} from '@/lib/consensusOptionExecution';
import { resolveAlpacaAuthForUser } from '@/lib/alpacaCredentials';
import { getOptionChain, getStockSnapshot } from '@/lib/alpaca';
import {
  getTradingAccount,
  placeMarketOrder,
  placeOptionMarketOrder,
  placeOptionMultiLegOrder,
} from '@/lib/alpacaTrading';
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
    result.messages.push('No GO/WATCH trade candidates in the next 2 trading days.');
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
      `Dry run: ${candidates.length} candidate(s) ready on ${auth.environment ?? 'paper'}.`,
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

  if (candidate.executionMode === 'options') {
    return executeOptionTrade(sb, userId, settings, auth, candidate, environment);
  }

  return executeEquityTrade(sb, userId, settings, auth, candidate, environment);
}

async function executeEquityTrade(
  sb: SupabaseClient,
  userId: string,
  settings: AutomationSettings,
  auth: NonNullable<Awaited<ReturnType<typeof resolveTradeAuth>>>,
  candidate: GoTradeCandidate,
  environment: string,
): Promise<TradeOutcome> {
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
    verdict: candidate.verdict,
    side,
    qty,
    notional_usd: notional,
    alpaca_order_id: placed.order.id,
    status,
    instrument_type: 'equity',
  });

  const detail = `${candidate.ticker}: ${side.toUpperCase()} ${qty} sh @ ~$${price.toFixed(2)} (~$${notional}) ${status} [${environment}]`;
  if (error) {
    return { status: 'failed', detail: `${detail} — order log write failed: ${error.message}` };
  }

  return { status: 'submitted', detail };
}

async function executeOptionTrade(
  sb: SupabaseClient,
  userId: string,
  settings: AutomationSettings,
  auth: NonNullable<Awaited<ReturnType<typeof resolveTradeAuth>>>,
  candidate: GoTradeCandidate,
  environment: string,
): Promise<TradeOutcome> {
  const tradeLegs = resolveTradeLegsForAutoTrade(
    candidate.verdict,
    candidate.direction,
    candidate.tradePlan,
    candidate.suggestedStructure,
  );
  if (!tradeLegs.length) {
    const reason = 'No executable option legs on consensus.';
    await insertSkippedOrder(sb, userId, candidate, environment, reason);
    return { status: 'skipped', detail: `${candidate.ticker}: skipped — ${reason}` };
  }

  const expiryHint =
    candidate.tradePlan?.expiry ??
    candidate.suggestedStructure?.preferredExpiry ??
    candidate.earningsDate;
  const expiryGte = /^\d{4}-\d{2}-\d{2}$/.test(expiryHint) ? expiryHint : candidate.earningsDate;

  let chain;
  try {
    chain = await getOptionChain(candidate.ticker, expiryGte, 0.2, auth);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await insertFailedOrder(sb, userId, candidate, environment, msg);
    return { status: 'failed', detail: `${candidate.ticker}: options chain — ${msg.slice(0, 100)}` };
  }

  const expiry = resolvePlanExpiry(candidate.tradePlan, candidate.suggestedStructure, chain.expiry);
  const resolved = resolveOptionExecution(candidate.ticker, chain, tradeLegs, expiry);
  if (!resolved?.legs.length) {
    await insertFailedOrder(sb, userId, candidate, environment, 'Could not map legs to option symbols.');
    return { status: 'failed', detail: `${candidate.ticker}: failed — no matching option contracts.` };
  }

  const perContract = estimateOptionNotional(chain, resolved.legs);
  const contracts = Math.max(1, Math.floor(settings.maxNotionalUsd / perContract));
  const limitPrice = parseTradeLimitPrice(candidate.tradePlan?.limit ?? null);

  const placed =
    resolved.legs.length === 1
      ? await placeOptionMarketOrder(auth, {
          symbol: resolved.legs[0].occSymbol,
          qty: contracts,
          side: resolved.legs[0].side,
        })
      : await placeOptionMultiLegOrder(auth, {
          qty: contracts,
          legs: resolved.legs.map(l => ({ symbol: l.occSymbol, side: l.side })),
          limitPrice,
        });

  if (!placed.ok) {
    await insertFailedOrder(sb, userId, candidate, environment, placed.error);
    return { status: 'failed', detail: `${candidate.ticker}: options — ${placed.error.slice(0, 120)}` };
  }

  const primarySide = resolved.legs[0].side;
  const notional = Math.round(contracts * perContract * 100) / 100;
  const status =
    placed.order.status === 'filled' || placed.order.status === 'partially_filled'
      ? 'filled'
      : 'submitted';

  const instrumentType = resolved.legs.length === 1 ? 'option_single' : 'option_mleg';
  const optionLegsJson = resolved.legs.map(l => ({
    symbol: l.occSymbol,
    side: l.side,
  }));

  const { error } = await sb.from('trade_orders').insert({
    user_id: userId,
    brief_id: candidate.briefId,
    ticker: candidate.ticker,
    earnings_date: candidate.earningsDate,
    environment,
    direction: candidate.direction,
    verdict: candidate.verdict,
    side: primarySide,
    qty: contracts,
    notional_usd: notional,
    alpaca_order_id: placed.order.id,
    status,
    instrument_type: instrumentType,
    option_legs: optionLegsJson,
  });

  const legLabel = candidate.legSummary ?? `${contracts} contract(s)`;
  const detail = `${candidate.ticker}: ${candidate.verdict} ${legLabel} ×${contracts} ${status} [${environment}]`;
  if (error) {
    return { status: 'failed', detail: `${detail} — log failed: ${error.message}` };
  }

  return { status: 'submitted', detail };
}

function parseTradeLimitPrice(limit: string | null): number | null {
  if (!limit?.trim()) return null;
  const m = limit.match(/\$?\s*([\d.]+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
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
      verdict: candidate.verdict,
      side: candidate.direction === 'UP' ? 'buy' : 'sell',
      qty: 0,
      status: 'failed',
      error_message: errorMessage.slice(0, 500),
      instrument_type: candidate.executionMode === 'options' ? 'option_single' : 'equity',
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
      verdict: candidate.verdict,
      side: candidate.direction === 'UP' ? 'buy' : 'sell',
      qty: 0,
      status: 'skipped',
      error_message: reason.slice(0, 500),
      instrument_type: candidate.executionMode === 'options' ? 'option_single' : 'equity',
    },
    { onConflict: 'user_id,brief_id' },
  );
}
