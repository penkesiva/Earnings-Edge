-- Per-user upcoming earnings discovery (curated before watchlist add).

begin;

create table if not exists earnings_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  company_name text,
  earnings_date date not null,
  timing text not null default 'UNK' check (timing in ('BMO', 'AMC', 'UNK')),
  price numeric,
  market_cap numeric,
  sector text,
  industry text,
  status text not null default 'pending' check (status in ('pending', 'added', 'dismissed')),
  dismissed_at timestamptz,
  added_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint earnings_candidates_user_ticker_date_key unique (user_id, ticker, earnings_date)
);

create index if not exists earnings_candidates_user_status_date_idx
  on earnings_candidates (user_id, status, earnings_date);

alter table earnings_candidates enable row level security;

drop policy if exists earnings_candidates_owner on earnings_candidates;
create policy earnings_candidates_owner on earnings_candidates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

commit;
