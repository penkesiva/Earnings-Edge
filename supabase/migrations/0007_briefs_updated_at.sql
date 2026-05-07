-- Track when each brief was last re-scanned (upsert refreshes this column)
alter table earnings_briefs
  add column if not exists updated_at timestamptz default now();

-- Back-fill existing rows
update earnings_briefs set updated_at = generated_at where updated_at is null;

-- Auto-update on every row change
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists earnings_briefs_updated_at on earnings_briefs;
create trigger earnings_briefs_updated_at
  before update on earnings_briefs
  for each row execute function set_updated_at();
