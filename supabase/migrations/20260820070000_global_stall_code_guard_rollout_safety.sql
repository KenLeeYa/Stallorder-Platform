set local lock_timeout = '5s';
set local statement_timeout = '2min';

lock table public.stalls in share row exclusive mode;

create index if not exists stalls_code_lower_lookup_idx
on public.stalls ((lower(code)));

create or replace function public.enforce_global_stall_code_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := pg_catalog.lower(pg_catalog.btrim(new.code));
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_code, 0)
  );

  if exists (
    select 1
    from public.stalls existing_stall
    where pg_catalog.lower(existing_stall.code) = normalized_code
      and existing_stall.id is distinct from new.id
  ) then
    raise unique_violation using
      message = 'Stall code is already in use.',
      constraint = 'stalls_code_lower_guard';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_global_stall_code_guard() from public;

drop trigger if exists stalls_validate_global_code_before_write on public.stalls;
create trigger stalls_validate_global_code_before_write
before insert or update on public.stalls
for each row execute function public.enforce_global_stall_code_guard();

do $migration$
declare
  collision_code text;
begin
  select pg_catalog.lower(stall.code)
    into collision_code
  from public.stalls stall
  group by pg_catalog.lower(stall.code)
  having pg_catalog.count(*) > 1
  order by pg_catalog.lower(stall.code)
  limit 1;

  if found then
    raise unique_violation using
      message = 'GLOBAL_STALL_CODE_COLLISION',
      detail = pg_catalog.format(
        'normalized code %L already exists more than once',
        collision_code
      ),
      constraint = 'stalls_code_lower_guard';
  end if;
end;
$migration$;
