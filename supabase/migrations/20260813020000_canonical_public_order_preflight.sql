create function public.public_order_preflight(
  p_scope text,
  p_qr_token text,
  p_ordering_mode text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text,
  p_session_token_hash text default null,
  p_idempotency_key uuid default null,
  p_idempotency_hash text default null,
  p_requested_fulfillment_at timestamptz default null,
  p_lottery_draw_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_wait_acknowledged boolean default false,
  p_intake_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := upper(coalesce(trim(p_scope), ''));
  v_ordering_mode text := upper(coalesce(trim(p_ordering_mode), ''));
  v_qr public.qr_codes%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_table public.dining_tables%rowtype;
  v_session public.order_sessions%rowtype;
  v_capacity jsonb;
  v_resumable_order jsonb;
  v_idempotent_order jsonb;
  v_qr_context jsonb;
  v_schedule_context jsonb;
  v_schedule_code text;
  v_code text;
begin
  if v_scope not in ('SESSION', 'ORDER') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  if v_ordering_mode not in ('DEFAULT', 'DELIVERY', 'PREORDER') then
    return jsonb_build_object(
      'ok', false,
      'code', 'ORDER_MODE_CONFLICT',
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', null,
      'schedule_context', jsonb_build_object('ok', false, 'code', 'ORDER_MODE_CONFLICT'),
      'capacity', null,
      'resumable_order', null,
      'idempotent_order', null
    );
  end if;

  if v_scope = 'ORDER' then
    select *
    into v_session
    from public.order_sessions session_record
    where session_record.token_hash = p_session_token_hash;

    if not found then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'SESSION_NOT_FOUND',
        null, null, null, null, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'SESSION_NOT_FOUND',
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', null,
        'schedule_context', null,
        'capacity', null,
        'resumable_order', null,
        'idempotent_order', null
      );
    end if;

    if v_session.ordering_mode <> v_ordering_mode then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'ORDER_MODE_CONFLICT',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false,
        'code', 'ORDER_MODE_CONFLICT',
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', null,
        'schedule_context', jsonb_build_object('ok', false, 'code', 'ORDER_MODE_CONFLICT'),
        'capacity', null,
        'resumable_order', null,
        'idempotent_order', null
      );
    end if;

    select *
    into v_qr
    from public.qr_codes qr
    where qr.id = v_session.qr_code_id
      and qr.token = p_qr_token;
  else
    select *
    into v_qr
    from public.qr_codes qr
    where qr.token = p_qr_token;
  end if;

  if not found then
    perform public.record_public_order_attempt(
      p_request_id,
      case when v_scope = 'SESSION' then 'SESSION_ISSUE' else 'ORDER_SUBMIT' end,
      'DENIED',
      case when v_scope = 'SESSION' then 'QR_NOT_FOUND' else 'SESSION_NOT_FOUND' end,
      case when v_scope = 'ORDER' then v_session.tenant_id else null end,
      case when v_scope = 'ORDER' then v_session.stall_id else null end,
      case when v_scope = 'ORDER' then v_session.qr_code_id else null end,
      case when v_scope = 'ORDER' then v_session.id else null end,
      p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash,
      p_behavior_hash, case when v_scope = 'ORDER' then p_idempotency_hash else null end
    );
    v_code := case when v_scope = 'SESSION' then 'QR_NOT_FOUND' else 'SESSION_NOT_FOUND' end;
    return jsonb_build_object(
      'ok', false,
      'code', v_code,
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', null,
      'schedule_context', null,
      'capacity', null,
      'resumable_order', null,
      'idempotent_order', null
    );
  end if;

  select *
  into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_qr.stall_id;
  if v_qr.dining_table_id is not null then
    select *
    into v_table
    from public.dining_tables dining_table
    where dining_table.id = v_qr.dining_table_id
      and dining_table.stall_id = v_qr.stall_id;
  end if;

  v_qr_context := jsonb_build_object(
    'tenant_id', v_qr.tenant_id,
    'organization_id', v_qr.organization_id,
    'stall_id', v_qr.stall_id,
    'qr_code_id', v_qr.id,
    'dining_table_id', v_qr.dining_table_id,
    'fulfillment_type_context', v_qr.fulfillment_type_context,
    'table', case when v_qr.dining_table_id is null then null else jsonb_build_object(
      'id', v_table.id,
      'label', v_table.label,
      'code', v_table.code,
      'is_active', coalesce(v_table.is_active, false)
    ) end,
    'settings', jsonb_build_object(
      'max_item_quantity', v_settings.max_item_quantity,
      'max_unique_products', v_settings.max_unique_products,
      'max_total_quantity', v_settings.max_total_quantity,
      'max_note_length', v_settings.max_note_length,
      'dine_in_enabled', v_settings.dine_in_enabled,
      'delivery_module_enabled', v_settings.delivery_module_enabled,
      'takeout_preorder_enabled', v_settings.takeout_preorder_enabled,
      'enabled_locales', v_settings.enabled_locales,
      'estimated_wait_minutes', v_settings.estimated_wait_minutes,
      'lottery_enabled', v_settings.lottery_enabled
    )
  );
  v_schedule_code := public.validate_ordering_schedule_context(v_qr.id, v_ordering_mode);
  v_schedule_context := jsonb_build_object(
    'ok', v_schedule_code is null,
    'code', v_schedule_code,
    'location_id', v_qr.location_id,
    'market_event_id', v_qr.market_event_id,
    'stall_schedule_id', v_qr.stall_schedule_id,
    'fulfillment_type_context', v_qr.fulfillment_type_context
  );
  v_capacity := public.calculate_stall_capacity(
    v_qr.stall_id,
    case when v_scope = 'ORDER' then coalesce(p_items, '[]'::jsonb) else '[]'::jsonb end
  );

  if v_scope = 'SESSION' then
    if v_ordering_mode = 'DELIVERY' then
      v_resumable_order := public.lookup_resumable_public_delivery_order(
        p_qr_token, p_device_hash, p_ip_hash, p_qr_token_hash,
        p_behavior_hash, p_request_id, v_ordering_mode
      );
    else
      v_resumable_order := public.lookup_resumable_public_order(
        p_qr_token, p_device_hash, p_ip_hash, p_qr_token_hash,
        p_behavior_hash, p_request_id, v_ordering_mode
      );
    end if;

    if v_resumable_order is not null then
      return jsonb_build_object(
        'ok', true,
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', v_qr_context,
        'schedule_context', v_schedule_context,
        'capacity', v_capacity,
        'resumable_order', v_resumable_order,
        'idempotent_order', null
      );
    end if;

    if p_intake_code is not null then
      return jsonb_build_object(
        'ok', false,
        'code', p_intake_code,
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', v_qr_context,
        'schedule_context', v_schedule_context,
        'capacity', v_capacity,
        'resumable_order', null,
        'idempotent_order', null
      );
    end if;

    if v_schedule_code is not null then
      v_code := v_schedule_code;
    elsif v_ordering_mode = 'DELIVERY'
      and (v_qr.dining_table_id is not null or not coalesce(v_settings.delivery_module_enabled, false)) then
      v_code := 'DELIVERY_UNAVAILABLE';
    elsif v_ordering_mode = 'DEFAULT'
      and v_qr.dining_table_id is not null
      and (v_table.id is null or not v_table.is_active or not coalesce(v_settings.dine_in_enabled, false)) then
      v_code := 'TABLE_UNAVAILABLE';
    end if;

    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
        p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
      );
      return jsonb_build_object(
        'ok', false,
        'code', v_code,
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', v_qr_context,
        'schedule_context', v_schedule_context,
        'capacity', v_capacity,
        'resumable_order', null,
        'idempotent_order', null
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', v_qr_context,
      'schedule_context', v_schedule_context,
      'capacity', v_capacity,
      'resumable_order', null,
      'idempotent_order', null
    );
  end if;

  select jsonb_build_object(
    'order_id', order_record.id,
    'order_no', order_record.order_no,
    'order_status', order_record.status,
    'payment_status', order_record.payment_status,
    'total_amount', order_record.total,
    'fulfillment_type', order_record.fulfillment_type,
    'pickup_required', order_record.fulfillment_type = 'TAKEOUT'::public.fulfillment_type,
    'quoted_wait_minutes', order_record.quoted_wait_minutes,
    'quoted_ready_at', order_record.quoted_ready_at,
    'scheduled_pickup_at', order_record.scheduled_pickup_at,
    'requested_fulfillment_at', order_record.requested_fulfillment_at,
    'lottery_draw_id', order_record.lottery_draw_id,
    'discount_amount', order_record.discount_amount,
    'pickup_code_length', order_record.pickup_code_length,
    'created_at', order_record.created_at
  )
  into v_idempotent_order
  from public.orders order_record
  where order_record.id = v_session.order_id
    and order_record.idempotency_key = p_idempotency_key;

  if v_idempotent_order is not null then
    if (v_idempotent_order->>'requested_fulfillment_at')::timestamptz
         is distinct from p_requested_fulfillment_at
      or (v_idempotent_order->>'lottery_draw_id')::uuid is distinct from p_lottery_draw_id then
      v_code := 'IDEMPOTENCY_CONFLICT';
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false,
        'code', v_code,
        'scope', v_scope,
        'ordering_mode', v_ordering_mode,
        'qr_context', v_qr_context,
        'schedule_context', v_schedule_context,
        'capacity', v_capacity,
        'resumable_order', null,
        'idempotent_order', null
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', v_qr_context,
      'schedule_context', v_schedule_context,
      'capacity', v_capacity,
      'resumable_order', null,
      'idempotent_order', v_idempotent_order
    );
  end if;

  if p_intake_code is not null then
    return jsonb_build_object(
      'ok', false,
      'code', p_intake_code,
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', v_qr_context,
      'schedule_context', v_schedule_context,
      'capacity', v_capacity,
      'resumable_order', null,
      'idempotent_order', null
    );
  end if;

  if v_qr.location_id is distinct from v_session.location_id
    or v_qr.market_event_id is distinct from v_session.market_event_id
    or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
    or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
    v_code := 'SCHEDULE_CONTEXT_MISMATCH';
  elsif v_schedule_code is not null then
    v_code := v_schedule_code;
  elsif v_ordering_mode = 'DELIVERY'
    and (v_qr.dining_table_id is not null or not coalesce(v_settings.delivery_module_enabled, false)) then
    v_code := 'DELIVERY_UNAVAILABLE';
  elsif v_ordering_mode = 'DEFAULT'
    and v_qr.dining_table_id is not null
    and (v_table.id is null or not v_table.is_active or not coalesce(v_settings.dine_in_enabled, false)) then
    v_code := 'TABLE_UNAVAILABLE';
  elsif p_requested_fulfillment_at is not null
    and (v_qr.dining_table_id is not null
      or v_session.fulfillment_type_context = 'DINE_IN'::public.fulfillment_type) then
    v_code := 'ORDER_MODE_CONFLICT';
  elsif p_requested_fulfillment_at is not null then
    v_code := public.validate_requested_fulfillment_slot(
      v_session.stall_id,
      case when v_ordering_mode = 'DELIVERY'
        then 'DELIVERY'::public.fulfillment_type
        else 'TAKEOUT'::public.fulfillment_type
      end,
      'PUBLIC_NEW_ORDER',
      p_requested_fulfillment_at,
      v_session.created_at
    );
  elsif v_ordering_mode = 'PREORDER' then
    v_code := 'PREORDER_TIME_REQUIRED';
  end if;

  if v_code is null and coalesce((v_capacity->>'product_limit_exceeded')::boolean, false) then
    v_code := 'PRODUCT_CAPACITY_EXCEEDED';
  elsif v_code is null
    and coalesce(v_capacity->>'pause_source', 'NONE') = 'AUTO'
    and not coalesce((v_capacity->>'accepting_public_orders')::boolean, false) then
    v_code := 'CAPACITY_PAUSED';
  elsif v_code is null
    and coalesce((v_capacity->>'requires_acknowledgment')::boolean, false)
    and not coalesce(p_wait_acknowledged, false) then
    v_code := 'WAIT_ACKNOWLEDGMENT_REQUIRED';
  end if;

  if v_code is not null then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
      v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
      v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
      p_session_token_hash, p_behavior_hash, p_idempotency_hash
    );
    return jsonb_build_object(
      'ok', false,
      'code', v_code,
      'scope', v_scope,
      'ordering_mode', v_ordering_mode,
      'qr_context', v_qr_context,
      'schedule_context', v_schedule_context,
      'capacity', v_capacity,
      'resumable_order', null,
      'idempotent_order', null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'scope', v_scope,
    'ordering_mode', v_ordering_mode,
    'qr_context', v_qr_context,
    'schedule_context', v_schedule_context,
    'capacity', v_capacity,
    'resumable_order', null,
    'idempotent_order', null
  );
end;
$$;

revoke all on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) from public, anon, authenticated;
grant execute on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) to service_role;

comment on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) is
  'Canonical trusted preflight for public session and order paths; deployment and rate-limit gates remain outside this RPC.';
