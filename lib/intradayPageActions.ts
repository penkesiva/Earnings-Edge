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
import {
  compareEmaTrendDayBacktest,
  formatCompareMetricsLine,
} from '@/lib/intraday/backtest/compareEmaTrend';
import {
  compareTrendResumptionBacktest,
  formatTrendResumptionCompare,
} from '@/lib/intraday/backtest/compareTrendResumption';
import { validateTradingBudget } from '@/lib/intraday/sizing/computeShares';
import { INTRADAY_STRATEGIES, strategyLabel } from '@/lib/intraday/strategies/registry';
import { runEmaV2ForensicsReport } from '@/lib/intraday/diagnostics/runEmaV2ForensicsReport';
import { validateIntradayTicker, normalizeTickerInput } from '@/lib/intraday/validateIntradayTicker';
import { INTRADAY_STRATEGY_VWAP_OR_V1 } from '@/lib/intraday/types';
import type { BacktestTrade } from '@/lib/intraday/types';
import { revalidatePath } from 'next/cache';

export type IntradayPageState = {
  error?: string;
  success?: string;
  /** Backtest / save success styling when P&L or outcome is negative. */
  successTone?: 'profit' | 'loss' | 'neutral';
  /** Full markdown from V2 forensics (client opens modal). */
  forensicsMarkdown?: string;
};

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
        .select(
          'id, symbol, strategy_id, calendar_days, status, metrics, trades, error_message, started_at, completed_at',
        )
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
  if (!auth) return { error: 'Add Alpaca keys in Settings first.' };

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

  if (!INTRADAY_STRATEGIES.some(s => s.id === strategyId)) {
    return { error: 'Unknown strategy.' };
  }

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
      strategyId,
    });

    if (result.daysWithData === 0) {
      const hint = result.errors[0] ? ` ${result.errors[0]}` : '';
      await sb
        .from('intraday_backtest_runs')
        .update({
          status: 'failed',
          error_message: `No sessions with enough bar data.${hint}`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runRow.id);
      return { error: `No trading days with data for ${validated.ticker.symbol}.${hint}` };
    }

    await sb
      .from('intraday_backtest_runs')
      .update({
        status: 'completed',
        metrics: {
          ...result.metrics,
          ...(result.signalLogSample ? { signalLogSample: result.signalLogSample } : {}),
        },
        trades: result.trades,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runRow.id);

    revalidatePath('/intraday');
    const errNote =
      result.errors.length > 0 ? ` (${result.errors.length} day fetch warning(s).)` : '';
    return {
      success: `${strategyLabel(strategyId)} backtest: ${result.metrics.trades} trades over ${result.daysWithData} sessions · P&L $${result.metrics.totalPnlUsd.toFixed(2)}.${errNote}`,
      successTone: result.metrics.totalPnlUsd < 0 ? 'loss' : result.metrics.totalPnlUsd > 0 ? 'profit' : 'neutral',
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

export type IntradayChartDayPayload = {
  sessionDate: string;
  symbol: string;
  candles: import('@/lib/intraday/chart/chartDayPayload').ChartBarPoint[];
  ema9: import('@/lib/intraday/chart/chartDayPayload').ChartLinePoint[];
  ema20: import('@/lib/intraday/chart/chartDayPayload').ChartLinePoint[];
  markers: import('@/lib/intraday/chart/chartDayPayload').ChartMarkerPoint[];
};

export async function loadIntradayBacktestChartDayAction(
  symbol: string,
  sessionDate: string,
  tradesJson: BacktestTrade[],
): Promise<{ error?: string; data?: IntradayChartDayPayload }> {
  const { user } = await requireAuthSession();
  const sym = normalizeTickerInput(symbol);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return { error: 'Invalid session date.' };
  }

  let auth;
  try {
    auth = await resolveAlpacaAuthForUser(user.id);
  } catch {
    return { error: 'Add Alpaca keys in Settings to load chart data.' };
  }
  if (!auth) return { error: 'Alpaca keys required for chart data.' };

  try {
    const { fetchMinuteBarsForDay } = await import('@/lib/intraday/data/bars');
    const { filterRegularSessionBars, computeSessionIndicators } = await import(
      '@/lib/intraday/indicators/engine'
    );
    const {
      toCandlePoints,
      toLinePoints,
      markersForSessionTrades,
    } = await import('@/lib/intraday/chart/chartDayPayload');

    const raw = await fetchMinuteBarsForDay(sym, sessionDate, auth);
    const bars = filterRegularSessionBars(raw, sessionDate);
    if (bars.length < 10) {
      return { error: 'Not enough bar data for this session.' };
    }

    const ind = computeSessionIndicators(bars);
    const dayTrades = tradesJson.filter(t => t.sessionDate === sessionDate);

    return {
      data: {
        sessionDate,
        symbol: sym,
        candles: toCandlePoints(bars),
        ema9: toLinePoints(bars, ind.ema9),
        ema20: toLinePoints(bars, ind.ema20),
        markers: markersForSessionTrades(sessionDate, bars, dayTrades),
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Same symbol/days/budget — runs ema_trend_day_v1 and v2 in memory (no DB row). */
export async function compareEmaTrendBacktestAction(
  _prev: IntradayPageState,
  formData: FormData,
): Promise<IntradayPageState> {
  const { user } = await requireAuthSession();

  const symbol = normalizeTickerInput(String(formData.get('symbol') ?? ''));
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
    return { error: 'Alpaca keys required.' };
  }
  if (!auth) return { error: 'Alpaca keys required.' };

  const validated = await validateIntradayTicker(symbol, auth);
  if (!validated.ok) return { error: validated.error };

  try {
    const cmp = await compareEmaTrendDayBacktest({
      symbol: validated.ticker.symbol,
      calendarDays,
      effectiveBudgetUsd: budgetCheck.effectiveUsd,
      auth,
    });
    const v1 = cmp.v1;
    const lines = [
      `EMA compare (${cmp.daysWithData} sessions, ${validated.ticker.symbol})`,
      formatCompareMetricsLine('v1', v1),
      formatCompareMetricsLine('v2 EMA_ONLY', cmp.v2Modes.EMA_ONLY),
      formatCompareMetricsLine('v2 EMA_REGIME', cmp.v2Modes.EMA_REGIME),
      formatCompareMetricsLine('v2 EMA_REGIME_MOMENTUM', cmp.v2Modes.EMA_REGIME_MOMENTUM),
      'Momentum threshold sensitivity (EMA_REGIME_MOMENTUM):',
      ...cmp.momentumSensitivity.map(
        s =>
          `  min ${s.minMomentumScore}: ${s.metrics.trades} tr, P&L $${s.metrics.totalPnlUsd.toFixed(2)}, WR ${s.metrics.winRate?.toFixed(1) ?? '—'}%, PF ${s.metrics.profitFactor?.toFixed(2) ?? '—'}, exp $${s.metrics.expectancyPerTrade?.toFixed(2) ?? '—'}, DD $${s.metrics.maxDrawdownUsd.toFixed(2)}`,
      ),
    ];
    const bestV2 = cmp.v2Modes.EMA_REGIME_MOMENTUM;
    return {
      success: lines.join('\n'),
      successTone:
        bestV2.totalPnlUsd > v1.totalPnlUsd ? 'profit' : bestV2.totalPnlUsd < v1.totalPnlUsd ? 'loss' : 'neutral',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** 30 / 90 / 180 calendar days — ema v1, v2, trend_resumption early & confirmed (in memory). */
export async function compareTrendResumptionBacktestAction(
  _prev: IntradayPageState,
  formData: FormData,
): Promise<IntradayPageState> {
  const { user } = await requireAuthSession();

  const symbol = normalizeTickerInput(String(formData.get('symbol') ?? ''));
  const budgetCheck = validateTradingBudget(
    formData.get('trading_budget_usd'),
    formData.get('deploy_pct'),
  );
  if (!budgetCheck.ok) return { error: budgetCheck.error };

  let auth;
  try {
    auth = await resolveAlpacaAuthForUser(user.id);
  } catch {
    return { error: 'Alpaca keys required.' };
  }
  if (!auth) return { error: 'Alpaca keys required.' };

  const validated = await validateIntradayTicker(symbol, auth);
  if (!validated.ok) return { error: validated.error };

  try {
    const cmp = await compareTrendResumptionBacktest({
      symbol: validated.ticker.symbol,
      effectiveBudgetUsd: budgetCheck.effectiveUsd,
      auth,
    });
    return {
      success: formatTrendResumptionCompare(cmp),
      successTone: 'neutral',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Deep v2 diagnostic report (entry/post-entry/rejects/variants). Does not tune config. */
export async function runEmaV2ForensicsAction(
  _prev: IntradayPageState,
  formData: FormData,
): Promise<IntradayPageState> {
  const { user } = await requireAuthSession();

  const symbol = normalizeTickerInput(String(formData.get('symbol') ?? ''));
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
    return { error: 'Alpaca keys required.' };
  }
  if (!auth) return { error: 'Alpaca keys required.' };

  const validated = await validateIntradayTicker(symbol, auth);
  if (!validated.ok) return { error: validated.error };

  try {
    const report = await runEmaV2ForensicsReport({
      symbol: validated.ticker.symbol,
      calendarDays,
      effectiveBudgetUsd: budgetCheck.effectiveUsd,
      auth,
    });
    return {
      success: report.executiveSummary,
      forensicsMarkdown: report.markdown,
      successTone: 'neutral',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
