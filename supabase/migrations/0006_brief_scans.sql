-- Scan history log — one row per ticker per scan run.
-- Used to detect meaningful signal flips between scans on the brief page.

create table if not exists brief_scans (
  id              serial primary key,
  ticker          text not null,
  scan_timestamp  timestamptz not null default now(),
  reconciled_action text,   -- SKIP | IRON_CONDOR | LONG_CALL | LONG_PUT | CALL_DEBIT_SPREAD | PUT_DEBIT_SPREAD
  scream_score    integer,  -- 0-5
  iv_rank         integer,  -- 0-100
  directional_bias text     -- bullish | bearish | mixed | none
);

create index if not exists idx_scans_ticker_time
  on brief_scans (ticker, scan_timestamp desc);
