-- Option auto-trade metadata on trade_orders (GO/WATCH consensus legs).

begin;

alter table trade_orders
  add column if not exists instrument_type text not null default 'equity'
    check (instrument_type in ('equity', 'option_single', 'option_mleg')),
  add column if not exists option_legs jsonb;

comment on column trade_orders.instrument_type is
  'equity = stock proxy; option_* = consensus TRADE LEG execution';
comment on column trade_orders.option_legs is
  'Alpaca OCC legs [{symbol, side}] for close-out';

notify pgrst, 'reload schema';

commit;
