'use server';

import { requireAuthSession } from '@/lib/authServer';
import { resolveAlpacaAuthForUser } from '@/lib/alpacaCredentials';
import { getOrCreateAutomationSettings } from '@/lib/automationSettings';
import {
  MAX_BACKTEST_DAYS,
  MIN_BACKTEST_DAYS,
  DEFAULT_INTRADAY_CONFIG,
} from '@/lib/intraday/config/defaults';
import { runIntradayBacktest } from '@/lib/intraday/backtest/runBacktest';
import { validateTradingBudget } from '@/lib/intraday/sizing/computeShares';
import { INTRADAY_STRATEGIES } from '@/lib/intraday/strategies/registry';
import { validateIntradayTicker, normalizeTickerInput } from '@/lib/intraday/validateIntradayTicker';
import { INTRADAY_STRATEGY_VWAP_OR_V1 } from '@/lib/intraday/types';
import { revalidatePath } from 'next/cache';

export type IntradayPageState = { error?: string; success?: string };

export async function loadIntradayPageData() {
  const { sb, user } = await requireAuthSession();
  const automation = await getOrCreateAutomationSettings(sb, user.id);

  const probe = await sb.from('intraday_settings').select('*', { head: true, count: 'exact' });
  const migrationRequired = Boolean(
    probe.error && /relation|does not exist/i.test(probe.error.message),
  );

  const { data: settings } = await sb
    .from('intraday_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: runs } = migrationRequired
    ? { data: [] }
    : await sb
        .from('intraday_backtest_runs')
        .select('id, symbol, calendar_days, status, metrics, trades, started_at, completed_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(8);

  let paperConfigured = false;
  try {
    const auth = await resolveAlpacaAuthForUser(user.id);
    paperConfigured = Boolean(auth);
  } catch {
    paperConfigured = false;
  }

  return {
    migrationRequired,
    strategies: INTRADAY_STRATEGIES,
    settings,
    runs: runs ?? [],
    liveTradingEnabled: automation.liveTradingEnabled,
    paperConfigured,
    defaultConfig: DEFAULT_INTRADAY_CONFIG,
  };
}

export async function saveIntradaySettingsAction(
  _prev: IntradayPageState,
  formData: FormData,
): Promise<IntradayPageState> {
  const { sb, user } = await requireAuthSession();

  const symbol = normalizeTickerInput(String(formData.get('symbol') ?? ''));
  const strategyId = String(formData.get('strategy_id') ?? INTRADAY_STRATEGY_VWAP_OR_V1);
  const budgetCheck = validateTradingBudget(
    formData.get('trading_budget_usd'),
    formData.get('deploy_pct'),
  );
  if (!budgetCheck.ok) return { error: budgetCheck.error };

  if (!INTRADAY_STRATEGIES.some(s => s.id === strategyId)) {
    return { error: 'Unknown strategy.' };
  }

  let auth = null;
  try {
    auth = await resolveAlpacaAuthForUser(user.id);
  } catch {
    return { error: 'Add Alpaca keys in Settings first.' };
  }

  const validated = await validateIntradayTicker(symbol, auth);
  if (!validated.ok) return { error: validated.error };

  const automationEnabled = formData.get('automation_enabled') === 'on';

  const { error } = await sb.from('intraday_settings').upsert(
    {
      user_id: user.id,
      strategy_id: strategyId,
      symbol: validated.ticker.symbol,
      company_name: validated.ticker.companyName,
      trading_budget_usd: budgetCheck.budgetUsd,
      deploy_pct: budgetCheck.deployPct,
      automation_enabled: automationEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) return { error: error.message };
  revalidatePath('/intraday');
  return {
    success: `Saved ${validated.ticker.symbol}${validated.ticker.companyName ? ` (${validated.ticker.companyName})` : ''} · $${budgetCheck.budgetUsd.toLocaleString()} @ ${budgetCheck.deployPct}% deploy.`,
  };
}

export async function runIntradayBacktestAction(
  _prev: IntradayPageState,
  formData: FormData,
): Promise<IntradayPageState> {
  const { sb, user } = await requireAuthSession();

  const symbol = normalizeTickerInput(String(formData.get('symbol') ?? ''));
  const strategyId = String(formData.get('strategy_id') ?? INTRADAY_STRATEGY_VWAP_OR_V1);
  const daysRaw = Number(formData.get('calendar_days'));
  const calendarDays = Number.isFinite(daysRaw) ? Math.round(daysRaw) : 30;

  if (calendarDays < MIN_BACKTEST_DAYS || calendarDays > MAX_BACKTEST_DAYS) {
    return { error: `Backtest days must be ${MIN_BACKTEST_DAYS}–${MAX_BACKTEST_DAYS}.` };
  }

  const budgetCheck = validateTradingBudget(
    formData.get('trading_budget_usd'),
    formData.get('deploy_pct'),
  );
  if (!budgetCheck.ok) return { error: budgetCheck.error };

  let auth;
  try {
    auth = await resolveAlpacaAuthForUser(user.id);
  } catch {
    return { error: 'Alpaca keys required for backtest data.' };
  }
  if (!auth) return { error: 'Alpaca keys required for backtest data.' };

  const validated = await validateIntradayTicker(symbol, auth);
  if (!validated.ok) return { error: validated.error };

  const { data: runRow, error: insErr } = await sb
    .from('intraday_backtest_runs')
    .insert({
      user_id: user.id,
      strategy_id: strategyId,
      symbol: validated.ticker.symbol,
      company_name: validated.ticker.companyName,
      calendar_days: calendarDays,
      status: 'running',
    })
    .select('id')
    .single();

  if (insErr) return { error: insErr.message };

  try {
    const result = await runIntradayBacktest({
      symbol: validated.ticker.symbol,
      calendarDays,
      effectiveBudgetUsd: budgetCheck.effectiveUsd,
      auth,
    });

    await sb
      .from('intraday_backtest_runs')
      .update({
        status: 'completed',
        metrics: result.metrics,
        trades: result.trades,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runRow.id);

    revalidatePath('/intraday');
    return {
      success: `Backtest done: ${result.metrics.trades} trades over ${result.daysWithData} sessions · P&L $${result.metrics.totalPnlUsd.toFixed(2)}.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from('intraday_backtest_runs')
      .update({ status: 'failed', error_message: msg, completed_at: new Date().toISOString() })
      .eq('id', runRow.id);
    return { error: msg };
  }
}
