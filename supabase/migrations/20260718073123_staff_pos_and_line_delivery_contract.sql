-- Staff POS and stable LINE delivery entrypoint contract.
alter table public.stall_ordering_settings
  add column if not exists delivery_module_enabled boolean not null default false;

alter table public.orders
  add column if not exists delivery_address text;

alter table public.order_sessions
  add column if not exists ordering_mode text not null default 'DEFAULT';

alter table public.order_sessions
  drop constraint if exists order_sessions_ordering_mode_check;
alter table public.order_sessions
  add constraint order_sessions_ordering_mode_check
  check (ordering_mode in ('DEFAULT', 'DELIVERY'));

alter table public.orders
  drop constraint if exists orders_delivery_fields_check;
alter table public.orders
  add constraint orders_delivery_fields_check check (
    (
      fulfillment_type = 'DELIVERY'::public.fulfillment_type
      and delivery_address is not null
      and char_length(btrim(delivery_address)) between 1 and 300
      and customer_phone is not null
      and char_length(btrim(customer_phone)) between 6 and 30
    )
    or (
      fulfillment_type <> 'DELIVERY'::public.fulfillment_type
      and delivery_address is null
    )
  );

create index if not exists orders_stall_fulfillment_created_idx
  on public.orders (stall_id, fulfillment_type, created_at desc);

create or replace function public.lookup_resumable_public_delivery_order(
  p_qr_token text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_status public.order_status;
  v_organization_id uuid;
  v_tenant_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
  v_order_session_id uuid;
begin
  select
    order_record.id,
    order_record.status,
    qr.organization_id,
    qr.tenant_id,
    qr.stall_id,
    qr.id,
    session_record.id
  into
    v_order_id,
    v_order_status,
    v_organization_id,
    v_tenant_id,
    v_stall_id,
    v_qr_code_id,
    v_order_session_id
  from public.qr_codes qr
  join public.order_sessions session_record on session_record.qr_code_id = qr.id
  join public.orders order_record on order_record.id = session_record.order_id
  where qr.token = p_qr_token
    and qr.dining_table_id is null
    and session_record.device_hash = p_device_hash
    and session_record.ordering_mode = 'DELIVERY'
    and order_record.device_hash = p_device_hash
    and order_record.fulfillment_type = 'DELIVERY'::public.fulfillment_type
    and order_record.status in (
      'WAITING_CONFIRMATION'::public.order_status,
      'CONFIRMED'::public.order_status,
      'PREPARING'::public.order_status,
      'READY'::public.order_status
    )
  order by order_record.created_at desc, order_record.id desc
  limit 1;

  if v_order_id is null then
    return null;
  end if;

  perform public.record_public_order_attempt(
    p_request_id,
    'SESSION_RESUME',
    'ALLOWED',
    'ACTIVE_DELIVERY_ORDER_FOUND',
    v_tenant_id,
    v_stall_id,
    v_qr_code_id,
    v_order_session_id,
    p_ip_hash,
    p_device_hash,
    p_qr_token_hash,
    null,
    p_behavior_hash,
    null
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_status', v_order_status,
    'organization_id', v_organization_id,
    'stall_id', v_stall_id,
    'qr_code_id', v_qr_code_id,
    'order_session_id', v_order_session_id
  );
end;
$$;

revoke all on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text)
  to service_role;

create or replace function public.create_public_delivery_order(
  p_order_id uuid,
  p_qr_token text,
  p_session_token_hash text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_idempotency_key uuid,
  p_idempotency_hash text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_customer_note text,
  p_items jsonb,
  p_tracking_token_hash text,
  p_pickup_code_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_idempotent_replay boolean;
  v_delivery_enabled boolean;
  v_table_id uuid;
  v_stall_id uuid;
  v_existing_fulfillment public.fulfillment_type;
begin
  if char_length(btrim(coalesce(p_customer_phone, ''))) not between 6 and 30
    or char_length(btrim(coalesce(p_delivery_address, ''))) not between 1 and 300 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DELIVERY_DETAILS');
  end if;

  select settings.delivery_module_enabled, qr.dining_table_id, session_record.stall_id
  into v_delivery_enabled, v_table_id, v_stall_id
  from public.order_sessions session_record
  join public.qr_codes qr on qr.id = session_record.qr_code_id
  join public.stall_ordering_settings settings on settings.stall_id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash
    and session_record.ordering_mode = 'DELIVERY';

  if v_stall_id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  elsif not coalesce(v_delivery_enabled, false) or v_table_id is not null then
    return jsonb_build_object('ok', false, 'code', 'DELIVERY_UNAVAILABLE');
  end if;

  v_result := public.create_public_order(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );

  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);

  if v_idempotent_replay then
    select fulfillment_type into v_existing_fulfillment
    from public.orders where id = v_order_id;
    if v_existing_fulfillment <> 'DELIVERY'::public.fulfillment_type then
      return jsonb_build_object('ok', false, 'code', 'ORDER_MODE_CONFLICT');
    end if;
  else
    update public.orders
    set fulfillment_type = 'DELIVERY'::public.fulfillment_type,
        source = 'LINE_DELIVERY',
        customer_phone = left(btrim(p_customer_phone), 30),
        delivery_address = left(btrim(p_delivery_address), 300),
        pickup_code_hash = null,
        updated_at = now()
    where id = v_order_id and stall_id = v_stall_id;

    insert into public.order_events (
      id, organization_id, stall_id, order_id, event_type,
      previous_status, new_status, created_at
    )
    select gen_random_uuid(), organization_id, stall_id, id, 'PUBLIC_DELIVERY_ORDER_CREATED',
      null, status, now()
    from public.orders where id = v_order_id;

    update public.audit_logs
    set metadata = (
      coalesce(nullif(metadata, ''), '{}')::jsonb
      || jsonb_build_object('fulfillmentType', 'DELIVERY', 'source', 'LINE_DELIVERY')
    )::text
    where entity_id = v_order_id and action = 'PUBLIC_ORDER_CREATED';
  end if;

  v_result := jsonb_set(v_result, '{order,fulfillment_type}', to_jsonb('DELIVERY'::text), true);
  v_result := jsonb_set(v_result, '{order,pickup_required}', 'false'::jsonb, true);
  return v_result;
end;
$$;

revoke all on function public.create_public_delivery_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_delivery_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text
) to service_role;

create or replace function public.queue_confirmed_order_print_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer_id uuid;
begin
  if new.status <> 'CONFIRMED'::public.order_status
     or (tg_op = 'UPDATE' and old.status = 'CONFIRMED'::public.order_status)
     or not exists (
       select 1 from public.stall_ordering_settings settings
       where settings.stall_id = new.stall_id and settings.print_module_enabled
     ) then
    return null;
  end if;

  select printer.id into v_printer_id
  from public.printers printer
  where printer.stall_id = new.stall_id
    and printer.organization_id = new.organization_id
    and printer.is_enabled
  order by (printer.last_seen_at >= now() - interval '90 seconds') desc,
    printer.last_seen_at desc nulls last, printer.created_at asc
  limit 1;

  insert into public.print_jobs (
    organization_id, stall_id, order_id, printer_id, status,
    queued_at, created_at, updated_at
  ) values (
    new.organization_id, new.stall_id, new.id, v_printer_id,
    'PENDING'::public.print_job_status, now(), now(), now()
  ) on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.queue_confirmed_order_print_job() from public, anon, authenticated;
grant execute on function public.queue_confirmed_order_print_job() to service_role;

drop trigger if exists orders_queue_print_job on public.orders;
create trigger orders_queue_print_job
after insert or update of status on public.orders
for each row execute function public.queue_confirmed_order_print_job();

create or replace function public.get_public_order(
  p_tracking_token_hash text,
  p_device_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', order_record.id,
    'orderNo', order_record.order_no,
    'orderStatus', order_record.status,
    'paymentStatus', order_record.payment_status,
    'totalAmount', order_record.total,
    'createdAt', order_record.created_at,
    'confirmedAt', order_record.confirmed_at,
    'completedAt', order_record.completed_at,
    'stallName', stall.name,
    'fulfillmentType', order_record.fulfillment_type,
    'tableLabel', order_record.table_label,
    'customerPhone', order_record.customer_phone,
    'deliveryAddress', order_record.delivery_address,
    'pickupCodeLength', order_record.pickup_code_length,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'quantity', item.quantity,
        'status', item.status,
        'note', item.note,
        'noteOptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'groupName', note.group_name,
            'optionName', note.option_name,
            'priceDelta', note.price_delta
          ) order by note.sort_order, note.id)
          from public.order_item_note_options note where note.order_item_id = item.id
        ), '[]'::jsonb)
      ) order by item.created_at, item.id)
      from public.order_items item where item.order_id = order_record.id
    ), '[]'::jsonb)
  )
  from public.orders order_record
  join public.stalls stall on stall.id = order_record.stall_id
  where order_record.tracking_token_hash = p_tracking_token_hash
    and order_record.device_hash = p_device_hash;
$$;

revoke all on function public.get_public_order(text, text) from public, anon, authenticated;
grant execute on function public.get_public_order(text, text) to service_role;
