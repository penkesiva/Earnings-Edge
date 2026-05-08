-- Add final_action + hit tracking to earnings_outcomes.
-- Also update v_brief_outcomes view to expose final_action and hit.

alter table earnings_outcomes
  add column if not exists final_action text,
  add column if not exists hit boolean;

comment on column earnings_outcomes.final_action is
  'The reconciled action at scan time (SKIP, LONG_CALL, CALL_DEBIT_SPREAD, etc.)';
comment on column earnings_outcomes.hit is
  'True when the directional prediction was correct based on next-day move.';

-- Refresh view to include final_action from the brief and hit from outcome
drop view if exists v_brief_outcomes;
create view v_brief_outcomes as
select
  b.id            as brief_id,
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
