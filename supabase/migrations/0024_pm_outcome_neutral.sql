-- Allow NEUTRAL actual day when SPY move is within flat-day deadband (see outcomeGrading.ts).

begin;

alter table pm_market_outcomes
  drop constraint if exists pm_market_outcomes_actual_direction_check;

alter table pm_market_outcomes
  add constraint pm_market_outcomes_actual_direction_check
  check (actual_direction in ('GREEN', 'RED', 'NEUTRAL'));

commit;
