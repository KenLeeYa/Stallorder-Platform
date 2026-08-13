do $migration$
declare
  collision_code text;
begin
  select lower(stall.code)
  into collision_code
  from public.stalls stall
  group by lower(stall.code)
  having count(*) > 1
  order by lower(stall.code)
  limit 1;

  if collision_code is not null then
    raise exception 'PUBLIC_STALL_CODE_COLLISION: %', collision_code
      using errcode = '23505';
  end if;
end
$migration$;

create unique index if not exists stalls_code_lower_unique_idx
on public.stalls ((lower(code)));
