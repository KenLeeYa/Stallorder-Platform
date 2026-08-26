-- Keep three-digit pickup codes unique for active takeaway orders on the same
-- stall fulfillment business date. Historical codes remain on the order for
-- auditability and become reusable after pickup, a terminal state, or a new day.

alter table public.orders
  add column if not exists pickup_code_service_date date;

create unique index if not exists orders_active_pickup_code_service_date_key
  on public.orders (stall_id, pickup_code_service_date, pickup_code_display)
  where fulfillment_type = 'TAKEOUT'::public.fulfillment_type
    and pickup_code_service_date is not null
    and pickup_code_display is not null
    and pickup_verified_at is null
    and status not in (
      'COMPLETED'::public.order_status,
      'CANCELLED'::public.order_status,
      'EXPIRED'::public.order_status
    );

create function app_private.assign_daily_pickup_code(
  p_order_id uuid,
  p_reassign boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_service_date date;
  v_candidate smallint;
  v_code text;
begin
  select
    order_record.id,
    order_record.stall_id,
    order_record.fulfillment_type,
    order_record.pickup_code_display,
    order_record.pickup_code_service_date,
    order_record.scheduled_pickup_at,
    order_record.requested_fulfillment_at,
    order_record.created_at
  into v_order
  from public.orders order_record
  where order_record.id = p_order_id
  for update;

  if not found then
    raise exception 'PICKUP_CODE_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_order.fulfillment_type <> 'TAKEOUT'::public.fulfillment_type then
    return null;
  end if;

  v_service_date := public.stall_business_date(
    v_order.stall_id,
    coalesce(
      v_order.scheduled_pickup_at,
      v_order.requested_fulfillment_at,
      v_order.created_at
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'pickup-code:' || v_order.stall_id::text || ':' || v_service_date::text,
    0
  ));

  if not p_reassign
     and v_order.pickup_code_service_date = v_service_date
     and v_order.pickup_code_display ~ '^[0-9]{3}$'
     and v_order.pickup_code_display <> '000' then
    return v_order.pickup_code_display;
  end if;

  if v_order.pickup_code_display ~ '^[0-9]{3}$'
     and v_order.pickup_code_display <> '000'
     and not exists (
       select 1
       from public.orders other_order
       where other_order.id <> v_order.id
         and other_order.stall_id = v_order.stall_id
         and other_order.fulfillment_type = 'TAKEOUT'::public.fulfillment_type
         and other_order.pickup_verified_at is null
         and other_order.status not in (
           'COMPLETED'::public.order_status,
           'CANCELLED'::public.order_status,
           'EXPIRED'::public.order_status
         )
         and coalesce(
           other_order.pickup_code_service_date,
           public.stall_business_date(
             other_order.stall_id,
             coalesce(
               other_order.scheduled_pickup_at,
               other_order.requested_fulfillment_at,
               other_order.created_at
             )
           )
         ) = v_service_date
         and other_order.pickup_code_display = v_order.pickup_code_display
     ) then
    v_code := v_order.pickup_code_display;
  else
    select candidate::smallint
    into v_candidate
    from generate_series(1, 999) candidate
    where not exists (
      select 1
      from public.orders other_order
      where other_order.id <> v_order.id
        and other_order.stall_id = v_order.stall_id
        and other_order.fulfillment_type = 'TAKEOUT'::public.fulfillment_type
        and other_order.pickup_verified_at is null
        and other_order.status not in (
          'COMPLETED'::public.order_status,
          'CANCELLED'::public.order_status,
          'EXPIRED'::public.order_status
        )
        and coalesce(
          other_order.pickup_code_service_date,
          public.stall_business_date(
            other_order.stall_id,
            coalesce(
              other_order.scheduled_pickup_at,
              other_order.requested_fulfillment_at,
              other_order.created_at
            )
          )
        ) = v_service_date
        and other_order.pickup_code_display = lpad(candidate::text, 3, '0')
    )
    order by candidate
    limit 1;

    if v_candidate is null then
      raise exception 'PICKUP_CODE_CAPACITY_EXCEEDED' using errcode = 'P0001';
    end if;
    v_code := lpad(v_candidate::text, 3, '0');
  end if;

  update public.orders
  set pickup_code_display = v_code,
      pickup_code_hash = encode(extensions.digest(v_code, 'sha256'), 'hex'),
      pickup_code_length = 3,
      pickup_code_service_date = v_service_date,
      updated_at = now()
  where id = v_order.id;

  return v_code;
end;
$$;

revoke all on function app_private.assign_daily_pickup_code(uuid, boolean)
from public, anon, authenticated;
grant execute on function app_private.assign_daily_pickup_code(uuid, boolean)
to service_role;

comment on function app_private.assign_daily_pickup_code(uuid, boolean) is
  'Atomically assigns 001-999 without duplicating another active takeaway order on the same stall fulfillment business date.';

create function public.reconcile_active_pickup_codes_targeted(
  p_stall_id uuid,
  p_service_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_date date;
  v_order record;
  v_count integer := 0;
begin
  v_service_date := coalesce(
    p_service_date,
    public.stall_business_date(p_stall_id, now())
  );

  for v_order in
    select order_record.id
    from public.orders order_record
    where order_record.stall_id = p_stall_id
      and order_record.fulfillment_type = 'TAKEOUT'::public.fulfillment_type
      and order_record.pickup_verified_at is null
      and order_record.status not in (
        'COMPLETED'::public.order_status,
        'CANCELLED'::public.order_status,
        'EXPIRED'::public.order_status
      )
      and public.stall_business_date(
        order_record.stall_id,
        coalesce(
          order_record.scheduled_pickup_at,
          order_record.requested_fulfillment_at,
          order_record.created_at
        )
      ) = v_service_date
    order by order_record.created_at, order_record.id
  loop
    perform app_private.assign_daily_pickup_code(v_order.id, true);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'stall_id', p_stall_id,
    'service_date', v_service_date,
    'reconciled_orders', v_count
  );
end;
$$;

revoke all on function public.reconcile_active_pickup_codes_targeted(uuid, date)
from public, anon, authenticated;
grant execute on function public.reconcile_active_pickup_codes_targeted(uuid, date)
to service_role;

comment on function public.reconcile_active_pickup_codes_targeted(uuid, date) is
  'Explicit service-role reconciliation for pre-migration active takeaway orders; not executed implicitly during schema apply.';

create function public.create_public_order_with_daily_pickup_code_targeted(
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
  p_request_id text,
  p_wait_acknowledged boolean,
  p_requested_fulfillment_at timestamptz,
  p_lottery_draw_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_pickup_code text;
begin
  v_result := public.create_public_order_with_free_lottery_reward_targeted(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
    p_items, p_tracking_token_hash, p_pickup_code_hash, p_request_id,
    p_wait_acknowledged, p_requested_fulfillment_at, p_lottery_draw_id
  );

  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_pickup_code := app_private.assign_daily_pickup_code(v_order_id, false);
  if v_pickup_code is not null then
    v_result := jsonb_set(
      v_result,
      '{order,pickup_code_display}',
      to_jsonb(v_pickup_code),
      true
    );
    v_result := jsonb_set(
      v_result,
      '{order,pickup_code_length}',
      to_jsonb(3),
      true
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_public_order_with_daily_pickup_code_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_daily_pickup_code_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) to service_role;

comment on function public.create_public_order_with_daily_pickup_code_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) is
  'Adds an atomic daily three-digit pickup-code assignment after the existing trusted public-order transaction.';
