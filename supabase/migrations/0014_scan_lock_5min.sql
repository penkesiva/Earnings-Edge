-- Scan All cooldown: 10 min → 5 min (app passes p_lock_minutes from AI_SCAN_COOLDOWN_MS).

create or replace function acquire_ticker_scan_lock(
  p_ticker text,
  p_brief_id uuid default null,
  p_lock_minutes int default 5
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
