-- Track saved Final Verdict (AI consensus) separately from system final_action.

alter table earnings_outcomes
  add column if not exists consensus_verdict text
    check (consensus_verdict in ('GO', 'NO-GO', 'WATCH')),
  add column if not exists consensus_direction text
    check (consensus_direction in ('UP', 'DOWN', 'NEUTRAL')),
  add column if not exists consensus_confidence integer,
  add column if not exists consensus_trade_type text,
  add column if not exists consensus_hit boolean;

comment on column earnings_outcomes.consensus_hit is
  'True when the saved Final Verdict direction matched next-day move; neutral/no-trade verdicts are null.';

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
  o.hit,
  o.consensus_verdict,
  o.consensus_direction,
  o.consensus_confidence,
  o.consensus_trade_type,
  o.consensus_hit
from earnings_briefs b
left join earnings_outcomes o on o.brief_id = b.id
order by b.earnings_date desc;

notify pgrst, 'reload schema';
