-- Scream Test — directional options conviction (companions beat score)

alter table earnings_briefs
  add column if not exists scream_score integer,
  add column if not exists scream_direction text,
  add column if not exists scream_recommendation text,
  add column if not exists scream_qualifies boolean,
  add column if not exists scream_filters jsonb,
  add column if not exists scream_notes jsonb;

comment on column earnings_briefs.scream_score is 'Scream Test: filters passed 0–5';
comment on column earnings_briefs.scream_qualifies is 'True when score≥4 and single directional bias';

create index if not exists earnings_briefs_scream_score_idx on earnings_briefs (scream_score desc nulls last)
  where scream_score is not null;
