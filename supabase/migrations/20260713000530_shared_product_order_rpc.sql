-- Replace the trusted order writer so validation, totals, and order item
-- snapshots all use the effective per-stall product price.
create or replace function public.create_public_order(
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
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_stall public.stalls%rowtype;
  v_tenant public.tenants%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_existing jsonb;
  v_item_count integer;
  v_distinct_count integer;
  v_total_quantity integer;
  v_valid_product_count integer;
  v_total integer;
  v_pending_count integer;
  v_business_date date;
  v_sequence integer;
  v_order_no text;
  v_created_at timestamptz := now();
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_qr boolean;
  v_allowed_session boolean;
  v_allowed_stall boolean;
  v_allowed_behavior boolean;
begin
  select * into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash
  for update;

  if not found then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_NOT_FOUND', null, null, null, null, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  v_existing := public.lookup_public_order_idempotency(p_session_token_hash, p_idempotency_key);
  if v_existing is not null then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ALLOWED', 'IDEMPOTENT_REPLAY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', true, 'idempotent_replay', true, 'order', v_existing);
  end if;

  if v_session.status <> 'ACTIVE'::public.order_session_status then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_REPLAYED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_REPLAYED');
  elsif v_session.expires_at <= now() then
    update public.order_sessions set status = 'EXPIRED'::public.order_session_status where id = v_session.id;
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_EXPIRED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_EXPIRED');
  elsif v_session.device_hash <> p_device_hash then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_DEVICE_MISMATCH', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'SESSION_DEVICE_MISMATCH');
  end if;

  select * into v_qr from public.qr_codes where id = v_session.qr_code_id for share;
  select * into v_stall from public.stalls where id = v_session.stall_id for share;
  select * into v_tenant from public.tenants where id = v_session.tenant_id for share;
  select * into v_settings from public.stall_ordering_settings where stall_id = v_session.stall_id;

  if v_qr.token <> p_qr_token then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_SESSION_MISMATCH', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_SESSION_MISMATCH');
  elsif v_qr.state <> 'ACTIVE'::public.qr_code_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_NOT_ACTIVE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_NOT_ACTIVE');
  elsif v_qr.expires_at is not null and v_qr.expires_at <= now() then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'QR_EXPIRED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'QR_EXPIRED');
  elsif not v_stall.is_active or v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_CLOSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_CLOSED');
  elsif v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'ORDERING_PAUSED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDERING_PAUSED');
  elsif v_stall.is_sold_out then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'STALL_SOLD_OUT', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'STALL_SOLD_OUT');
  elsif v_tenant.status not in ('TRIALING'::public.tenant_status, 'ACTIVE'::public.tenant_status, 'GRACE_PERIOD'::public.tenant_status) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TENANT_INACTIVE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TENANT_INACTIVE');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_ITEMS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'INVALID_ITEMS');
  end if;

  select count(*), count(distinct product_id), coalesce(sum(quantity), 0)
  into v_item_count, v_distinct_count, v_total_quantity
  from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text);

  if v_item_count > v_settings.max_unique_products or v_distinct_count <> v_item_count then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif v_total_quantity > v_settings.max_total_quantity then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_TOTAL_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_TOTAL_QUANTITY');
  elsif exists (
    select 1 from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text)
    where item.quantity < 1 or item.quantity > v_settings.max_item_quantity
       or char_length(coalesce(item.note, '')) > v_settings.max_note_length
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_ITEM_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_ITEM_QUANTITY');
  elsif char_length(coalesce(p_customer_note, '')) > v_settings.max_note_length then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'NOTE_TOO_LONG', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'NOTE_TOO_LONG');
  end if;

  select
    count(*),
    coalesce(sum(coalesce(stall_product.price_override, product.default_price) * requested.quantity), 0)
  into v_valid_product_count, v_total
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer, note text)
  join public.stall_products stall_product
    on stall_product.product_id = requested.product_id
   and stall_product.stall_id = v_session.stall_id
   and stall_product.organization_id = v_session.organization_id
  join public.products product
    on product.id = stall_product.product_id
   and product.organization_id = stall_product.organization_id
  where product.is_active
    and stall_product.is_enabled
    and not stall_product.is_sold_out;

  if v_valid_product_count <> v_item_count then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  select count(*) into v_pending_count
  from public.orders
  where stall_id = v_session.stall_id
    and device_hash = p_device_hash
    and status = 'WAITING_CONFIRMATION'::public.order_status
    and confirmation_expires_at > now();

  if v_pending_count >= v_settings.max_pending_orders_per_device then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_PENDING_ORDERS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_PENDING_ORDERS');
  end if;

  v_allowed_ip := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_IP', p_ip_hash, v_settings.max_orders_per_window, v_settings.order_window_seconds);
  v_allowed_device := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_DEVICE', p_device_hash, v_settings.max_orders_per_window, v_settings.order_window_seconds);
  v_allowed_qr := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_QR', p_qr_token_hash, v_settings.max_orders_per_window * 20, v_settings.order_window_seconds);
  v_allowed_session := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_SESSION', p_session_token_hash, 1, v_settings.order_window_seconds);
  v_allowed_stall := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_STALL', encode(extensions.digest(v_session.stall_id::text, 'sha256'), 'hex'), v_settings.max_orders_per_window * 100, v_settings.order_window_seconds);
  v_allowed_behavior := public.consume_public_rate_limit(v_session.stall_id, 'ORDER_BEHAVIOR', p_behavior_hash, v_settings.max_behavior_frequency, v_settings.order_window_seconds);

  if not (v_allowed_ip and v_allowed_device and v_allowed_qr and v_allowed_session and v_allowed_stall and v_allowed_behavior) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'RATE_LIMITED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  v_business_date := (now() at time zone v_stall.timezone)::date;
  insert into public.stall_order_counters (stall_id, organization_id, business_date, next_value)
  values (v_session.stall_id, v_session.organization_id, v_business_date, 2)
  on conflict (stall_id, business_date)
  do update set next_value = public.stall_order_counters.next_value + 1
  returning next_value - 1 into v_sequence;
  v_order_no := to_char(v_business_date, 'YYMMDD') || '-' || lpad(v_sequence::text, 3, '0');

  insert into public.orders (
    id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
    idempotency_key, source, customer_name, customer_phone,
    table_label, note, status, payment_status, total, device_hash,
    pickup_code_hash, confirmation_expires_at, created_at, updated_at
  ) values (
    p_order_id, v_session.tenant_id, v_session.organization_id, v_session.stall_id, v_order_no,
    p_tracking_token_hash, p_idempotency_key, 'QR_MENU',
    coalesce(nullif(left(trim(p_customer_name), 50), ''), '現場顧客'),
    null, null, nullif(left(trim(p_customer_note), v_settings.max_note_length), ''),
    'WAITING_CONFIRMATION'::public.order_status,
    'UNPAID'::public.payment_status, v_total, p_device_hash,
    p_pickup_code_hash,
    v_created_at + make_interval(secs => v_settings.unconfirmed_order_timeout_seconds),
    v_created_at, v_created_at
  );

  insert into public.order_items (
    id, tenant_id, organization_id, stall_id, order_id, product_id, name,
    unit_price, quantity, note, created_at
  )
  select
    gen_random_uuid(),
    v_session.tenant_id,
    v_session.organization_id,
    v_session.stall_id,
    p_order_id,
    product.id,
    product.name,
    coalesce(stall_product.price_override, product.default_price),
    requested.quantity,
    nullif(left(trim(requested.note), v_settings.max_note_length), ''),
    v_created_at
  from jsonb_to_recordset(p_items) as requested(product_id uuid, quantity integer, note text)
  join public.stall_products stall_product
    on stall_product.product_id = requested.product_id
   and stall_product.stall_id = v_session.stall_id
   and stall_product.organization_id = v_session.organization_id
  join public.products product
    on product.id = stall_product.product_id
   and product.organization_id = stall_product.organization_id
  where product.is_active
    and stall_product.is_enabled
    and not stall_product.is_sold_out;

  update public.order_sessions
  set status = 'CONSUMED'::public.order_session_status,
      used_at = v_created_at,
      order_id = p_order_id
  where id = v_session.id and status = 'ACTIVE'::public.order_session_status;

  insert into public.order_events (
    id, tenant_id, organization_id, stall_id, order_id, event_type,
    previous_status, new_status, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.organization_id, v_session.stall_id,
    p_order_id, 'PUBLIC_ORDER_CREATED', null,
    'WAITING_CONFIRMATION'::public.order_status, v_created_at
  );

  insert into public.audit_logs (
    id, tenant_id, organization_id, stall_id, action, entity_type, entity_id,
    outcome, request_id, ip_hash, metadata, created_at
  ) values (
    gen_random_uuid(), v_session.tenant_id, v_session.organization_id, v_session.stall_id,
    'PUBLIC_ORDER_CREATED', 'ORDER', p_order_id,
    'SUCCESS'::public.audit_outcome, left(p_request_id, 100), p_ip_hash,
    jsonb_build_object('itemCount', v_item_count, 'total', v_total)::text,
    v_created_at
  );

  perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ALLOWED', 'ORDER_CREATED', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
  return jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'order', jsonb_build_object(
      'order_id', p_order_id,
      'order_no', v_order_no,
      'order_status', 'WAITING_CONFIRMATION',
      'payment_status', 'UNPAID',
      'total_amount', v_total,
      'created_at', v_created_at
    )
  );
exception
  when unique_violation then
    v_existing := public.lookup_public_order_idempotency(p_session_token_hash, p_idempotency_key);
    if v_existing is not null then
      return jsonb_build_object('ok', true, 'idempotent_replay', true, 'order', v_existing);
    end if;
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ERROR', 'UNIQUE_CONFLICT', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDER_CONFLICT');
  when others then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'ERROR', 'ORDER_CREATE_ERROR', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'ORDER_CREATE_ERROR');
end;
$$;
