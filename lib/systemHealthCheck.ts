import type { SupabaseClient } from '@supabase/supabase-js';
import { authGateEnabled, parseAllowedEmails } from '@/lib/authAllowlist';
import {
  SYSTEM_STATUS_MANIFEST,
  type ServerEnvRequirement,
} from '@/lib/systemStatusManifest';

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'skip';

export type HealthCheckRow = {
  id: string;
  label: string;
  status: HealthStatus;
  detail?: string;
};

async function probeTable(sb: SupabaseClient, table: string): Promise<HealthStatus> {
  const { error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (!error) return 'ok';
  const msg = error.message.toLowerCase();
  if (msg.includes('does not exist') || error.code === '42P01') return 'fail';
  return 'warn';
}

function envConfigured(key: string): boolean {
  return !!process.env[key]?.trim();
}

function checkServerEnv(req: ServerEnvRequirement): HealthCheckRow {
  const set = envConfigured(req.key);
  let status: HealthStatus = 'ok';
  if (req.required && !set) status = 'fail';
  else if (!req.required && !set) status = 'warn';

  return {
    id: `env-${req.key}`,
    label: req.key,
    status,
    detail: set
      ? req.secret
        ? 'Set (value hidden)'
        : 'Set'
      : req.required
        ? 'Missing — required'
        : 'Not set (optional)',
  };
}

export type SystemHealthReport = {
  checks: HealthCheckRow[];
  summary: { ok: number; warn: number; fail: number };
  userEmail: string;
  manifestVersion: string;
};

export async function runSystemHealthChecks(
  sb: SupabaseClient,
  userEmail: string,
): Promise<SystemHealthReport> {
  const checks: HealthCheckRow[] = [];

  checks.push({
    id: 'session',
    label: 'Signed-in session',
    status: userEmail ? 'ok' : 'fail',
    detail: userEmail || 'No email on session',
  });

  checks.push({
    id: 'auth-gate',
    label: 'Auth gate',
    status: authGateEnabled() ? 'ok' : 'warn',
    detail: authGateEnabled()
      ? parseAllowedEmails()
        ? `Invite list (${parseAllowedEmails()!.length} email(s))`
        : 'Any Google user allowed'
      : 'AUTH gate off — dev/open mode',
  });

  for (const req of SYSTEM_STATUS_MANIFEST.serverEnv) {
    checks.push(checkServerEnv(req));
  }

  const tableChecks: Array<{ table: string; label: string; migration: string }> = [
    { table: 'watchlist', label: 'watchlist table', migration: '0016' },
    { table: 'earnings_candidates', label: 'earnings_candidates table', migration: '0018' },
    { table: 'user_alpaca_credentials', label: 'user_alpaca_credentials table', migration: '0017' },
    { table: 'automation_settings', label: 'automation_settings table', migration: '0019' },
    { table: 'trade_orders', label: 'trade_orders table', migration: '0019' },
  ];

  for (const t of tableChecks) {
    const status = await probeTable(sb, t.table);
    checks.push({
      id: `table-${t.table}`,
      label: t.label,
      status,
      detail:
        status === 'ok'
          ? 'Reachable'
          : status === 'fail'
            ? `Run migration ${t.migration} in Supabase`
            : 'Query error — check RLS or connection',
    });
  }

  const { count: watchlistCount, error: wlErr } = await sb
    .from('watchlist')
    .select('*', { count: 'exact', head: true });

  checks.push({
    id: 'watchlist-data',
    label: 'Your watchlist',
    status: wlErr ? 'warn' : 'ok',
    detail: wlErr ? wlErr.message : `${watchlistCount ?? 0} ticker(s)`,
  });

  const summary = checks.reduce(
    (acc, row) => {
      if (row.status === 'ok') acc.ok += 1;
      else if (row.status === 'warn') acc.warn += 1;
      else if (row.status === 'fail') acc.fail += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );

  return {
    checks,
    summary,
    userEmail,
    manifestVersion: SYSTEM_STATUS_MANIFEST.manifestVersion,
  };
}
