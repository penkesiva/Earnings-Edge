'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthSession } from '@/lib/authServer';
import {
  getOrCreateAutomationSettings,
  listRecentTradeOrders,
  updateAutomationSettings,
} from '@/lib/automationSettings';
import { executeAutoTrades } from '@/lib/autoTradeExecutor';
import { loadGoTradeCandidates } from '@/lib/goTradeCandidates';
import { listAlpacaAccountSummaries } from '@/lib/alpacaCredentials';

export type TradePageState = {
  error?: string;
  success?: string;
};

export async function loadTradePageData() {
  const { sb, user } = await requireAuthSession();
  const [settings, candidates, orders, alpacaSummaries] = await Promise.all([
    getOrCreateAutomationSettings(sb, user.id),
    loadGoTradeCandidates(sb, user.id),
    listRecentTradeOrders(sb, user.id),
    listAlpacaAccountSummaries(user.id),
  ]);

  const paperConfigured = alpacaSummaries.some(
    s => s.environment === 'paper' && s.configured,
  );

  return { settings, candidates, orders, paperConfigured };
}

export async function toggleAutoTradeAction(
  _prev: TradePageState,
  formData: FormData,
): Promise<TradePageState> {
  const { sb, user } = await requireAuthSession();
  const enabled = formData.get('enabled') === 'true';

  try {
    await updateAutomationSettings(sb, user.id, { autoTradeEnabled: enabled });
    revalidatePath('/trade');
    return {
      success: enabled
        ? 'Auto-trade enabled (paper only until live is confirmed).'
        : 'Auto-trade disabled.',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleKillSwitchAction(
  _prev: TradePageState,
  formData: FormData,
): Promise<TradePageState> {
  const { sb, user } = await requireAuthSession();
  const on = formData.get('on') === 'true';

  try {
    await updateAutomationSettings(sb, user.id, { killSwitch: on });
    revalidatePath('/trade');
    return {
      success: on
        ? 'Kill switch ON — all new orders blocked.'
        : 'Kill switch OFF — trading can resume.',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function enableLiveTradingAction(
  _prev: TradePageState,
  formData: FormData,
): Promise<TradePageState> {
  const { sb, user } = await requireAuthSession();
  const confirm = String(formData.get('confirm') ?? '').trim().toUpperCase();
  const enable = formData.get('enable') === 'true';

  if (enable && confirm !== 'ENABLE LIVE') {
    return { error: 'Type ENABLE LIVE to confirm real-money trading.' };
  }

  try {
    if (enable) {
      const summaries = await listAlpacaAccountSummaries(user.id);
      const liveOk = summaries.some(s => s.environment === 'live' && s.configured);
      if (!liveOk) {
        return { error: 'Add Live Alpaca keys in Settings first.' };
      }
    }

    await updateAutomationSettings(sb, user.id, { liveTradingEnabled: enable });
    revalidatePath('/trade');
    revalidatePath('/settings');
    return {
      success: enable
        ? 'Live trading enabled — orders may use your live Alpaca account.'
        : 'Live trading disabled — paper only.',
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateMaxNotionalAction(
  _prev: TradePageState,
  formData: FormData,
): Promise<TradePageState> {
  const { sb, user } = await requireAuthSession();
  const raw = Number(formData.get('max_notional_usd'));
  if (!Number.isFinite(raw)) return { error: 'Enter a valid dollar amount.' };

  try {
    await updateAutomationSettings(sb, user.id, { maxNotionalUsd: raw });
    revalidatePath('/trade');
    return { success: `Max notional set to $${Math.round(raw).toLocaleString()}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runAutoTradeNowAction(
  _prev: TradePageState,
): Promise<TradePageState> {
  const { sb, user } = await requireAuthSession();

  try {
    const result = await executeAutoTrades(sb, user.id, { manual: true });
    revalidatePath('/trade');
    const msg = result.messages.join(' ') || 'Run complete.';
    if (result.failed > 0) return { error: msg };
    if (result.submitted === 0 && result.skipped === result.attempted && result.attempted > 0) {
      return { success: msg };
    }
    return { success: msg };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
