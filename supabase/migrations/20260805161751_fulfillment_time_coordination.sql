-- Customer-requested pickup/delivery times and versioned merchant proposals.
-- scheduled_pickup_at keeps its existing preorder/provider-pickup meaning.

set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.orders
  add column if not exists requested_fulfillment_at timestamptz,
  add column if not exists committed_fulfillment_at timestamptz,
  add column if not exists pending_fulfillment_at timestamptz,
  add column if not exists fulfillment_time_state text not null default 'NOT_REQUESTED',
  add column if not exists fulfillment_time_version integer not null default 0,
  add column if not exists fulfillment_time_response_expires_at timestamptz,
  add column if not exists customer_time_responded_at timestamptz,
  add column if not exists fulfillment_time_change_reason text,
  add column if not exists fulfillment_time_proposed_by uuid references public.profiles(id) on delete set null;

alter table public.orders
  drop constraint if exists orders_fulfillment_time_state_check,
  add constraint orders_fulfillment_time_state_check check (
    fulfillment_time_state in (
      'NOT_REQUESTED', 'REQUESTED', 'CONFIRMED',
      'CUSTOMER_ACTION_REQUIRED', 'DECLINED', 'EXPIRED'
    )
  ) not valid,
  drop constraint if exists orders_fulfillment_time_version_check,
  add constraint orders_fulfillment_time_version_check check (
    fulfillment_time_version between 0 and 10000
  ) not valid,
  drop constraint if exists orders_fulfillment_time_change_reason_check,
  add constraint orders_fulfillment_time_change_reason_check check (
    fulfillment_time_change_reason is null
    or char_length(fulfillment_time_change_reason) between 2 and 200
  ) not valid,
  drop constraint if exists orders_fulfillment_time_consistency_check,
  add constraint orders_fulfillment_time_consistency_check check (
    (fulfillment_time_state = 'NOT_REQUESTED'
      and requested_fulfillment_at is null
      and pending_fulfillment_at is null
      and fulfillment_time_version = 0)
    or
    (fulfillment_time_state = 'REQUESTED'
      and requested_fulfillment_at is not null
      and pending_fulfillment_at is null
      and fulfillment_time_version >= 1)
    or
    (fulfillment_time_state = 'CONFIRMED'
      and committed_fulfillment_at is not null
      and pending_fulfillment_at is null
      and fulfillment_time_response_expires_at is null
      and fulfillment_time_version >= 1)
    or
    (fulfillment_time_state = 'CUSTOMER_ACTION_REQUIRED'
      and pending_fulfillment_at is not null
      and fulfillment_time_response_expires_at is not null
      and fulfillment_time_version >= 1)
    or
    (fulfillment_time_state in ('DECLINED', 'EXPIRED')
      and pending_fulfillment_at is null
      and fulfillment_time_response_expires_at is null
      and fulfillment_time_version >= 1)
  ) not valid;

-- Existing orders keep their established scheduled_pickup_at value. New
-- coordination state begins with orders created by this release, avoiding a
-- DR-side data rewrite before Primary replication includes the new columns.

create index if not exists orders_stall_fulfillment_time_state_idx
  on public.orders (stall_id, fulfillment_time_state, created_at desc)
  where fulfillment_time_state <> 'NOT_REQUESTED';
create index if not exists orders_fulfillment_time_response_expiry_idx
  on public.orders (fulfillment_time_response_expires_at)
  where fulfillment_time_state = 'CUSTOMER_ACTION_REQUIRED';

alter table public.order_events
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;
alter table public.order_events
  drop constraint if exists order_events_metadata_json_object_check,
  add constraint order_events_metadata_json_object_check
    check (jsonb_typeof(metadata_json) = 'object') not valid;

alter table public.notification_jobs
  add column if not exists event_version integer not null default 0;
alter table public.notification_jobs
  drop constraint if exists notification_jobs_event_version_check,
  add constraint notification_jobs_event_version_check
    check (event_version between 0 and 10000) not valid,
  drop constraint if exists notification_jobs_order_template_unique,
  add constraint notification_jobs_order_template_unique
    unique (order_id, provider, template_code, event_version),
  drop constraint if exists notification_jobs_template_check,
  add constraint notification_jobs_template_check check (
    template_code in (
      'ORDER_CONFIRMED', 'ORDER_READY', 'ORDER_CANCELLED',
      'FULFILLMENT_TIME_PROPOSED'
    )
  ) not valid;

create or replace function public.get_fulfillment_time_slots_raw(
  p_stall_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_ordering_settings%rowtype;
  v_stall public.stalls%rowtype;
  v_slots jsonb;
begin
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = p_stall_id;
  if not found then
    return '[]'::jsonb;
  end if;
  select * into v_stall
  from public.stalls stall
  where stall.id = p_stall_id;

  if not found then
    return '[]'::jsonb;
  end if;

  with local_days as (
    select ((p_now at time zone v_stall.timezone)::date + day_offset)::date as local_date
    from generate_series(-1, v_settings.preorder_max_days) day_offset
  ), business_windows as (
    select
      local_day.local_date + business_hour.opens_at::time as local_opens_at,
      local_day.local_date + business_hour.closes_at::time
        + case when business_hour.closes_at::time <= business_hour.opens_at::time
          then interval '1 day' else interval '0' end as local_closes_at
    from local_days local_day
    join public.stall_business_hours business_hour
      on business_hour.stall_id = p_stall_id
      and business_hour.organization_id = v_stall.organization_id
      and business_hour.day_of_week = extract(dow from local_day.local_date)::integer
      and not business_hour.is_closed
  ), candidate_slots as (
    select (slot_local at time zone v_stall.timezone) as scheduled_at
    from business_windows business_window
    cross join lateral generate_series(
      business_window.local_opens_at + make_interval(
        mins => (
          5 - extract(minute from business_window.local_opens_at)::integer % 5
        ) % 5
      ),
      business_window.local_closes_at
        - make_interval(mins => v_settings.preorder_slot_minutes),
      make_interval(mins => v_settings.preorder_slot_minutes)
    ) slot_local
  ), valid_slots as (
    select distinct scheduled_at
    from candidate_slots
    where scheduled_at >= p_now + make_interval(mins => v_settings.preorder_min_lead_minutes)
      and scheduled_at <= p_now + make_interval(days => v_settings.preorder_max_days)
    order by scheduled_at
    limit 8640
  )
  select coalesce(jsonb_agg(scheduled_at order by scheduled_at), '[]'::jsonb)
  into v_slots
  from valid_slots;

  return coalesce(v_slots, '[]'::jsonb);
end;
$$;

revoke all on function public.get_fulfillment_time_slots_raw(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_fulfillment_time_slots_raw(uuid, timestamptz)
  to service_role;

create or replace function public.validate_requested_fulfillment_slot(
  p_stall_id uuid,
  p_fulfillment_type public.fulfillment_type,
  p_scope text,
  p_scheduled_fulfillment_at timestamptz,
  p_reference_time timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_ordering_settings%rowtype;
  v_slots jsonb;
begin
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = p_stall_id;

  if not found then
    return 'PREORDER_DISABLED';
  end if;
  if p_fulfillment_type not in (
    'TAKEOUT'::public.fulfillment_type,
    'DELIVERY'::public.fulfillment_type
  ) then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if p_scope = 'PUBLIC_NEW_ORDER' then
    if p_fulfillment_type = 'DELIVERY'::public.fulfillment_type
       and not coalesce(v_settings.delivery_module_enabled, false) then
      return 'DELIVERY_UNAVAILABLE';
    end if;
    if p_fulfillment_type = 'TAKEOUT'::public.fulfillment_type
       and not coalesce(v_settings.takeout_preorder_enabled, false) then
      return 'PREORDER_DISABLED';
    end if;
  elsif p_scope = 'STAFF_NEW_ORDER' then
    if p_fulfillment_type = 'DELIVERY'::public.fulfillment_type
       and not coalesce(v_settings.staff_delivery_enabled, false) then
      return 'DELIVERY_UNAVAILABLE';
    end if;
  elsif p_scope <> 'EXISTING_ORDER' then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if p_scheduled_fulfillment_at is null then
    return 'PREORDER_TIME_REQUIRED';
  end if;
  if p_scheduled_fulfillment_at <= now() then
    return 'PREORDER_TIME_INVALID';
  end if;
  if p_scope = 'PUBLIC_NEW_ORDER' then
    v_slots := public.get_takeout_preorder_slots(p_stall_id, p_reference_time);
  else
    v_slots := public.get_fulfillment_time_slots_raw(p_stall_id, p_reference_time);
  end if;
  if not exists (
    select 1
    from jsonb_array_elements_text(v_slots) slot(value)
    where slot.value::timestamptz = p_scheduled_fulfillment_at
  ) then
    return 'PREORDER_TIME_INVALID';
  end if;
  return null;
end;
$$;

revoke all on function public.validate_requested_fulfillment_slot(
  uuid, public.fulfillment_type, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.validate_requested_fulfillment_slot(
  uuid, public.fulfillment_type, text, timestamptz, timestamptz
) to service_role;

create or replace function public.create_public_order_with_fulfillment_time(
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
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;
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
    v_result := public.create_public_delivery_order_with_schedule(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
      p_items, p_tracking_token_hash, p_pickup_code_hash, p_request_id,
      p_wait_acknowledged
    );
  else
    v_result := public.create_public_order_with_experience(
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

revoke all on function public.create_public_order_with_fulfillment_time(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_fulfillment_time(
  uuid, text, text, text, text, text, text, uuid, text, text, text, text,
  text, jsonb, text, text, text, boolean, timestamptz, uuid
) to service_role;

create or replace function public.respond_to_fulfillment_time(
  p_tracking_token_hash text,
  p_device_hash text,
  p_version integer,
  p_response text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_accepted boolean;
begin
  if p_response not in ('ACCEPT', 'DECLINE') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  end if;
  select * into v_order
  from public.orders order_record
  where order_record.tracking_token_hash = p_tracking_token_hash
    and order_record.device_hash = p_device_hash
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status in (
    'COMPLETED'::public.order_status,
    'CANCELLED'::public.order_status,
    'EXPIRED'::public.order_status
  ) then
    return jsonb_build_object('ok', false, 'code', 'FULFILLMENT_TIME_UNAVAILABLE');
  end if;
  if v_order.fulfillment_time_version <> p_version
     or v_order.fulfillment_time_state <> 'CUSTOMER_ACTION_REQUIRED' then
    return jsonb_build_object('ok', false, 'code', 'FULFILLMENT_TIME_PROPOSAL_STALE');
  end if;
  if v_order.fulfillment_time_response_expires_at <= now() then
    update public.orders
    set pending_fulfillment_at = null,
        fulfillment_time_state = 'EXPIRED',
        fulfillment_time_response_expires_at = null,
        customer_time_responded_at = now(),
        updated_at = now()
    where id = v_order.id;
    return jsonb_build_object('ok', false, 'code', 'FULFILLMENT_TIME_PROPOSAL_EXPIRED');
  end if;

  v_accepted := p_response = 'ACCEPT';
  update public.orders
  set committed_fulfillment_at = case
        when v_accepted then pending_fulfillment_at
        else committed_fulfillment_at
      end,
      pending_fulfillment_at = null,
      fulfillment_time_state = case when v_accepted then 'CONFIRMED' else 'DECLINED' end,
      fulfillment_time_response_expires_at = null,
      customer_time_responded_at = now(),
      updated_at = now()
  where id = v_order.id;

  insert into public.order_events (
    id, tenant_id, organization_id, stall_id, order_id, event_type,
    metadata_json, created_at
  ) values (
    gen_random_uuid(),
    v_order.tenant_id,
    v_order.organization_id,
    v_order.stall_id,
    v_order.id,
    case when v_accepted then 'FULFILLMENT_TIME_ACCEPTED' else 'FULFILLMENT_TIME_DECLINED' end,
    jsonb_build_object(
      'version', p_version,
      'proposedAt', v_order.pending_fulfillment_at,
      'response', p_response
    ),
    now()
  );
  return jsonb_build_object(
    'ok', true,
    'state', case when v_accepted then 'CONFIRMED' else 'DECLINED' end,
    'version', p_version,
    'committedFulfillmentAt', case
      when v_accepted then v_order.pending_fulfillment_at
      else v_order.committed_fulfillment_at
    end
  );
end;
$$;

revoke all on function public.respond_to_fulfillment_time(text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.respond_to_fulfillment_time(text, text, integer, text)
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
    'stallTimezone', stall.timezone,
    'fulfillmentType', order_record.fulfillment_type,
    'tableLabel', order_record.table_label,
    'customerPhone', order_record.customer_phone,
    'deliveryAddress', order_record.delivery_address,
    'pickupCodeLength', order_record.pickup_code_length,
    'scheduledPickupAt', order_record.scheduled_pickup_at,
    'requestedFulfillmentAt', order_record.requested_fulfillment_at,
    'committedFulfillmentAt', order_record.committed_fulfillment_at,
    'pendingFulfillmentAt', order_record.pending_fulfillment_at,
    'fulfillmentTimeState', order_record.fulfillment_time_state,
    'fulfillmentTimeVersion', order_record.fulfillment_time_version,
    'fulfillmentTimeResponseExpiresAt', order_record.fulfillment_time_response_expires_at,
    'fulfillmentTimeChangeReason', order_record.fulfillment_time_change_reason,
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

create or replace function public.enqueue_order_notification_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_code text;
begin
  if old.status = new.status then
    return null;
  end if;
  v_template_code := case new.status
    when 'CONFIRMED'::public.order_status then 'ORDER_CONFIRMED'
    when 'READY'::public.order_status then 'ORDER_READY'
    when 'CANCELLED'::public.order_status then 'ORDER_CANCELLED'
    else null
  end;
  if v_template_code is null
     or public.notification_feature_access_code(new.organization_id, 'LINE_NOTIFICATIONS') <> 'OK' then
    return null;
  end if;

  insert into public.notification_jobs (
    organization_id, stall_id, integration_id, contact_link_id, order_id,
    provider, template_code, event_version, recipient_reference, status, next_attempt_at
  )
  select link.organization_id, link.stall_id, link.integration_id, link.id,
    new.id, link.provider, v_template_code, 0,
    link.provider_user_secret_reference,
    'PENDING'::public.notification_job_status, now()
  from public.customer_contact_links link
  join public.notification_integrations integration on integration.id = link.integration_id
  where link.customer_reference_id = new.id
    and link.provider = 'LINE'::public.notification_provider
    and link.consent_status = 'GRANTED'::public.customer_consent_status
    and integration.status = 'ACTIVE'::public.notification_integration_status
  on conflict do nothing;
  return null;
end;
$$;

create or replace function public.enqueue_fulfillment_time_notification_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fulfillment_time_state <> 'CUSTOMER_ACTION_REQUIRED'
     or (old.fulfillment_time_state = new.fulfillment_time_state
       and old.fulfillment_time_version = new.fulfillment_time_version)
     or public.notification_feature_access_code(new.organization_id, 'LINE_NOTIFICATIONS') <> 'OK' then
    return null;
  end if;
  insert into public.notification_jobs (
    organization_id, stall_id, integration_id, contact_link_id, order_id,
    provider, template_code, event_version, recipient_reference, status, next_attempt_at
  )
  select link.organization_id, link.stall_id, link.integration_id, link.id,
    new.id, link.provider, 'FULFILLMENT_TIME_PROPOSED',
    new.fulfillment_time_version, link.provider_user_secret_reference,
    'PENDING'::public.notification_job_status, now()
  from public.customer_contact_links link
  join public.notification_integrations integration on integration.id = link.integration_id
  where link.customer_reference_id = new.id
    and link.provider = 'LINE'::public.notification_provider
    and link.consent_status = 'GRANTED'::public.customer_consent_status
    and integration.status = 'ACTIVE'::public.notification_integration_status
  on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.enqueue_fulfillment_time_notification_job()
  from public, anon, authenticated;
grant execute on function public.enqueue_fulfillment_time_notification_job()
  to service_role;

drop trigger if exists orders_enqueue_fulfillment_time_notification_job on public.orders;
create trigger orders_enqueue_fulfillment_time_notification_job
after update of fulfillment_time_state, fulfillment_time_version on public.orders
for each row execute function public.enqueue_fulfillment_time_notification_job();
