create or replace function public.lookup_resumable_public_order(
  p_qr_token text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text,
  p_ordering_mode text
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
  if p_ordering_mode not in ('DEFAULT', 'PREORDER') then
    return null;
  end if;

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
    and session_record.ordering_mode = p_ordering_mode
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

revoke all on function public.lookup_resumable_public_order(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_order(text, text, text, text, text, text, text)
  to service_role;

create or replace function public.lookup_resumable_public_delivery_order(
  p_qr_token text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text,
  p_ordering_mode text
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
  if p_ordering_mode <> 'DELIVERY' then
    return null;
  end if;

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
    and session_record.ordering_mode = p_ordering_mode
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

revoke all on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text, text)
  to service_role;

-- Keep the legacy overload during rolling deploys. Without an ordering mode it
-- cannot distinguish DEFAULT from PREORDER, so it deliberately fails closed.
create or replace function public.lookup_resumable_public_order(
  p_qr_token text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language sql
set search_path = ''
as $$
  select null::jsonb;
$$;

revoke all on function public.lookup_resumable_public_order(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_order(text, text, text, text, text, text)
  to service_role;

-- The delivery-only legacy entry point is unambiguous, so it can safely
-- delegate to the mode-isolated overload while old instances drain.
create or replace function public.lookup_resumable_public_delivery_order(
  p_qr_token text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language sql
set search_path = ''
as $$
  select public.lookup_resumable_public_delivery_order(
    p_qr_token,
    p_device_hash,
    p_ip_hash,
    p_qr_token_hash,
    p_behavior_hash,
    p_request_id,
    'DELIVERY'
  );
$$;

revoke all on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.lookup_resumable_public_delivery_order(text, text, text, text, text, text)
  to service_role;
