-- One entry evaluation row per session (upsert from entry cron).

begin;

delete from pm_trade_signals a
using pm_trade_signals b
where a.session_id = b.session_id
  and a.created_at < b.created_at;

alter table pm_trade_signals drop constraint if exists pm_trade_signals_session_key;
alter table pm_trade_signals add constraint pm_trade_signals_session_key unique (session_id);

notify pgrst, 'reload schema';

commit;
