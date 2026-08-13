do $audit$
begin
  if exists (
    select 1
    from public.stalls
    group by pg_catalog.lower(code)
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'GLOBAL_STALL_CODE_COLLISION';
  end if;
end;
$audit$;
