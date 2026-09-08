-- Live table QR is eligible in the public menu and API channel policy. Remove
-- the older table-only exclusion inside the shared draw, preserving session,
-- device, rate, daily replay, event/schedule and delivery checks verbatim.
do $migration$
declare
  v_source text := replace(pg_get_functiondef('public.draw_public_lottery(text,text)'::regprocedure), chr(13), '');
  v_old text := $guard$         and (qr.dining_table_id is not null
           or qr.market_event_id is not null
           or qr.stall_schedule_id is not null
           or qr.fulfillment_type_context in (
             'DINE_IN'::public.fulfillment_type,
             'DELIVERY'::public.fulfillment_type
           ))$guard$;
  v_new text := $guard$         and (qr.market_event_id is not null
           or qr.stall_schedule_id is not null
           or qr.fulfillment_type_context = 'DELIVERY'::public.fulfillment_type)$guard$;
begin
  if strpos(v_source, v_old) = 0 then
    raise exception 'TABLE_LOTTERY_CHANNEL_ANCHOR_MISSING';
  end if;
  execute replace(v_source, v_old, v_new);
end;
$migration$;
