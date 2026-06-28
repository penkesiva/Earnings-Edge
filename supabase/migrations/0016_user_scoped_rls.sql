-- Per-user data isolation: user_id on core tables + RLS.
-- Wipes legacy shared rows (beta reset). Run in Supabase SQL editor after deploy.

begin;

truncate table brief_ai_analyses cascade;
truncate table earnings_outcomes cascade;
truncate table ticker_scan_locks cascade;
truncate table brief_scans cascade;
truncate table llm_scan_cache cascade;
truncate table earnings_briefs cascade;
truncate table earnings_events cascade;
truncate table watchlist cascade;

-- watchlist
alter table watchlist
  add column user_id uuid not null references auth.users (id) on delete cascade;

alter table watchlist drop constraint if exists watchlist_ticker_key;
alter table watchlist add constraint watchlist_user_ticker_key unique (user_id, ticker);
create index if not exists watchlist_user_id_idx on watchlist (user_id);

-- earnings_events
alter table earnings_events
  add column user_id uuid not null references auth.users (id) on delete cascade;

alter table earnings_events drop constraint if exists earnings_events_ticker_earnings_date_key;
alter table earnings_events add constraint earnings_events_user_ticker_date_key unique (user_id, ticker, earnings_date);
create index if not exists earnings_events_user_id_idx on earnings_events (user_id);

-- earnings_briefs
alter table earnings_briefs
  add column user_id uuid not null references auth.users (id) on delete cascade;

alter table earnings_briefs drop constraint if exists earnings_briefs_ticker_earnings_date_key;
alter table earnings_briefs add constraint earnings_briefs_user_ticker_date_key unique (user_id, ticker, earnings_date);
create index if not exists earnings_briefs_user_id_idx on earnings_briefs (user_id);

-- brief_scans
alter table brief_scans
  add column user_id uuid not null references auth.users (id) on delete cascade;
create index if not exists brief_scans_user_ticker_time_idx on brief_scans (user_id, ticker, scan_timestamp desc);

-- llm_scan_cache
alter table llm_scan_cache
  add column user_id uuid not null references auth.users (id) on delete cascade;

alter table llm_scan_cache drop constraint if exists llm_scan_cache_pkey;
alter table llm_scan_cache add primary key (user_id, ticker, scan_date);

-- push_subscriptions (optional per-user push)
alter table push_subscriptions
  add column if not exists user_id uuid references auth.users (id) on delete cascade;
create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id);

-- ticker_scan_locks — composite key per user
drop function if exists acquire_ticker_scan_lock(text, uuid, int);

drop table if exists ticker_scan_locks;

create table ticker_scan_locks (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  run_id uuid not null,
  locked_until timestamptz not null,
  started_at timestamptz not null default now(),
  brief_id uuid references earnings_briefs (id) on delete set null,
  primary key (user_id, ticker)
);

grant all on ticker_scan_locks to postgres, anon, authenticated, service_role;

create or replace function acquire_ticker_scan_lock(
  p_user_id uuid,
  p_ticker text,
  p_brief_id uuid default null,
  p_lock_minutes int default 5
)
returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_until timestamptz := v_now + make_interval(mins => p_lock_minutes);
  v_run_id uuid := gen_random_uuid();
  v_existing timestamptz;
  v_ticker text := upper(trim(p_ticker));
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || v_ticker));

  select locked_until into v_existing
  from ticker_scan_locks
  where user_id = p_user_id and ticker = v_ticker;

  if v_existing is not null and v_existing > v_now then
    return jsonb_build_object(
      'acquired', false,
      'locked_until', v_existing,
      'run_id', (select run_id from ticker_scan_locks where user_id = p_user_id and ticker = v_ticker)
    );
  end if;

  insert into ticker_scan_locks (user_id, ticker, run_id, locked_until, started_at, brief_id)
  values (p_user_id, v_ticker, v_run_id, v_until, v_now, p_brief_id)
  on conflict (user_id, ticker) do update set
    run_id = excluded.run_id,
    locked_until = excluded.locked_until,
    started_at = excluded.started_at,
    brief_id = excluded.brief_id;

  return jsonb_build_object(
    'acquired', true,
    'locked_until', v_until,
    'run_id', v_run_id
  );
end;
$$;

grant execute on function acquire_ticker_scan_lock(uuid, text, uuid, int) to postgres, anon, authenticated, service_role;

-- RLS
alter table watchlist enable row level security;
alter table earnings_events enable row level security;
alter table earnings_briefs enable row level security;
alter table brief_scans enable row level security;
alter table llm_scan_cache enable row level security;
alter table ticker_scan_locks enable row level security;
alter table push_subscriptions enable row level security;
alter table earnings_outcomes enable row level security;
alter table brief_ai_analyses enable row level security;

drop policy if exists watchlist_owner on watchlist;
create policy watchlist_owner on watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists earnings_events_owner on earnings_events;
create policy earnings_events_owner on earnings_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists earnings_briefs_owner on earnings_briefs;
create policy earnings_briefs_owner on earnings_briefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists brief_scans_owner on brief_scans;
create policy brief_scans_owner on brief_scans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists llm_scan_cache_owner on llm_scan_cache;
create policy llm_scan_cache_owner on llm_scan_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ticker_scan_locks_owner on ticker_scan_locks;
create policy ticker_scan_locks_owner on ticker_scan_locks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_owner on push_subscriptions;
create policy push_subscriptions_owner on push_subscriptions
  for all using (user_id is null or auth.uid() = user_id)
  with check (user_id is null or auth.uid() = user_id);

drop policy if exists earnings_outcomes_owner on earnings_outcomes;
create policy earnings_outcomes_owner on earnings_outcomes
  for all using (
    exists (
      select 1 from earnings_briefs b
      where b.id = earnings_outcomes.brief_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from earnings_briefs b
      where b.id = earnings_outcomes.brief_id and b.user_id = auth.uid()
    )
  );

drop policy if exists brief_ai_analyses_owner on brief_ai_analyses;
create policy brief_ai_analyses_owner on brief_ai_analyses
  for all using (
    exists (
      select 1 from earnings_briefs b
      where b.id = brief_ai_analyses.brief_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from earnings_briefs b
      where b.id = brief_ai_analyses.brief_id and b.user_id = auth.uid()
    )
  );

-- Views (respect caller RLS via security_invoker)
drop view if exists v_brief_outcomes;
drop view if exists v_pending_briefs;

create view v_brief_outcomes with (security_invoker = true) as
select
  b.id as brief_id,
  b.user_id,
  b.ticker,
  b.earnings_date,
  b.composite_score,
  b.signal,
  b.final_action,
  b.expected_move_pct,
  b.expected_move_dollar,
  o.beat_or_miss,
  o.surprise_pct,
  o.next_day_open_pct,
  o.next_day_close_pct,
  o.trade_taken,
  o.trade_pnl,
  o.hit,
  o.consensus_verdict,
  o.consensus_direction,
  o.consensus_confidence,
  o.consensus_trade_type,
  o.consensus_hit
from earnings_briefs b
left join earnings_outcomes o on o.brief_id = b.id
order by b.earnings_date desc;

create view v_pending_briefs with (security_invoker = true) as
select b.*, w.thesis, w.conviction_mult
from earnings_briefs b
left join watchlist w on w.user_id = b.user_id and w.ticker = b.ticker
where b.earnings_date >= current_date
order by b.earnings_date asc, b.composite_score desc;

grant select on v_brief_outcomes to postgres, anon, authenticated, service_role;
grant select on v_pending_briefs to postgres, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
