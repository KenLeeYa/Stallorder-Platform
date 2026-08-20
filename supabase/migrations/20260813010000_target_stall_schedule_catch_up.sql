-- Keep public QR session/order requests scoped to one stall while preserving a
-- deterministic global catch-up entry point for cron and maintenance work.

create function app_private.process_stall_schedules_for_stall(
  p_stall_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened integer := 0;
  v_closed integer := 0;
  v_missed integer := 0;
begin
  -- Capacity refreshes and public session/order entry points use this same
  -- first lock. Schedule rows and active sessions are always locked later.
  perform 1
  from public.stalls stall
  where stall.id = p_stall_id
  for update;
  if not found then
    return jsonb_build_object(
      'opened', 0,
      'closed', 0,
      'missed', 0,
      'processedAt', p_now
    );
  end if;

  with candidates as materialized (
    select schedule.id
    from public.stall_schedules schedule
    where schedule.stall_id = p_stall_id
      and schedule.status = 'SCHEDULED'::public.stall_schedule_status
      and schedule.auto_open_enabled
      and coalesce(schedule.ordering_opens_at, schedule.starts_at) <= p_now
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) > p_now
    order by coalesce(schedule.ordering_opens_at, schedule.starts_at), schedule.id
    for update skip locked
  ), transitioned as (
    update public.stall_schedules schedule
    set status = 'OPEN'::public.stall_schedule_status,
        updated_at = p_now
    from candidates candidate
    where schedule.id = candidate.id
      and schedule.status = 'SCHEDULED'::public.stall_schedule_status
    returning schedule.id, schedule.organization_id, schedule.stall_id
  )
  insert into public.audit_logs (
    id, organization_id, stall_id, actor_profile_id, action, entity_type,
    entity_id, outcome, request_id, metadata
  )
  select gen_random_uuid(), transitioned.organization_id, transitioned.stall_id,
    null, 'STALL_SCHEDULE_AUTOMATIC_OPENED', 'STALL_SCHEDULE', transitioned.id,
    'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
    jsonb_build_object('processedAt', p_now)::text
  from transitioned;
  get diagnostics v_opened = row_count;

  if v_opened > 0 then
    update public.stalls stall
    set business_status = 'OPEN'::public.stall_business_status,
        ordering_enabled = true,
        ordering_state = 'OPEN'::public.stall_ordering_state,
        updated_at = p_now
    where stall.id = p_stall_id
      and stall.is_active
      and not stall.is_sold_out
      and not exists (
        select 1
        from public.stall_capacity_settings settings
        where settings.stall_id = stall.id
          and settings.pause_source = 'MANUAL'
      );
  end if;

  with candidates as materialized (
    select schedule.id
    from public.stall_schedules schedule
    where schedule.stall_id = p_stall_id
      and schedule.status = 'OPEN'::public.stall_schedule_status
      and schedule.auto_close_enabled
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) <= p_now
    order by coalesce(schedule.ordering_closes_at, schedule.ends_at), schedule.id
    for update skip locked
  ), transitioned as (
    update public.stall_schedules schedule
    set status = 'COMPLETED'::public.stall_schedule_status,
        updated_at = p_now
    from candidates candidate
    where schedule.id = candidate.id
      and schedule.status = 'OPEN'::public.stall_schedule_status
    returning schedule.id, schedule.organization_id, schedule.stall_id
  )
  insert into public.audit_logs (
    id, organization_id, stall_id, actor_profile_id, action, entity_type,
    entity_id, outcome, request_id, metadata
  )
  select gen_random_uuid(), transitioned.organization_id, transitioned.stall_id,
    null, 'STALL_SCHEDULE_AUTOMATIC_CLOSED', 'STALL_SCHEDULE', transitioned.id,
    'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
    jsonb_build_object('processedAt', p_now)::text
  from transitioned;
  get diagnostics v_closed = row_count;

  if v_closed > 0 and not exists (
    select 1
    from public.stall_schedules schedule
    where schedule.stall_id = p_stall_id
      and schedule.status = 'OPEN'::public.stall_schedule_status
      and coalesce(schedule.ordering_opens_at, schedule.starts_at) <= p_now
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) > p_now
  ) then
    update public.stalls stall
    set ordering_state = 'CLOSED'::public.stall_ordering_state,
        updated_at = p_now
    where stall.id = p_stall_id;

    update public.order_sessions session_record
    set status = 'REVOKED'::public.order_session_status,
        revoked_at = coalesce(session_record.revoked_at, p_now)
    where session_record.stall_id = p_stall_id
      and session_record.status = 'ACTIVE'::public.order_session_status;
  end if;

  with candidates as materialized (
    select schedule.id
    from public.stall_schedules schedule
    where schedule.stall_id = p_stall_id
      and schedule.status = 'SCHEDULED'::public.stall_schedule_status
      and schedule.auto_close_enabled
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) <= p_now
    order by coalesce(schedule.ordering_closes_at, schedule.ends_at), schedule.id
    for update skip locked
  ), transitioned as (
    update public.stall_schedules schedule
    set status = 'COMPLETED'::public.stall_schedule_status,
        updated_at = p_now
    from candidates candidate
    where schedule.id = candidate.id
      and schedule.status = 'SCHEDULED'::public.stall_schedule_status
    returning schedule.id, schedule.organization_id, schedule.stall_id
  )
  insert into public.audit_logs (
    id, organization_id, stall_id, actor_profile_id, action, entity_type,
    entity_id, outcome, request_id, metadata
  )
  select gen_random_uuid(), transitioned.organization_id, transitioned.stall_id,
    null, 'STALL_SCHEDULE_AUTOMATIC_MISSED', 'STALL_SCHEDULE', transitioned.id,
    'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
    jsonb_build_object('processedAt', p_now)::text
  from transitioned;
  get diagnostics v_missed = row_count;

  update public.operational_alerts alert
  set status = 'RESOLVED', resolved_at = p_now, updated_at = p_now
  where alert.stall_id = p_stall_id
    and alert.alert_type = 'SCHEDULE_START_DELAYED'
    and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    and not exists (
      select 1
      from public.stall_schedules schedule
      where schedule.stall_id = p_stall_id
        and schedule.status = 'DELAYED'::public.stall_schedule_status
    );

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select schedule.organization_id, schedule.stall_id,
    'SCHEDULE_START_DELAYED', 'WARNING',
    '出攤行程已標記延遲，請確認實際開攤與接單狀態。'
  from public.stall_schedules schedule
  where schedule.stall_id = p_stall_id
    and schedule.status = 'DELAYED'::public.stall_schedule_status
    and not exists (
      select 1
      from public.operational_alerts alert
      where alert.stall_id = p_stall_id
        and alert.alert_type = 'SCHEDULE_START_DELAYED'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    )
  on conflict do nothing;

  return jsonb_build_object(
    'opened', v_opened,
    'closed', v_closed,
    'missed', v_missed,
    'processedAt', p_now
  );
end;
$$;

revoke all on function app_private.process_stall_schedules_for_stall(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function app_private.process_stall_schedules_for_stall(uuid, timestamptz)
to service_role;

comment on function app_private.process_stall_schedules_for_stall(uuid, timestamptz) is
  'Processes schedule transitions and delayed alerts for one locked stall.';

create function app_private.issue_order_session_with_schedule_targeted(
  p_qr_token text,
  p_session_token_hash text,
  p_ip_hash text,
  p_device_hash text,
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
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_session_id uuid;
  v_target_stall_id uuid;
  v_qr_found boolean := false;
begin
  select stall.id into v_target_stall_id
  from public.qr_codes qr
  join public.stalls stall on stall.id = qr.stall_id
  where qr.token = p_qr_token
  for update of stall;

  if found then
    perform app_private.process_stall_schedules_for_stall(
      v_target_stall_id,
      now()
    );
  end if;

  select * into v_qr from public.qr_codes where token = p_qr_token for share;
  v_qr_found := found;
  if found then
    v_code := public.validate_ordering_schedule_context(v_qr.id, p_ordering_mode);
    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
        p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;

  if p_ordering_mode = 'PREORDER' then
    v_result := public.issue_preorder_order_session(
      p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
      p_qr_token_hash, p_behavior_hash, p_request_id
    );
  else
    v_result := public.issue_order_session_with_capacity(
      p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
      p_qr_token_hash, p_behavior_hash, p_request_id
    );
  end if;

  if coalesce((v_result->>'ok')::boolean, false) and v_qr_found then
    v_session_id := (v_result->>'order_session_id')::uuid;
    update public.order_sessions
    set location_id = v_qr.location_id,
        market_event_id = v_qr.market_event_id,
        stall_schedule_id = v_qr.stall_schedule_id,
        fulfillment_type_context = v_qr.fulfillment_type_context,
        ordering_mode = p_ordering_mode
    where id = v_session_id
      and qr_code_id = v_qr.id
      and status = 'ACTIVE'::public.order_session_status;
  end if;
  return v_result;
end;
$$;

revoke all on function app_private.issue_order_session_with_schedule_targeted(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

create function public.issue_idempotent_order_session_with_schedule_targeted(
  p_qr_token text,
  p_session_token_hash text,
  p_ip_hash text,
  p_device_hash text,
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
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_capacity jsonb;
  v_result jsonb;
  v_code text;
  v_target_stall_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_token_hash, 0)
  );

  select stall.id into v_target_stall_id
  from public.order_sessions session_record
  join public.stalls stall on stall.id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash
  for update of stall;

  select *
  into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash
  for update;

  if found then
    select * into v_qr
    from public.qr_codes
    where id = v_session.qr_code_id;

    if not found
       or v_qr.token <> p_qr_token
       or v_session.device_hash <> p_device_hash then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'ERROR', 'SESSION_TOKEN_COLLISION',
        v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', 'SESSION_TOKEN_COLLISION');
    end if;

    if v_session.status = 'CONSUMED'::public.order_session_status then
      v_code := 'SESSION_REPLAYED';
    elsif v_session.status <> 'ACTIVE'::public.order_session_status then
      v_code := 'SESSION_NOT_FOUND';
    elsif v_session.expires_at <= now() then
      v_code := 'SESSION_EXPIRED';
    elsif v_session.ordering_mode <> p_ordering_mode then
      v_code := 'ORDER_MODE_CONFLICT';
    else
      perform app_private.process_stall_schedules_for_stall(
        v_target_stall_id,
        now()
      );
      if v_qr.location_id is distinct from v_session.location_id
         or v_qr.market_event_id is distinct from v_session.market_event_id
         or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
         or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
        v_code := 'SCHEDULE_CONTEXT_MISMATCH';
      else
        v_code := public.validate_ordering_schedule_context(v_qr.id, p_ordering_mode);
      end if;
    end if;

    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;

    v_capacity := public.calculate_stall_capacity(v_session.stall_id, '[]'::jsonb);
    perform public.record_public_order_attempt(
      p_request_id, 'SESSION_ISSUE', 'ALLOWED', 'SESSION_IDEMPOTENT_REPLAY',
      v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
      v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
      p_session_token_hash, p_behavior_hash, null
    );
    return jsonb_build_object(
      'ok', true,
      'organization_id', v_session.organization_id,
      'stall_id', v_session.stall_id,
      'qr_code_id', v_session.qr_code_id,
      'order_session_id', v_session.id,
      'expires_at', v_session.expires_at,
      'capacity', v_capacity,
      'idempotent_replay', true
    );
  end if;

  v_result := app_private.issue_order_session_with_schedule_targeted(
    p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
    p_qr_token_hash, p_behavior_hash, p_request_id, p_ordering_mode
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    update public.order_sessions
    set ordering_mode = p_ordering_mode
    where id = (v_result->>'order_session_id')::uuid
      and token_hash = p_session_token_hash
      and status = 'ACTIVE'::public.order_session_status;
    v_result := v_result || jsonb_build_object('idempotent_replay', false);
  end if;

  return v_result;
end;
$$;

revoke all on function public.issue_idempotent_order_session_with_schedule_targeted(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.issue_idempotent_order_session_with_schedule_targeted(
  text, text, text, text, text, text, text, text
) to service_role;

comment on function public.issue_idempotent_order_session_with_schedule_targeted(
  text, text, text, text, text, text, text, text
) is
  'Issues or replays one order session after locking and refreshing only its target stall.';

create function app_private.create_public_order_with_schedule_targeted(
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
  p_request_id text,
  p_wait_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_created_order_id uuid;
begin
  select * into v_session from public.order_sessions
  where token_hash = p_session_token_hash
  for update;
  if found and v_session.status = 'ACTIVE'::public.order_session_status then
    perform app_private.process_stall_schedules_for_stall(
      v_session.stall_id,
      now()
    );
    select * into v_qr from public.qr_codes where id = v_session.qr_code_id for share;
    if not found
       or v_qr.location_id is distinct from v_session.location_id
       or v_qr.market_event_id is distinct from v_session.market_event_id
       or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
       or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
      v_code := 'SCHEDULE_CONTEXT_MISMATCH';
    else
      v_code := public.validate_ordering_schedule_context(v_qr.id, 'DEFAULT');
    end if;
    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;

  v_result := public.create_public_order_with_capacity(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id, p_wait_acknowledged
  );
  if coalesce((v_result->>'ok')::boolean, false) and (v_result ? 'order') then
    v_created_order_id := (v_result #>> '{order,order_id}')::uuid;
    update public.orders
    set location_id = v_session.location_id,
        market_event_id = v_session.market_event_id,
        stall_schedule_id = v_session.stall_schedule_id,
        updated_at = now()
    where id = v_created_order_id
      and stall_id = v_session.stall_id
      and (location_id is null and market_event_id is null and stall_schedule_id is null);
  end if;
  return v_result;
end;
$$;

revoke all on function app_private.create_public_order_with_schedule_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, jsonb,
  text, text, text, boolean
) from public, anon, authenticated, service_role;

create function app_private.create_public_delivery_order_with_schedule_targeted(
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
  p_wait_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_created_order_id uuid;
begin
  select * into v_session from public.order_sessions
  where token_hash = p_session_token_hash
  for update;
  if found and v_session.status = 'ACTIVE'::public.order_session_status then
    perform app_private.process_stall_schedules_for_stall(
      v_session.stall_id,
      now()
    );
    select * into v_qr from public.qr_codes where id = v_session.qr_code_id for share;
    if not found
       or v_qr.location_id is distinct from v_session.location_id
       or v_qr.market_event_id is distinct from v_session.market_event_id
       or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
       or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
      v_code := 'SCHEDULE_CONTEXT_MISMATCH';
    else
      v_code := public.validate_ordering_schedule_context(v_qr.id, 'DELIVERY');
    end if;
    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;

  v_result := public.create_public_delivery_order_with_capacity(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
    p_items, p_tracking_token_hash, p_pickup_code_hash, p_request_id,
    p_wait_acknowledged
  );
  if coalesce((v_result->>'ok')::boolean, false) and (v_result ? 'order') then
    v_created_order_id := (v_result #>> '{order,order_id}')::uuid;
    update public.orders
    set location_id = v_session.location_id,
        market_event_id = v_session.market_event_id,
        stall_schedule_id = v_session.stall_schedule_id,
        updated_at = now()
    where id = v_created_order_id
      and stall_id = v_session.stall_id
      and (location_id is null and market_event_id is null and stall_schedule_id is null);
  end if;
  return v_result;
end;
$$;

revoke all on function app_private.create_public_delivery_order_with_schedule_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean
) from public, anon, authenticated, service_role;

create function app_private.create_public_preorder_with_schedule_targeted(
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
  p_request_id text,
  p_wait_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_created_order_id uuid;
begin
  perform coalesce(p_wait_acknowledged, false);

  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if found and v_session.status = 'ACTIVE'::public.order_session_status then
    perform app_private.process_stall_schedules_for_stall(
      v_session.stall_id,
      now()
    );
    select * into v_qr
    from public.qr_codes qr
    where qr.id = v_session.qr_code_id
    for share;
    if not found
       or v_session.ordering_mode <> 'PREORDER'
       or v_qr.location_id is distinct from v_session.location_id
       or v_qr.market_event_id is distinct from v_session.market_event_id
       or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
       or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
      v_code := 'SCHEDULE_CONTEXT_MISMATCH';
    else
      v_code := public.validate_ordering_schedule_context(v_qr.id, 'PREORDER');
    end if;
    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;

  v_result := public.create_public_order(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );
  if coalesce((v_result->>'ok')::boolean, false) and (v_result ? 'order') then
    v_created_order_id := (v_result #>> '{order,order_id}')::uuid;
    update public.orders
    set location_id = v_session.location_id,
        market_event_id = v_session.market_event_id,
        stall_schedule_id = v_session.stall_schedule_id,
        updated_at = now()
    where id = v_created_order_id
      and stall_id = v_session.stall_id
      and location_id is null
      and market_event_id is null
      and stall_schedule_id is null;
  end if;
  return v_result;
end;
$$;

revoke all on function app_private.create_public_preorder_with_schedule_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, jsonb,
  text, text, text, boolean
) from public, anon, authenticated, service_role;

create function app_private.create_public_order_with_experience_targeted(
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
  p_request_id text,
  p_wait_acknowledged boolean,
  p_scheduled_pickup_at timestamptz,
  p_lottery_draw_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_existing_order public.orders%rowtype;
  v_draw public.public_lottery_draws%rowtype;
  v_result jsonb;
  v_code text;
  v_order_id uuid;
  v_subtotal integer;
  v_total integer;
  v_discount_amount integer := 0;
  v_idempotent_replay boolean;
  v_existing_order_found boolean := false;
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;
  if v_session.device_hash <> p_device_hash then
    return jsonb_build_object('ok', false, 'code', 'SESSION_DEVICE_MISMATCH');
  end if;
  if v_session.ordering_mode = 'PREORDER' and p_lottery_draw_id is not null then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_UNAVAILABLE');
  end if;

  select * into v_existing_order
  from public.orders order_record
  where order_record.id = v_session.order_id
    and order_record.idempotency_key = p_idempotency_key;
  v_existing_order_found := found;

  select * into v_qr from public.qr_codes where id = v_session.qr_code_id;
  if v_session.ordering_mode = 'PREORDER' then
    if v_qr.dining_table_id is not null
       or v_session.fulfillment_type_context in (
         'DINE_IN'::public.fulfillment_type,
         'DELIVERY'::public.fulfillment_type
       ) then
      return jsonb_build_object('ok', false, 'code', 'PREORDER_CONTEXT_UNAVAILABLE');
    end if;
    if not v_existing_order_found then
      v_code := public.validate_takeout_preorder_slot(
        v_session.stall_id,
        p_scheduled_pickup_at,
        v_session.created_at
      );
      if v_code is not null then
        return jsonb_build_object('ok', false, 'code', v_code);
      end if;
      update public.order_sessions
      set requested_fulfillment_at = p_scheduled_pickup_at
      where id = v_session.id
        and status = 'ACTIVE'::public.order_session_status;
      v_session.requested_fulfillment_at := p_scheduled_pickup_at;
    end if;
  elsif p_scheduled_pickup_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_MODE_CONFLICT');
  end if;

  if v_existing_order_found and (
    v_existing_order.scheduled_pickup_at is distinct from p_scheduled_pickup_at
    or v_existing_order.lottery_draw_id is distinct from p_lottery_draw_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  if p_lottery_draw_id is not null then
    select * into v_draw
    from public.public_lottery_draws draw
    where draw.id = p_lottery_draw_id
    for update;
    if not found
       or v_draw.organization_id <> v_session.organization_id
       or v_draw.stall_id <> v_session.stall_id
       or v_draw.device_hash <> p_device_hash then
      return jsonb_build_object('ok', false, 'code', 'LOTTERY_DRAW_INVALID');
    end if;
    if v_session.ordering_mode <> 'DEFAULT'
       or v_qr.dining_table_id is not null
       or v_qr.market_event_id is not null
       or v_qr.stall_schedule_id is not null
       or v_qr.fulfillment_type_context in (
         'DINE_IN'::public.fulfillment_type,
         'DELIVERY'::public.fulfillment_type
       ) then
      return jsonb_build_object('ok', false, 'code', 'LOTTERY_DRAW_INVALID');
    end if;
    if not v_existing_order_found and v_draw.expires_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'LOTTERY_DRAW_EXPIRED');
    end if;
    if v_draw.redeemed_order_id is not null
       and v_draw.redeemed_order_id is distinct from v_existing_order.id then
      return jsonb_build_object('ok', false, 'code', 'LOTTERY_ALREADY_REDEEMED');
    end if;
  end if;

  if v_session.ordering_mode = 'PREORDER' then
    v_result := app_private.create_public_preorder_with_schedule_targeted(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id, p_wait_acknowledged
    );
  else
    v_result := app_private.create_public_order_with_schedule_targeted(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id, p_wait_acknowledged
    );
  end if;
  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);
  if not v_idempotent_replay then
    update public.orders
    set scheduled_pickup_at = p_scheduled_pickup_at,
        confirmation_expires_at = case
          when v_session.ordering_mode = 'PREORDER'
            then p_scheduled_pickup_at
          else confirmation_expires_at
        end,
        updated_at = now()
    where id = v_order_id
      and organization_id = v_session.organization_id
      and stall_id = v_session.stall_id;

    if p_lottery_draw_id is not null then
      update public.public_lottery_draws
      set redeemed_order_id = v_order_id
      where id = p_lottery_draw_id
        and redeemed_order_id is null;
      if not found then
        raise exception 'LOTTERY_ALREADY_REDEEMED';
      end if;

      if v_draw.discount_label is not null and v_draw.discount_rate_bps is not null then
        update public.orders
        set lottery_draw_id = p_lottery_draw_id,
            discount_source = 'LOTTERY',
            discount_option_id = v_draw.discount_option_id,
            discount_label = v_draw.discount_label,
            discount_rate_bps = v_draw.discount_rate_bps,
            discount_amount = subtotal
              - round((subtotal::numeric * v_draw.discount_rate_bps) / 10000)::integer,
            total = round((subtotal::numeric * v_draw.discount_rate_bps) / 10000)::integer,
            updated_at = now()
        where id = v_order_id;
      else
        update public.orders
        set lottery_draw_id = p_lottery_draw_id,
            updated_at = now()
        where id = v_order_id;
      end if;
    end if;
  end if;

  select subtotal, total, discount_amount
  into v_subtotal, v_total, v_discount_amount
  from public.orders
  where id = v_order_id;
  if not v_idempotent_replay then
    update public.audit_logs
    set metadata = (
      coalesce(nullif(metadata, '')::jsonb, '{}'::jsonb)
      || jsonb_build_object(
        'subtotal', v_subtotal,
        'discountAmount', v_discount_amount,
        'total', v_total
      )
    )::text
    where entity_type = 'ORDER'
      and entity_id = v_order_id
      and action = 'PUBLIC_ORDER_CREATED';
  end if;
  v_result := jsonb_set(v_result, '{order,total_amount}', to_jsonb(v_total), true);
  v_result := jsonb_set(
    v_result,
    '{order,discount_amount}',
    to_jsonb(v_discount_amount),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{order,scheduled_pickup_at}',
    coalesce(to_jsonb(p_scheduled_pickup_at), 'null'::jsonb),
    true
  );
  return v_result;
end;
$$;

revoke all on function app_private.create_public_order_with_experience_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, jsonb,
  text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated, service_role;

create function public.create_public_order_with_fulfillment_time_targeted(
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
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_order public.orders%rowtype;
  v_created_order_id uuid;
  v_old_scheduled_pickup_at timestamptz;
  v_existing_order_found boolean := false;
begin
  perform stall.id
  from public.order_sessions session_record
  join public.stalls stall on stall.id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash
  for update of stall;

  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  select * into v_order
  from public.orders order_record
  where order_record.id = v_session.order_id
    and order_record.idempotency_key = p_idempotency_key;
  v_existing_order_found := found;

  if v_existing_order_found
     and v_order.requested_fulfillment_at is distinct from p_requested_fulfillment_at then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  if not v_existing_order_found then
    select * into v_qr from public.qr_codes where id = v_session.qr_code_id;
    if p_requested_fulfillment_at is not null then
      if v_qr.dining_table_id is not null
         or v_session.fulfillment_type_context = 'DINE_IN'::public.fulfillment_type then
        return jsonb_build_object('ok', false, 'code', 'ORDER_MODE_CONFLICT');
      end if;
      v_code := public.validate_requested_fulfillment_slot(
        v_session.stall_id,
        case when v_session.ordering_mode = 'DELIVERY'
          then 'DELIVERY'::public.fulfillment_type
          else 'TAKEOUT'::public.fulfillment_type
        end,
        'PUBLIC_NEW_ORDER',
        p_requested_fulfillment_at,
        v_session.created_at
      );
      if v_code is not null then
        return jsonb_build_object('ok', false, 'code', v_code);
      end if;
    elsif v_session.ordering_mode = 'PREORDER' then
      return jsonb_build_object('ok', false, 'code', 'PREORDER_TIME_REQUIRED');
    end if;
  end if;

  v_old_scheduled_pickup_at := case
    when v_session.ordering_mode = 'PREORDER' then p_requested_fulfillment_at
    else null
  end;

  if v_session.ordering_mode = 'DELIVERY' then
    v_result := app_private.create_public_delivery_order_with_schedule_targeted(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
      p_items, p_tracking_token_hash, p_pickup_code_hash, p_request_id,
      p_wait_acknowledged
    );
  else
    v_result := app_private.create_public_order_with_experience_targeted(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id, p_wait_acknowledged,
      v_old_scheduled_pickup_at, p_lottery_draw_id
    );
  end if;

  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_created_order_id := (v_result #>> '{order,order_id}')::uuid;
  select * into v_order from public.orders where id = v_created_order_id for update;
  if v_order.fulfillment_time_version > 0
     and v_order.requested_fulfillment_at is distinct from p_requested_fulfillment_at then
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  if v_order.fulfillment_time_version = 0 and p_requested_fulfillment_at is not null then
    update public.orders
    set requested_fulfillment_at = p_requested_fulfillment_at,
        fulfillment_time_state = 'REQUESTED',
        fulfillment_time_version = 1,
        updated_at = now()
    where id = v_created_order_id;
    update public.order_sessions
    set requested_fulfillment_at = p_requested_fulfillment_at
    where id = v_session.id;
  end if;

  v_result := jsonb_set(
    v_result,
    '{order,requested_fulfillment_at}',
    coalesce(to_jsonb(p_requested_fulfillment_at), 'null'::jsonb),
    true
  );
  v_result := jsonb_set(
    v_result,
    '{order,fulfillment_time_state}',
    to_jsonb((case when p_requested_fulfillment_at is null then 'NOT_REQUESTED' else 'REQUESTED' end)::text),
    true
  );
  return v_result;
end;
$$;

revoke all on function public.create_public_order_with_fulfillment_time_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_fulfillment_time_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) to service_role;

comment on function public.create_public_order_with_fulfillment_time_targeted(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) is
  'Creates one order through a target-stall-only schedule refresh chain.';
