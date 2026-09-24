-- PredictMarket: SPX prediction, validation, and learning (Phase 1 schema).
-- Shared app data (not per-user). Authenticated read; writes via service role / cron.

begin;

create table if not exists pm_market_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null,
  timezone_note text not null default 'US/Eastern trading session keyed by session_date (NYSE calendar)',
  regime text,
  created_at timestamptz not null default now(),
  constraint pm_market_sessions_session_date_key unique (session_date)
);

create index if not exists pm_market_sessions_date_idx on pm_market_sessions (session_date desc);

-- Immutable input captures (OPEN, NIGHT_INPUT, PREMARKET_INPUT, etc.)
create table if not exists pm_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  snapshot_kind text not null check (
    snapshot_kind in (
      'NIGHT_INPUT',
      'PREMARKET_INPUT',
      'OPEN',
      'ENTRY_WINDOW',
      'VALIDATION_7AM',
      'VALIDATION_10AM',
      'CLOSE'
    )
  ),
  as_of_pt timestamptz not null,
  data_source text not null default 'mixed',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pm_market_snapshots_session_idx
  on pm_market_snapshots (session_id, as_of_pt desc);

-- Immutable forecasts
create table if not exists pm_predictions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  prediction_type text not null check (prediction_type in ('NIGHT', 'PREMARKET')),
  as_of_pt timestamptz not null,
  direction text not null check (direction in ('GREEN', 'RED', 'NEUTRAL')),
  confidence numeric(5, 2) not null check (confidence >= 0 and confidence <= 100),
  trade_bias text not null check (trade_bias in ('CALL', 'PUT', 'NO_TRADE')),
  expected_open_direction text,
  expected_gap_percent numeric(8, 4),
  expected_low numeric(12, 4),
  expected_high numeric(12, 4),
  expected_close numeric(12, 4),
  expected_day_return_percent numeric(8, 4),
  bullish_score numeric(6, 2),
  bearish_score numeric(6, 2),
  structured jsonb not null,
  reasoning text,
  input_snapshot_id uuid references pm_market_snapshots (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint pm_predictions_session_type_key unique (session_id, prediction_type)
);

create index if not exists pm_predictions_session_idx on pm_predictions (session_id);

create table if not exists pm_prediction_comparisons (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  night_prediction_id uuid not null references pm_predictions (id) on delete cascade,
  premarket_prediction_id uuid not null references pm_predictions (id) on delete cascade,
  changed boolean not null,
  night_direction text not null,
  night_confidence numeric(5, 2) not null,
  premarket_direction text not null,
  premarket_confidence numeric(5, 2) not null,
  change_summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint pm_prediction_comparisons_session_key unique (session_id)
);

create table if not exists pm_trade_signals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  recommended_side text not null check (recommended_side in ('CALL', 'PUT', 'WAIT', 'NO_TRADE')),
  decision_time_pt timestamptz not null,
  spx_price numeric(12, 4),
  confidence numeric(5, 2),
  confirmation_signals jsonb not null default '[]',
  invalidation_level numeric(12, 4),
  reasoning text,
  structured jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists pm_trade_signals_session_idx on pm_trade_signals (session_id);

create table if not exists pm_validation_checkpoints (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  checkpoint_kind text not null check (checkpoint_kind in ('FIRST_7AM', 'MIDDAY_10AM')),
  as_of_pt timestamptz not null,
  thesis_status text not null check (
    thesis_status in ('CONFIRMED', 'WEAKENING', 'INVALIDATED', 'REVERSING', 'PENDING')
  ),
  metrics jsonb not null default '{}',
  reasoning text,
  created_at timestamptz not null default now(),
  constraint pm_validation_checkpoints_session_kind_key unique (session_id, checkpoint_kind)
);

create table if not exists pm_market_outcomes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  previous_close numeric(12, 4),
  open numeric(12, 4),
  high numeric(12, 4),
  low numeric(12, 4),
  close numeric(12, 4),
  gap_percent numeric(8, 4),
  daily_return_percent numeric(8, 4),
  intraday_range_percent numeric(8, 4),
  actual_direction text check (actual_direction in ('GREEN', 'RED')),
  payload jsonb not null default '{}',
  graded_at_pt timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pm_market_outcomes_session_key unique (session_id)
);

create table if not exists pm_prediction_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  prediction_id uuid not null references pm_predictions (id) on delete cascade,
  direction_correct boolean,
  open_direction_correct boolean,
  range_mae_high numeric(12, 4),
  range_mae_low numeric(12, 4),
  range_coverage boolean,
  confidence_bucket text,
  metrics jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint pm_prediction_scores_prediction_key unique (prediction_id)
);

create table if not exists pm_economic_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  event_name text not null,
  event_time_pt timestamptz,
  importance text,
  consensus text,
  previous text,
  actual text,
  surprise jsonb,
  source jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pm_economic_events_session_idx on pm_economic_events (session_id);

create table if not exists pm_news_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  headline text not null,
  classification text check (classification in ('BULLISH', 'BEARISH', 'UNCERTAIN')),
  impact text check (impact in ('LOW', 'MEDIUM', 'HIGH')),
  mechanism text,
  source jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pm_news_events_session_idx on pm_news_events (session_id);

create table if not exists pm_social_sentiment (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  as_of_pt timestamptz not null,
  score numeric(6, 2) not null check (score >= -100 and score <= 100),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists pm_social_sentiment_session_idx on pm_social_sentiment (session_id);

alter table pm_market_sessions enable row level security;
alter table pm_market_snapshots enable row level security;
alter table pm_predictions enable row level security;
alter table pm_prediction_comparisons enable row level security;
alter table pm_trade_signals enable row level security;
alter table pm_validation_checkpoints enable row level security;
alter table pm_market_outcomes enable row level security;
alter table pm_prediction_scores enable row level security;
alter table pm_economic_events enable row level security;
alter table pm_news_events enable row level security;
alter table pm_social_sentiment enable row level security;

-- Authenticated users can read PredictMarket research data.
create policy pm_market_sessions_read on pm_market_sessions for select to authenticated using (true);
create policy pm_market_snapshots_read on pm_market_snapshots for select to authenticated using (true);
create policy pm_predictions_read on pm_predictions for select to authenticated using (true);
create policy pm_prediction_comparisons_read on pm_prediction_comparisons for select to authenticated using (true);
create policy pm_trade_signals_read on pm_trade_signals for select to authenticated using (true);
create policy pm_validation_checkpoints_read on pm_validation_checkpoints for select to authenticated using (true);
create policy pm_market_outcomes_read on pm_market_outcomes for select to authenticated using (true);
create policy pm_prediction_scores_read on pm_prediction_scores for select to authenticated using (true);
create policy pm_economic_events_read on pm_economic_events for select to authenticated using (true);
create policy pm_news_events_read on pm_news_events for select to authenticated using (true);
create policy pm_social_sentiment_read on pm_social_sentiment for select to authenticated using (true);

notify pgrst, 'reload schema';

commit;
