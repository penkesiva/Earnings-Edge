-- Premarket SPX price target evaluation (first 2h RTH touch).

begin;

create table if not exists pm_price_target_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references pm_market_sessions (id) on delete cascade,
  prediction_id uuid not null references pm_predictions (id) on delete cascade,
  target_spx numeric(12, 4) not null,
  target_side text not null check (target_side in ('PUT', 'CALL')),
  window_start_pt timestamptz not null,
  window_end_pt timestamptz not null,
  window_high_spx numeric(12, 4),
  window_low_spx numeric(12, 4),
  target_hit boolean not null,
  metrics jsonb not null default '{}',
  evaluated_at_pt timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pm_price_target_evaluations_session_key unique (session_id)
);

create index if not exists pm_price_target_evaluations_session_idx
  on pm_price_target_evaluations (session_id);

alter table pm_prediction_scores
  add column if not exists price_target_hit boolean;

alter table pm_price_target_evaluations enable row level security;
create policy pm_price_target_evaluations_read on pm_price_target_evaluations
  for select to authenticated using (true);

commit;
