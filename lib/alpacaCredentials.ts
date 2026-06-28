import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret } from '@/lib/credentialCrypto';
import type { AlpacaAuth } from '@/lib/alpaca';
import { supabaseAdmin } from '@/lib/supabase';

export type AlpacaEnvironment = 'paper' | 'live';

export type AlpacaAccountSummary = {
  environment: AlpacaEnvironment;
  configured: boolean;
  keyHint: string | null;
  verifiedAt: string | null;
  accountStatus: string | null;
  isTradeDefault: boolean;
};

type CredentialRow = {
  id: string;
  user_id: string;
  environment: AlpacaEnvironment;
  api_key_id: string;
  api_secret_encrypted: string;
  api_secret_iv: string;
  api_secret_tag: string;
  is_trade_default: boolean;
  verified_at: string | null;
  account_status: string | null;
};

type PublicCredentialRow = {
  environment: AlpacaEnvironment;
  api_key_id: string;
  is_trade_default: boolean;
  verified_at: string | null;
  account_status: string | null;
};

const TRADING_BASE: Record<AlpacaEnvironment, string> = {
  paper: 'https://paper-api.alpaca.markets',
  live: 'https://api.alpaca.markets',
};

export function maskApiKeyId(keyId: string): string {
  const trimmed = keyId.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function tradingBaseUrl(environment: AlpacaEnvironment): string {
  return TRADING_BASE[environment];
}

function adminSb() {
  return supabaseAdmin();
}

function toAlpacaAuth(row: CredentialRow): AlpacaAuth {
  const secret = decryptSecret({
    ciphertext: row.api_secret_encrypted,
    iv: row.api_secret_iv,
    tag: row.api_secret_tag,
  });
  return {
    keyId: row.api_key_id,
    secret,
    dataBaseUrl: process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets',
    tradingBaseUrl: tradingBaseUrl(row.environment),
    environment: row.environment,
  };
}

export async function verifyAlpacaCredentials(
  auth: Pick<AlpacaAuth, 'keyId' | 'secret'>,
  environment: AlpacaEnvironment,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const base = tradingBaseUrl(environment);
  try {
    const res = await fetch(`${base}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': auth.keyId.trim(),
        'APCA-API-SECRET-KEY': auth.secret.trim(),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401 || res.status === 403
            ? 'Invalid API key or secret for this environment.'
            : `Alpaca rejected credentials (${res.status}).`,
      };
    }
    const data = (await res.json()) as { status?: string };
    return { ok: true, status: data.status?.trim() || 'connected' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Server-only — decrypts secrets via service role. Never call from the browser. */
async function fetchCredentialRows(userId: string): Promise<CredentialRow[]> {
  const { data, error } = await adminSb()
    .from('user_alpaca_credentials')
    .select(
      'id, user_id, environment, api_key_id, api_secret_encrypted, api_secret_iv, api_secret_tag, is_trade_default, verified_at, account_status',
    )
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return (data ?? []) as CredentialRow[];
}

async function fetchPublicRows(userId: string): Promise<PublicCredentialRow[]> {
  const { data, error } = await adminSb()
    .from('user_alpaca_credentials_public')
    .select('environment, api_key_id, is_trade_default, verified_at, account_status')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return (data ?? []) as PublicCredentialRow[];
}

export async function listAlpacaAccountSummaries(userId: string): Promise<AlpacaAccountSummary[]> {
  const rows = await fetchPublicRows(userId);
  const byEnv = new Map(rows.map(r => [r.environment, r]));

  return (['paper', 'live'] as const).map(environment => {
    const row = byEnv.get(environment);
    if (!row) {
      return {
        environment,
        configured: false,
        keyHint: null,
        verifiedAt: null,
        accountStatus: null,
        isTradeDefault: false,
      };
    }
    return {
      environment,
      configured: true,
      keyHint: maskApiKeyId(row.api_key_id),
      verifiedAt: row.verified_at,
      accountStatus: row.account_status,
      isTradeDefault: row.is_trade_default,
    };
  });
}

export async function resolveAlpacaAuthForUser(
  userId: string,
  prefer?: AlpacaEnvironment,
): Promise<AlpacaAuth | null> {
  const rows = await fetchCredentialRows(userId);
  if (!rows.length) return envFallbackAuth();

  const pick = (env: AlpacaEnvironment | undefined) =>
    env ? rows.find(r => r.environment === env) : undefined;

  const row =
    pick(prefer) ??
    rows.find(r => r.is_trade_default) ??
    pick('paper') ??
    pick('live') ??
    rows[0];

  if (!row) return envFallbackAuth();
  return toAlpacaAuth(row);
}

function envFallbackAuth(): AlpacaAuth | null {
  const keyId = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_API_SECRET?.trim();
  if (!keyId || !secret) return null;
  return {
    keyId,
    secret,
    dataBaseUrl: process.env.ALPACA_BASE_URL || 'https://data.alpaca.markets',
    tradingBaseUrl: TRADING_BASE.paper,
    environment: 'paper',
  };
}

export async function saveAlpacaCredentials(
  sb: SupabaseClient,
  userId: string,
  environment: AlpacaEnvironment,
  apiKeyId: string,
  apiSecret: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const keyId = apiKeyId.trim();
  const secret = apiSecret.trim();
  if (!keyId) return { ok: false, error: 'API Key ID is required.' };
  if (!secret) return { ok: false, error: 'API Secret is required.' };

  const verified = await verifyAlpacaCredentials({ keyId, secret }, environment);
  if (!verified.ok) return verified;

  let encrypted;
  try {
    encrypted = encryptSecret(secret);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const now = new Date().toISOString();
  const { error } = await sb.from('user_alpaca_credentials').upsert(
    {
      user_id: userId,
      environment,
      api_key_id: keyId,
      api_secret_encrypted: encrypted.ciphertext,
      api_secret_iv: encrypted.iv,
      api_secret_tag: encrypted.tag,
      verified_at: now,
      account_status: verified.status,
      updated_at: now,
    },
    { onConflict: 'user_id,environment' },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateAlpacaCredentials(
  sb: SupabaseClient,
  userId: string,
  environment: AlpacaEnvironment,
  apiKeyId: string,
  apiSecret?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await fetchCredentialRows(userId);
  const existing = rows.find(r => r.environment === environment);
  if (!existing) {
    if (!apiSecret?.trim()) {
      return { ok: false, error: 'API Secret is required for a new connection.' };
    }
    return saveAlpacaCredentials(sb, userId, environment, apiKeyId, apiSecret);
  }

  const keyId = apiKeyId.trim() || existing.api_key_id;
  const secret = apiSecret?.trim()
    ? apiSecret.trim()
    : decryptSecret({
        ciphertext: existing.api_secret_encrypted,
        iv: existing.api_secret_iv,
        tag: existing.api_secret_tag,
      });

  return saveAlpacaCredentials(sb, userId, environment, keyId, secret);
}

export async function removeAlpacaCredentials(
  sb: SupabaseClient,
  userId: string,
  environment: AlpacaEnvironment,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from('user_alpaca_credentials')
    .delete()
    .eq('user_id', userId)
    .eq('environment', environment);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setAlpacaTradeDefault(
  sb: SupabaseClient,
  userId: string,
  environment: AlpacaEnvironment | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: clearError } = await sb
    .from('user_alpaca_credentials')
    .update({ is_trade_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (clearError) return { ok: false, error: clearError.message };

  if (environment === null) return { ok: true };

  const rows = await fetchPublicRows(userId);
  if (!rows.some(r => r.environment === environment)) {
    return { ok: false, error: `Connect your ${environment} account before setting it as default.` };
  }

  const { error } = await sb
    .from('user_alpaca_credentials')
    .update({ is_trade_default: true, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('environment', environment);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
