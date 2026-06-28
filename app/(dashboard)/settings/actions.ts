'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthSession } from '@/lib/authServer';
import {
  listAlpacaAccountSummaries,
  removeAlpacaCredentials,
  saveAlpacaCredentials,
  setAlpacaTradeDefault,
  updateAlpacaCredentials,
  type AlpacaAccountSummary,
  type AlpacaEnvironment,
} from '@/lib/alpacaCredentials';

export type AlpacaSettingsState = {
  error?: string;
  success?: string;
  summaries?: AlpacaAccountSummary[];
};

export async function getAlpacaSettings(): Promise<AlpacaAccountSummary[]> {
  const { user } = await requireAuthSession();
  return listAlpacaAccountSummaries(user.id);
}

function parseEnvironment(raw: FormDataEntryValue | null): AlpacaEnvironment | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'paper' || value === 'live') return value;
  return null;
}

export async function saveAlpacaAccountAction(
  _prev: AlpacaSettingsState,
  formData: FormData,
): Promise<AlpacaSettingsState> {
  const { sb, user } = await requireAuthSession();
  const environment = parseEnvironment(formData.get('environment'));
  if (!environment) return { error: 'Invalid account type.' };

  const apiKeyId = String(formData.get('api_key_id') ?? '').trim();
  const apiSecret = String(formData.get('api_secret') ?? '').trim();

  const result = apiSecret
    ? await saveAlpacaCredentials(sb, user.id, environment, apiKeyId, apiSecret)
    : await updateAlpacaCredentials(sb, user.id, environment, apiKeyId);

  if (!result.ok) return { error: result.error };

  revalidatePath('/settings');
  return {
    success: `${environment === 'paper' ? 'Paper' : 'Live'} account saved and verified.`,
    summaries: await listAlpacaAccountSummaries(user.id),
  };
}

export async function removeAlpacaAccountAction(
  _prev: AlpacaSettingsState,
  formData: FormData,
): Promise<AlpacaSettingsState> {
  const { sb, user } = await requireAuthSession();
  const environment = parseEnvironment(formData.get('environment'));
  if (!environment) return { error: 'Invalid account type.' };

  const result = await removeAlpacaCredentials(sb, user.id, environment);
  if (!result.ok) return { error: result.error };

  revalidatePath('/settings');
  return {
    success: `${environment === 'paper' ? 'Paper' : 'Live'} credentials removed.`,
    summaries: await listAlpacaAccountSummaries(user.id),
  };
}

export async function setAlpacaTradeDefaultAction(
  _prev: AlpacaSettingsState,
  formData: FormData,
): Promise<AlpacaSettingsState> {
  const { sb, user } = await requireAuthSession();
  const raw = String(formData.get('environment') ?? '').trim().toLowerCase();
  const environment =
    raw === '' || raw === 'none' ? null : parseEnvironment(raw);
  if (raw !== '' && raw !== 'none' && environment === null) {
    return { error: 'Invalid default account.' };
  }

  const result = await setAlpacaTradeDefault(sb, user.id, environment);
  if (!result.ok) return { error: result.error };

  revalidatePath('/settings');
  return {
    success: environment
      ? `${environment === 'paper' ? 'Paper' : 'Live'} is now your default trading account.`
      : 'Default trading account cleared.',
    summaries: await listAlpacaAccountSummaries(user.id),
  };
}
