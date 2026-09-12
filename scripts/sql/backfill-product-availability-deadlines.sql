-- Run only after the reviewed Primary schema Apply. DR receives these rows
-- through replication; its schema migration must never perform this backfill.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  runtime_state public.backend_runtime_state%rowtype;
begin
  select * into strict runtime_state
  from public.backend_runtime_state where is_current for share;
  if runtime_state.backend_code <> 'PRIMARY'
    or runtime_state.backend_role <> 'ACTIVE_WRITER'
    or not runtime_state.writes_enabled
    or not runtime_state.enforcement_enabled then
    raise exception 'AVAILABILITY_BACKFILL_REQUIRES_PRIMARY_WRITER';
  end if;
  perform app_private.assert_backend_writable(runtime_state.promotion_epoch);
end;
$$;

with updated as (
  update public.stall_products
  set sold_out_until = public.product_next_service_day(stall_id)
  where is_sold_out and sold_out_until is null
  returning 1
)
select count(*)::integer as updated_product_count from updated;
commit;
