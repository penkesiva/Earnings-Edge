-- Exit tracking for auto-trade positions: close order, exit price, realized P&L.
-- Run in the Supabase SQL editor after deploy.

begin;

alter table trade_orders
  add column if not exists exit_price numeric,
  add column if not exists realized_pnl_usd numeric(12, 2),
  add column if not exists close_order_id text,
  add column if not exists closed_at timestamptz;

alter table trade_orders drop constraint if exists trade_orders_status_check;
alter table trade_orders add constraint trade_orders_status_check
  check (status in ('pending', 'submitted', 'filled', 'failed', 'cancelled', 'skipped', 'closed'));

comment on column trade_orders.realized_pnl_usd is
  'Realized paper P&L computed at close: (exit-entry)*qty for longs, inverted for shorts.';

notify pgrst, 'reload schema';

commit;
