-- Earnings Edge schema
-- Run in Supabase SQL editor or via psql

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
  -- thesis context (e.g. "NVDA optics partner", "AI infra")
  thesis text,
  -- conviction multiplier for sizing (0.5 = half size, 2.0 = double)
  conviction_mult numeric default 1.0
);

create index if not exists watchlist_active_idx on watchlist(active);

-- =============================================================================
-- Earnings calendar — populated weekly from FMP
-- =============================================================================
create table if not exists earnings_events (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  earnings_date date not null,
  timing text check (timing in ('BMO','AMC','UNK')) default 'UNK',
  consensus_eps numeric,
  consensus_rev numeric,
  whisper_eps numeric,
  fetched_at timestamptz default now(),
  unique(ticker, earnings_date)
);

create index if not exists earnings_events_date_idx on earnings_events(earnings_date);
create index if not exists earnings_events_ticker_idx on earnings_events(ticker);

-- =============================================================================
-- Pre-earnings briefs — one row per generated brief
-- =============================================================================
create table if not exists earnings_briefs (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  earnings_date date not null,
  generated_at timestamptz default now(),
  
  -- Beat score components (all 0-100, transparent)
  beat_streak_score numeric,
  surprise_magnitude_score numeric,
  revision_trend_score numeric,
  whisper_delta_score numeric,
  iv_rank_score numeric,
  sector_momentum_score numeric,
  insider_score numeric,
  composite_score numeric,
  
  -- Options snapshot
  spot_price numeric,
  iv_30d numeric,
  iv_rank numeric,
  expected_move_pct numeric,
  expected_move_dollar numeric,
  put_call_ratio numeric,
  atm_call_strike numeric,
  atm_put_strike numeric,
  
  -- Decision
  signal text check (signal in ('SKIP','SMALL_SPREAD','DIRECTIONAL','HIGH_CONVICTION')),
  suggested_structure jsonb,
  reasoning text,
  
  -- Audit trail
  raw_alpaca jsonb,
  raw_fmp jsonb,
  
  unique(ticker, earnings_date)
);

create index if not exists earnings_briefs_date_idx on earnings_briefs(earnings_date desc);
create index if not exists earnings_briefs_signal_idx on earnings_briefs(signal);

-- =============================================================================
-- Outcomes — recorded after earnings prints, for self-improvement
-- =============================================================================
create table if not exists earnings_outcomes (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid references earnings_briefs(id) on delete cascade,
  ticker text not null,
  earnings_date date not null,
  
  actual_eps numeric,
  actual_rev numeric,
  beat_or_miss text check (beat_or_miss in ('BEAT','MISS','INLINE')),
  surprise_pct numeric,
  
  next_day_open_pct numeric,
  next_day_close_pct numeric,
  three_day_pct numeric,
  
  -- did you take the trade?
  trade_taken boolean default false,
  trade_structure text,
  trade_pnl numeric,
  trade_notes text,
  
  recorded_at timestamptz default now()
);

create index if not exists outcomes_brief_idx on earnings_outcomes(brief_id);

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
-- Helpful views
-- =============================================================================
create or replace view v_pending_briefs as
select b.*, w.thesis, w.conviction_mult
from earnings_briefs b
left join watchlist w on w.ticker = b.ticker
where b.earnings_date >= current_date
order by b.earnings_date asc, b.composite_score desc;

create or replace view v_brief_outcomes as
select 
  b.ticker,
  b.earnings_date,
  b.composite_score,
  b.signal,
  b.expected_move_pct,
  o.beat_or_miss,
  o.surprise_pct,
  o.next_day_open_pct,
  o.next_day_close_pct,
  o.trade_taken,
  o.trade_pnl
from earnings_briefs b
left join earnings_outcomes o on o.brief_id = b.id
order by b.earnings_date desc;
