-- Per-stall QR locales, active-order recovery, and pickup verification controls.
alter table public.stall_ordering_settings
  add column if not exists enabled_locales text[] not null
  default array['zh-TW', 'en', 'ja', 'ko', 'vi', 'th']::text[];

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_enabled_locales_check;
alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_enabled_locales_check check (
    cardinality(enabled_locales) between 1 and 6
    and array['zh-TW']::text[] <@ enabled_locales
    and enabled_locales <@ array['zh-TW', 'en', 'ja', 'ko', 'vi', 'th']::text[]
    and array_position(enabled_locales, null) is null
  );

-- Existing active orders retain their original six-digit code. New orders use
-- the three-digit default, which allows a rolling deployment without invalidating pickup codes.
alter table public.orders
  add column if not exists pickup_code_length smallint not null default 6;
alter table public.orders alter column pickup_code_length set default 3;
alter table public.orders
  drop constraint if exists orders_pickup_code_length_check;
alter table public.orders
  add constraint orders_pickup_code_length_check check (pickup_code_length in (3, 6));

alter table public.orders
  add column if not exists pickup_verification_method text;
alter table public.orders
  drop constraint if exists orders_pickup_verification_method_check;
alter table public.orders
  add constraint orders_pickup_verification_method_check check (
    pickup_verification_method is null or pickup_verification_method in ('CODE', 'MANUAL')
  );

create index if not exists order_sessions_qr_device_order_idx
  on public.order_sessions (qr_code_id, device_hash, created_at desc)
  where order_id is not null;

create or replace function public.lookup_resumable_public_order(
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
  v_tenant_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
  v_order_session_id uuid;
begin
  select
    order_record.id,
    order_record.status,
    qr.tenant_id,
    qr.stall_id,
    qr.id,
    session_record.id
  into
    v_order_id,
    v_order_status,
    v_tenant_id,
    v_stall_id,
    v_qr_code_id,
    v_order_session_id
  from public.qr_codes qr
  join public.order_sessions session_record on session_record.qr_code_id = qr.id
  join public.orders order_record on order_record.id = session_record.order_id
  where qr.token = p_qr_token
    and session_record.device_hash = p_device_hash
    and order_record.device_hash = p_device_hash
    and order_record.source = 'QR_MENU'
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
    'ACTIVE_ORDER_FOUND',
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
    'stall_id', v_stall_id,
    'qr_code_id', v_qr_code_id,
    'order_session_id', v_order_session_id
  );
end;
$$;

revoke all on function public.lookup_resumable_public_order(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_order(text, text, text, text, text, text)
  to service_role;

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
