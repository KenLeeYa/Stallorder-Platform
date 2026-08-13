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
