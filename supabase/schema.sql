-- Earnings Edge — full schema (fresh Supabase project)
-- Paste into Supabase SQL editor or: psql "$DATABASE_URL" -f supabase/schema.sql

create extension if not exists "uuid-ossp";

-- =============================================================================
-- Watchlist
-- =============================================================================
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  ticker text unique not null,
  added_at timestamptz default now(),
  notes text,
  active boolean default true,
  thesis text,
  conviction_mult numeric default 1.0,
  manual_earnings_date date,
  manual_timing text check (manual_timing in ('BMO', 'AMC', 'UNK'))
);

create index if not exists watchlist_active_idx on watchlist (active);

comment on column watchlist.manual_earnings_date is
  'Optional manual earnings date override (YYYY-MM-DD) used during sync.';
comment on column watchlist.manual_timing is
  'Optional manual timing override for manual earnings date: BMO/AMC/UNK.';

-- =============================================================================
-- Earnings calendar — populated weekly from FMP
-- =============================================================================
create table if not exists earnings_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  earnings_date date not null,
  timing text check (timing in ('BMO', 'AMC', 'UNK')) default 'UNK',
  consensus_eps numeric,
  consensus_rev numeric,
  whisper_eps numeric,
  fetched_at timestamptz default now(),
  source text check (source in ('FMP', 'MANUAL')) default 'FMP',
  unique (ticker, earnings_date)
);

create index if not exists earnings_events_date_idx on earnings_events (earnings_date);
create index if not exists earnings_events_ticker_idx on earnings_events (ticker);

comment on column earnings_events.source is
  'Origin of earnings date row: FMP feed or manual watchlist override.';

-- =============================================================================
-- Pre-earnings briefs — one row per ticker per earnings date
-- =============================================================================
create table if not exists earnings_briefs (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  earnings_date date not null,
  generated_at timestamptz default now(),
  updated_at timestamptz default now(),

  beat_streak_score numeric,
  surprise_magnitude_score numeric,
  revision_trend_score numeric,
  whisper_delta_score numeric,
  iv_rank_score numeric,
  sector_momentum_score numeric,
  insider_score numeric,
  composite_score numeric,

  spot_price numeric,
  iv_30d numeric,
  iv_rank numeric,
  expected_move_pct numeric,
  expected_move_dollar numeric,
  put_call_ratio numeric,
  atm_call_strike numeric,
  atm_put_strike numeric,

  signal text check (signal in ('SKIP', 'SMALL_SPREAD', 'DIRECTIONAL', 'HIGH_CONVICTION')),
  suggested_structure jsonb,
  reasoning text,

  scream_score integer,
  scream_direction text,
  scream_recommendation text,
  scream_qualifies boolean,
  scream_filters jsonb,
  scream_notes jsonb,

  final_action text,
  final_action_rationale text,

  raw_alpaca jsonb,
  raw_fmp jsonb,
  raw_headlines jsonb,
  news_sentiment jsonb,

  unique (ticker, earnings_date)
);

create index if not exists earnings_briefs_date_idx on earnings_briefs (earnings_date desc);
create index if not exists earnings_briefs_signal_idx on earnings_briefs (signal);
create index if not exists earnings_briefs_scream_score_idx on earnings_briefs (scream_score desc nulls last)
  where scream_score is not null;
create index if not exists earnings_briefs_final_action_idx on earnings_briefs (final_action)
  where final_action is not null;

comment on column earnings_briefs.scream_score is 'Scream Test: filters passed 0–5';
comment on column earnings_briefs.scream_qualifies is 'True when score≥4 and single directional bias';
comment on column earnings_briefs.final_action is
  'Reconciled trade action: SKIP | IRON_CONDOR | LONG_CALL | LONG_PUT | CALL_DEBIT_SPREAD | PUT_DEBIT_SPREAD';
comment on column earnings_briefs.final_action_rationale is
  'One-line explanation of why reconcileSignals() chose this action';

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists earnings_briefs_updated_at on earnings_briefs;
create trigger earnings_briefs_updated_at
  before update on earnings_briefs
  for each row execute function set_updated_at();

-- =============================================================================
-- Scan history — one row per ticker per scan run (diff banner on brief page)
-- =============================================================================
create table if not exists brief_scans (
  id serial primary key,
  ticker text not null,
  scan_timestamp timestamptz not null default now(),
  reconciled_action text,
  scream_score integer,
  iv_rank integer,
  directional_bias text
);

create index if not exists idx_scans_ticker_time on brief_scans (ticker, scan_timestamp desc);

-- =============================================================================
-- Outcomes — recorded after earnings prints
-- =============================================================================
create table if not exists earnings_outcomes (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references earnings_briefs (id) on delete cascade,
  ticker text not null,
  earnings_date date not null,

  actual_eps numeric,
  actual_rev numeric,
  beat_or_miss text check (beat_or_miss in ('BEAT', 'MISS', 'INLINE')),
  surprise_pct numeric,

  next_day_open_pct numeric,
  next_day_close_pct numeric,
  three_day_pct numeric,

  trade_taken boolean default false,
  trade_structure text,
  trade_pnl numeric,
  trade_notes text,

  final_action text,
  hit boolean,

  recorded_at timestamptz default now()
);

create index if not exists outcomes_brief_idx on earnings_outcomes (brief_id);

comment on column earnings_outcomes.final_action is
  'The reconciled action at scan time (SKIP, LONG_CALL, CALL_DEBIT_SPREAD, etc.)';
comment on column earnings_outcomes.hit is
  'True when the directional prediction was correct based on next-day move.';

-- =============================================================================
-- LLM headline cache (per ticker per scan day)
-- =============================================================================
create table if not exists llm_scan_cache (
  ticker text not null,
  scan_date date not null,
  risks jsonb not null default '[]'::jsonb,
  headline_sentiments jsonb not null default '[]'::jsonb,
  news_overall jsonb,
  created_at timestamptz not null default now(),
  primary key (ticker, scan_date)
);

-- =============================================================================
-- Persisted AI analysis (OpenAI / Gemini / Claude)
-- =============================================================================
create table if not exists brief_ai_analyses (
  id bigserial primary key,
  brief_id uuid not null references earnings_briefs (id) on delete cascade,
  provider text not null,
  analysis_text text not null,
  analyzed_at timestamptz not null default now(),
  constraint brief_ai_analyses_brief_provider_key unique (brief_id, provider)
);

create index if not exists idx_ai_analyses_brief_id on brief_ai_analyses (brief_id);

grant all on brief_ai_analyses to postgres, anon, authenticated, service_role;
grant usage, select on sequence brief_ai_analyses_id_seq to postgres, anon, authenticated, service_role;

-- =============================================================================
-- Per-ticker Scan All lock (one run per ticker, ~10 min cooldown)
-- =============================================================================
create table if not exists ticker_scan_locks (
  ticker text primary key,
  run_id uuid not null,
  locked_until timestamptz not null,
  started_at timestamptz not null default now(),
  brief_id uuid references earnings_briefs (id) on delete set null
);

grant all on ticker_scan_locks to postgres, anon, authenticated, service_role;

-- =============================================================================
-- Web push subscriptions
-- =============================================================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- =============================================================================
-- Views
-- =============================================================================
create or replace view v_pending_briefs as
select b.*, w.thesis, w.conviction_mult
from earnings_briefs b
left join watchlist w on w.ticker = b.ticker
where b.earnings_date >= current_date
order by b.earnings_date asc, b.composite_score desc;

create or replace view v_brief_outcomes as
select
  b.id as brief_id,
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
  o.hit
from earnings_briefs b
left join earnings_outcomes o on o.brief_id = b.id
order by b.earnings_date desc;

notify pgrst, 'reload schema';
