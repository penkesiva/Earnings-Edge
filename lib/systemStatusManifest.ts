/**
 * Single source of truth for the authenticated /status page.
 * Update this file when shipping phases, migrations, routes, or required env vars.
 */

export type SystemPhase = {
  id: string;
  name: string;
  route: string;
  migration?: string;
  status: 'shipped' | 'planned';
};

export type SystemMigration = {
  id: string;
  file: string;
  summary: string;
};

export type ServerEnvRequirement = {
  key: string;
  required: boolean;
  secret?: boolean;
  summary: string;
};

export const SYSTEM_STATUS_MANIFEST = {
  /** Bump when you change phases, migrations, or env requirements below. */
  manifestVersion: '2026-07-14',

  phases: [
    {
      id: 'auth',
      name: 'Google OAuth + per-user RLS',
      route: '/settings',
      migration: '0016',
      status: 'shipped',
    },
    {
      id: 'watchlist',
      name: 'Watchlist + earnings discovery (14d, filters, dismiss)',
      route: '/watchlist',
      migration: '0018',
      status: 'shipped',
    },
    {
      id: 'analyze',
      name: 'Home briefs, Scan All, consensus verdicts',
      route: '/',
      status: 'shipped',
    },
    {
      id: 'top10',
      name: 'Pre-market Top 10 up/down on Home',
      route: '/',
      status: 'shipped',
    },
    {
      id: 'year-round',
      name: 'Year-round Top 10 beyond earnings week',
      route: '/',
      status: 'shipped',
    },
    {
      id: 'alpaca',
      name: 'Per-user Alpaca paper/live keys in Settings',
      route: '/settings',
      migration: '0017',
      status: 'shipped',
    },
    {
      id: 'trade',
      name: 'Auto-trade (consensus GO, paper default, kill switch)',
      route: '/trade',
      migration: '0019',
      status: 'shipped',
    },
    {
      id: 'trade-cron',
      name: 'Scheduled auto-trade — pre-close cron (AMC today + BMO next day)',
      route: '/trade',
      status: 'shipped',
    },
  ] satisfies SystemPhase[],

  migrations: [
    {
      id: '0016',
      file: '0016_user_scoped_rls.sql',
      summary: 'user_id + RLS on core tables (resets legacy shared data)',
    },
    {
      id: '0017',
      file: '0017_user_alpaca_credentials.sql',
      summary: 'Encrypted Alpaca keys per user',
    },
    {
      id: '0018',
      file: '0018_earnings_candidates.sql',
      summary: 'Earnings discovery candidates + dismiss memory',
    },
    {
      id: '0019',
      file: '0019_automation_trade.sql',
      summary: 'Auto-trade settings + order log',
    },
  ] satisfies SystemMigration[],

  serverEnv: [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      required: true,
      summary: 'Supabase project URL',
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      required: true,
      summary: 'Supabase anon key (browser + server)',
    },
    {
      key: 'AUTH_REQUIRED',
      required: false,
      summary: 'When true, all routes except login require Google sign-in',
    },
    {
      key: 'AUTH_ALLOWED_EMAILS',
      required: false,
      summary: 'Optional comma-separated invite list',
    },
    {
      key: 'FMP_API_KEY',
      required: true,
      summary: 'Financial Modeling Prep — calendar + fundamentals',
    },
    {
      key: 'ALPACA_CREDENTIALS_ENCRYPTION_KEY',
      required: true,
      secret: true,
      summary: 'AES-256-GCM for saved Alpaca secrets (openssl rand -base64 32)',
    },
    {
      key: 'CRON_SECRET',
      required: false,
      summary: 'Bearer token for /api/cron/* routes',
    },
    {
      key: 'TWILIO_ACCOUNT_SID',
      required: false,
      summary: 'Twilio account for WhatsApp trade notifications',
    },
    {
      key: 'TWILIO_AUTH_TOKEN',
      required: false,
      secret: true,
      summary: 'Twilio auth token (WhatsApp notifications)',
    },
    {
      key: 'TWILIO_WHATSAPP_FROM',
      required: false,
      summary: 'WhatsApp-enabled Twilio sender number',
    },
    {
      key: 'NOTIFY_WHATSAPP_TO',
      required: false,
      summary: 'Owner WhatsApp number for auto-trade summaries',
    },
  ] satisfies ServerEnvRequirement[],
} as const;
