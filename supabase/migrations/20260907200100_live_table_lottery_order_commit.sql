-- Keep order commit aligned with the live-table draw channel. Both the legacy
-- and targeted entry points retain their tenant/device/replay/redemption checks.
do $migration$
declare
  v_function record;
  v_source text;
  v_count integer := 0;
  v_old text := $guard$    if v_session.ordering_mode <> 'DEFAULT'
       or v_qr.dining_table_id is not null
       or v_qr.market_event_id is not null
       or v_qr.stall_schedule_id is not null
       or v_qr.fulfillment_type_context in (
         'DINE_IN'::public.fulfillment_type,
         'DELIVERY'::public.fulfillment_type
       ) then$guard$;
  v_new text := $guard$    if v_session.ordering_mode <> 'DEFAULT'
       or v_qr.market_event_id is not null
       or v_qr.stall_schedule_id is not null
       or v_qr.fulfillment_type_context = 'DELIVERY'::public.fulfillment_type then$guard$;
begin
  for v_function in select oid from pg_proc
    where (pronamespace = 'public'::regnamespace and proname = 'create_public_order_with_experience')
       or (pronamespace = 'app_private'::regnamespace and proname = 'create_public_order_with_experience_targeted')
  loop
    v_source := replace(pg_get_functiondef(v_function.oid), chr(13), '');
    if strpos(v_source, v_old) = 0 then
      raise exception 'TABLE_LOTTERY_COMMIT_ANCHOR_MISSING: %', v_function.oid::regprocedure;
    end if;
    execute replace(v_source, v_old, v_new);
    v_count := v_count + 1;
  end loop;
  if v_count <> 2 then raise exception 'TABLE_LOTTERY_COMMIT_FUNCTION_COUNT: %', v_count; end if;
end;
$migration$;
