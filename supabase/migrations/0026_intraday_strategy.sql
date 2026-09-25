-- Intraday stock strategies (VWAP + OR v1): settings, backtests, sessions, trades.

begin;

create table if not exists intraday_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  strategy_id text not null default 'vwap_opening_range_v1',
  symbol text not null,
  company_name text,
  trading_budget_usd numeric(14, 2) not null check (trading_budget_usd >= 100),
  deploy_pct numeric(5, 2) not null default 100 check (deploy_pct > 0 and deploy_pct <= 100),
  automation_enabled boolean not null default false,
  config jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists intraday_backtest_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_id text not null,
  symbol text not null,
  company_name text,
  calendar_days integer not null check (calendar_days >= 5 and calendar_days <= 400),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error_message text,
  metrics jsonb not null default '{}',
  trades jsonb not null default '[]',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists intraday_backtest_runs_user_idx
  on intraday_backtest_runs (user_id, started_at desc);

create table if not exists intraday_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_date date not null,
  strategy_id text not null,
  symbol text not null,
  state text not null,
  mode text not null check (mode in ('paper', 'live', 'backtest')),
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  constraint intraday_sessions_user_date_key unique (user_id, session_date)
);

create table if not exists intraday_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references intraday_sessions (id) on delete set null,
  backtest_run_id uuid references intraday_backtest_runs (id) on delete set null,
  strategy_id text not null,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  shares numeric(12, 4) not null,
  price numeric(12, 4) not null,
  setup_type text,
  confidence numeric(5, 2),
  reasons jsonb not null default '[]',
  mode text not null check (mode in ('paper', 'live', 'backtest')),
  executed_at timestamptz not null default now()
);

create index if not exists intraday_trades_user_day_idx
  on intraday_trades (user_id, executed_at desc);

alter table intraday_settings enable row level security;
alter table intraday_backtest_runs enable row level security;
alter table intraday_sessions enable row level security;
alter table intraday_trades enable row level security;

create policy intraday_settings_owner on intraday_settings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy intraday_backtest_runs_owner on intraday_backtest_runs
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy intraday_sessions_owner on intraday_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy intraday_trades_owner on intraday_trades
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
