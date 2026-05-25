-- Per-ticker Scan All lock — one active run per ticker, 10-minute cooldown.

create table if not exists ticker_scan_locks (
  ticker text primary key,
  run_id uuid not null,
  locked_until timestamptz not null,
  started_at timestamptz not null default now(),
  brief_id uuid references earnings_briefs (id) on delete set null
);

grant all on ticker_scan_locks to postgres, anon, authenticated, service_role;

create or replace function acquire_ticker_scan_lock(
  p_ticker text,
  p_brief_id uuid default null,
  p_lock_minutes int default 10
)
returns jsonb
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_until timestamptz := v_now + make_interval(mins => p_lock_minutes);
  v_run_id uuid := gen_random_uuid();
  v_existing timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(upper(p_ticker)));

  select locked_until into v_existing
  from ticker_scan_locks
  where ticker = p_ticker;

  if v_existing is not null and v_existing > v_now then
    return jsonb_build_object(
      'acquired', false,
      'locked_until', v_existing,
      'run_id', (select run_id from ticker_scan_locks where ticker = p_ticker)
    );
  end if;

  insert into ticker_scan_locks (ticker, run_id, locked_until, started_at, brief_id)
  values (p_ticker, v_run_id, v_until, v_now, p_brief_id)
  on conflict (ticker) do update set
    run_id = excluded.run_id,
    locked_until = excluded.locked_until,
    started_at = excluded.started_at,
    brief_id = excluded.brief_id;

  return jsonb_build_object(
    'acquired', true,
    'locked_until', v_until,
    'run_id', v_run_id
  );
end;
$$;

grant execute on function acquire_ticker_scan_lock(text, uuid, int) to postgres, anon, authenticated, service_role;
