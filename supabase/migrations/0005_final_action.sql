-- Reconciled single final action (replaces split signal + scream_recommendation display)

alter table earnings_briefs
  add column if not exists final_action text,
  add column if not exists final_action_rationale text;

comment on column earnings_briefs.final_action is
  'Reconciled trade action: SKIP | IRON_CONDOR | LONG_CALL | LONG_PUT | CALL_DEBIT_SPREAD | PUT_DEBIT_SPREAD';
comment on column earnings_briefs.final_action_rationale is
  'One-line explanation of why reconcileSignals() chose this action';

create index if not exists earnings_briefs_final_action_idx
  on earnings_briefs (final_action)
  where final_action is not null;
