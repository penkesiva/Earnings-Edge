-- Manual earnings date override per watchlist ticker.
-- Helps free-tier FMP users force known upcoming dates so daily scan can run.

alter table watchlist
  add column if not exists manual_earnings_date date,
  add column if not exists manual_timing text check (manual_timing in ('BMO', 'AMC', 'UNK'));

comment on column watchlist.manual_earnings_date is
  'Optional manual earnings date override (YYYY-MM-DD) used during sync.';
comment on column watchlist.manual_timing is
  'Optional manual timing override for manual earnings date: BMO/AMC/UNK.';
