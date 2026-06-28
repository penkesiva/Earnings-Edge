-- Per-user Alpaca API credentials (paper + live), encrypted at rest.
-- Secrets are only decrypted on the server — never returned to the browser.

begin;

create table if not exists user_alpaca_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  environment text not null check (environment in ('paper', 'live')),
  api_key_id text not null,
  api_secret_encrypted text not null,
  api_secret_iv text not null,
  api_secret_tag text not null,
  is_trade_default boolean not null default false,
  verified_at timestamptz,
  account_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_alpaca_credentials_user_env_key unique (user_id, environment)
);

create index if not exists user_alpaca_credentials_user_id_idx
  on user_alpaca_credentials (user_id);

create unique index if not exists user_alpaca_credentials_one_trade_default
  on user_alpaca_credentials (user_id)
  where is_trade_default = true;

alter table user_alpaca_credentials enable row level security;

drop policy if exists user_alpaca_credentials_owner on user_alpaca_credentials;
create policy user_alpaca_credentials_owner on user_alpaca_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Safe read shape for UI (no ciphertext columns).
create or replace view user_alpaca_credentials_public with (security_invoker = true) as
select
  id,
  user_id,
  environment,
  api_key_id,
  is_trade_default,
  verified_at,
  account_status,
  created_at,
  updated_at
from user_alpaca_credentials;

grant select on user_alpaca_credentials_public to postgres, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
