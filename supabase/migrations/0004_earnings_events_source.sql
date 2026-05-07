-- Mark whether an earnings_events row came from FMP or manual watchlist override.

alter table earnings_events
  add column if not exists source text check (source in ('FMP', 'MANUAL')) default 'FMP';

comment on column earnings_events.source is
  'Origin of earnings date row: FMP feed or manual watchlist override.';
