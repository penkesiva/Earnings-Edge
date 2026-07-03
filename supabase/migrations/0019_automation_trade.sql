-- Per-user auto-trade settings and Alpaca order log (Phase 3).
-- Paper-only by default; live requires explicit opt-in on the Trade page.

begin;

create table if not exists automation_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  auto_trade_enabled boolean not null default false,
  kill_switch boolean not null default false,
  live_trading_enabled boolean not null default false,
  max_notional_usd numeric(12, 2) not null default 1000,
  updated_at timestamptz not null default now()
);

create table if not exists trade_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  brief_id uuid not null references earnings_briefs (id) on delete cascade,
  ticker text not null,
  earnings_date date not null,
  environment text not null check (environment in ('paper', 'live')),
  direction text not null check (direction in ('UP', 'DOWN')),
  verdict text not null default 'GO',
  side text not null check (side in ('buy', 'sell')),
  qty numeric(12, 4) not null,
  notional_usd numeric(12, 2),
  alpaca_order_id text,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'filled', 'failed', 'cancelled', 'skipped')),
  error_message text,
  created_at timestamptz not null default now(),
  constraint trade_orders_user_brief_key unique (user_id, brief_id)
);

create index if not exists trade_orders_user_created_idx
  on trade_orders (user_id, created_at desc);

create index if not exists trade_orders_brief_id_idx
  on trade_orders (brief_id);

alter table automation_settings enable row level security;
alter table trade_orders enable row level security;

drop policy if exists automation_settings_owner on automation_settings;
create policy automation_settings_owner on automation_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists trade_orders_owner on trade_orders;
create policy trade_orders_owner on trade_orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

commit;
