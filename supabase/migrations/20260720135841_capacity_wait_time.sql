-- Deterministic stall capacity, immutable order quotes, and controlled auto pause/resume.

create table public.stall_capacity_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  window_minutes integer not null default 15,
  max_orders_per_window integer not null default 20,
  max_items_per_window integer not null default 60,
  warning_utilization_percent integer not null default 75,
  pause_utilization_percent integer not null default 100,
  default_prep_minutes integer not null default 10,
  minimum_quote_minutes integer not null default 5,
  maximum_quote_minutes integer not null default 120,
  quote_buffer_minutes integer not null default 3,
  acknowledgment_threshold_minutes integer not null default 30,
  manual_wait_minutes integer,
  auto_pause_enabled boolean not null default false,
  auto_resume_enabled boolean not null default false,
  pause_source text not null default 'NONE',
  is_active boolean not null default true,
  last_calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_capacity_settings_stall_unique unique (stall_id),
  constraint stall_capacity_settings_window_check check (window_minutes between 5 and 120),
  constraint stall_capacity_settings_orders_check check (max_orders_per_window between 1 and 1000),
  constraint stall_capacity_settings_items_check check (max_items_per_window between 1 and 5000),
  constraint stall_capacity_settings_utilization_check check (
    warning_utilization_percent between 1 and 99
    and pause_utilization_percent between warning_utilization_percent + 1 and 200
  ),
  constraint stall_capacity_settings_quote_check check (
    default_prep_minutes between 0 and 240
    and minimum_quote_minutes between 0 and 240
    and maximum_quote_minutes between minimum_quote_minutes and 480
    and quote_buffer_minutes between 0 and 60
    and acknowledgment_threshold_minutes between 1 and 480
    and (manual_wait_minutes is null or manual_wait_minutes between 0 and 480)
  ),
  constraint stall_capacity_settings_pause_source_check check (
    pause_source in ('NONE', 'AUTO', 'MANUAL')
  )
);

create table public.product_capacity_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  capacity_weight numeric(8,2) not null default 1,
  prep_minutes integer not null default 10,
  max_quantity_per_window integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_capacity_rules_stall_product_unique unique (stall_id, product_id),
  constraint product_capacity_rules_weight_check check (capacity_weight between 0.1 and 100),
  constraint product_capacity_rules_prep_check check (prep_minutes between 0 and 240),
  constraint product_capacity_rules_quantity_check check (
    max_quantity_per_window is null or max_quantity_per_window between 1 and 5000
  )
);

create table public.capacity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  event_type text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  order_count integer not null default 0,
  item_count integer not null default 0,
  weighted_load numeric(12,2) not null default 0,
  estimated_wait_minutes integer not null default 0,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capacity_events_type_check check (event_type in (
    'CAPACITY_WARNING', 'AUTO_PAUSED', 'AUTO_RESUMED',
    'MANUAL_OVERRIDE', 'WAIT_TIME_CHANGED'
  )),
  constraint capacity_events_window_check check (window_end >= window_start),
  constraint capacity_events_counts_check check (
    order_count >= 0 and item_count >= 0 and weighted_load >= 0
    and estimated_wait_minutes between 0 and 480
  ),
  constraint capacity_events_reason_check check (char_length(reason) between 1 and 300)
);

create index stall_capacity_settings_scope_idx
  on public.stall_capacity_settings (organization_id, stall_id, is_active);
create index product_capacity_rules_scope_idx
  on public.product_capacity_rules (organization_id, stall_id, is_active);
create index product_capacity_rules_product_idx
  on public.product_capacity_rules (product_id, stall_id);
create index capacity_events_stall_created_idx
  on public.capacity_events (stall_id, created_at desc);
create index capacity_events_organization_created_idx
  on public.capacity_events (organization_id, created_at desc);

alter table public.orders
  add column quoted_wait_minutes integer,
  add column quoted_ready_at timestamptz;
alter table public.orders
  add constraint orders_quoted_wait_check check (
    quoted_wait_minutes is null or quoted_wait_minutes between 0 and 480
  );
create index orders_stall_capacity_status_idx
  on public.orders (stall_id, status, updated_at desc);

create or replace function public.enforce_capacity_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stalls stall
    where stall.id = new.stall_id
      and stall.organization_id = new.organization_id
  ) then
    raise exception 'CAPACITY_STALL_SCOPE_MISMATCH';
  end if;
  if tg_table_name = 'product_capacity_rules' and not exists (
    select 1 from public.products product
    where product.id = (to_jsonb(new)->>'product_id')::uuid
      and product.organization_id = new.organization_id
  ) then
    raise exception 'CAPACITY_PRODUCT_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function public.touch_capacity_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stall_capacity_settings_scope_before_write
before insert or update on public.stall_capacity_settings
for each row execute function public.enforce_capacity_scope();
create trigger product_capacity_rules_scope_before_write
before insert or update on public.product_capacity_rules
for each row execute function public.enforce_capacity_scope();
create trigger stall_capacity_settings_touch_before_update
before update on public.stall_capacity_settings
for each row execute function public.touch_capacity_updated_at();
create trigger product_capacity_rules_touch_before_update
before update on public.product_capacity_rules
for each row execute function public.touch_capacity_updated_at();
create trigger capacity_events_touch_before_update
before update on public.capacity_events
for each row execute function public.touch_capacity_updated_at();

create or replace function public.create_default_stall_capacity_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.stall_capacity_settings (
    organization_id, stall_id, default_prep_minutes, minimum_quote_minutes
  ) values (new.organization_id, new.id, 10, 5)
  on conflict (stall_id) do nothing;
  return new;
end;
$$;

create trigger stalls_create_default_capacity_settings
after insert on public.stalls
for each row execute function public.create_default_stall_capacity_settings();

insert into public.stall_capacity_settings (
  organization_id, stall_id, default_prep_minutes, minimum_quote_minutes
)
select stall.organization_id, stall.id,
  least(greatest(coalesce(settings.estimated_wait_minutes, 15), 0), 240),
  least(greatest(coalesce(settings.estimated_wait_minutes, 15) - 5, 0), 240)
from public.stalls stall
left join public.stall_ordering_settings settings on settings.stall_id = stall.id
on conflict (stall_id) do nothing;

create or replace function public.calculate_stall_capacity(
  p_stall_id uuid,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_capacity_settings%rowtype;
  v_stall public.stalls%rowtype;
  v_window_start timestamptz;
  v_order_count integer := 0;
  v_item_count integer := 0;
  v_weighted_load numeric := 0;
  v_requested_items integer := 0;
  v_requested_weight numeric := 0;
  v_requested_prep integer := 0;
  v_completed_weight numeric := 0;
  v_station_count integer := 1;
  v_effective_throughput numeric := 0.1;
  v_utilization numeric := 0;
  v_quote_min integer := 0;
  v_quote_max integer := 0;
  v_legacy_wait integer := 15;
  v_product_limit_exceeded boolean := false;
  v_product_limit_product_id uuid;
begin
  select * into v_settings
  from public.stall_capacity_settings
  where stall_id = p_stall_id;
  select * into v_stall
  from public.stalls
  where id = p_stall_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'STALL_NOT_FOUND');
  end if;

  if v_settings.id is null or not v_settings.is_active then
    select estimated_wait_minutes into v_legacy_wait
    from public.stall_ordering_settings where stall_id = p_stall_id;
    v_legacy_wait := coalesce(v_legacy_wait, 15);
    return jsonb_build_object(
      'ok', true,
      'quote_min_minutes', v_legacy_wait,
      'quote_max_minutes', v_legacy_wait,
      'acknowledgment_threshold_minutes', 480,
      'requires_acknowledgment', false,
      'utilization_percent', 0,
      'order_count', 0,
      'item_count', 0,
      'weighted_load', 0,
      'product_limit_exceeded', false,
      'product_limit_product_id', null,
      'pause_source', 'NONE',
      'accepting_public_orders', (
        v_stall.is_active and v_stall.ordering_enabled
        and v_stall.business_status = 'OPEN'::public.stall_business_status
        and v_stall.ordering_state = 'OPEN'::public.stall_ordering_state
        and not v_stall.is_sold_out
      )
    );
  end if;

  v_window_start := now() - make_interval(mins => v_settings.window_minutes);

  select count(distinct orders.id)::integer,
    coalesce(sum(items.quantity), 0)::integer,
    coalesce(sum(items.quantity * coalesce(rule.capacity_weight, 1)), 0)
  into v_order_count, v_item_count, v_weighted_load
  from public.orders orders
  join public.order_items items on items.order_id = orders.id
  left join public.product_capacity_rules rule
    on rule.stall_id = orders.stall_id
   and rule.product_id = items.product_id
   and rule.is_active
  where orders.stall_id = p_stall_id
    and orders.status in (
      'CONFIRMED'::public.order_status,
      'PREPARING'::public.order_status,
      'PACKING'::public.order_status
    );

  with requested as (
    select
      coalesce(item->>'product_id', item->>'productId')::uuid as product_id,
      greatest(coalesce((item->>'quantity')::integer, 0), 0) as quantity
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array'
        then coalesce(p_items, '[]'::jsonb) else '[]'::jsonb end
    ) item
    where coalesce(item->>'product_id', item->>'productId') is not null
  )
  select coalesce(sum(requested.quantity), 0)::integer,
    coalesce(sum(requested.quantity * coalesce(rule.capacity_weight, 1)), 0),
    coalesce(max(coalesce(rule.prep_minutes, v_settings.default_prep_minutes)), 0)
  into v_requested_items, v_requested_weight, v_requested_prep
  from requested
  left join public.product_capacity_rules rule
    on rule.stall_id = p_stall_id
   and rule.product_id = requested.product_id
   and rule.is_active;

  with requested as (
    select
      coalesce(item->>'product_id', item->>'productId')::uuid as product_id,
      sum(greatest(coalesce((item->>'quantity')::integer, 0), 0))::integer as quantity
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array'
        then coalesce(p_items, '[]'::jsonb) else '[]'::jsonb end
    ) item
    where coalesce(item->>'product_id', item->>'productId') is not null
    group by coalesce(item->>'product_id', item->>'productId')::uuid
  ), current_window as (
    select items.product_id, coalesce(sum(items.quantity), 0)::integer as quantity
    from public.orders orders
    join public.order_items items on items.order_id = orders.id
    where orders.stall_id = p_stall_id
      and orders.created_at >= v_window_start
      and orders.status not in (
        'CANCELLED'::public.order_status,
        'EXPIRED'::public.order_status
      )
    group by items.product_id
  )
  select true, requested.product_id
  into v_product_limit_exceeded, v_product_limit_product_id
  from requested
  join public.product_capacity_rules rule
    on rule.stall_id = p_stall_id
   and rule.product_id = requested.product_id
   and rule.is_active
   and rule.max_quantity_per_window is not null
  left join current_window on current_window.product_id = requested.product_id
  where coalesce(current_window.quantity, 0) + requested.quantity
    > rule.max_quantity_per_window
  order by requested.product_id
  limit 1;
  v_product_limit_exceeded := coalesce(v_product_limit_exceeded, false);

  select greatest(count(*)::integer, 1) into v_station_count
  from public.kitchen_stations
  where stall_id = p_stall_id and is_active;

  select coalesce(sum(tasks.quantity * coalesce(rule.capacity_weight, 1)), 0)
  into v_completed_weight
  from public.order_production_tasks tasks
  join public.order_items items on items.id = tasks.order_item_id
  left join public.product_capacity_rules rule
    on rule.stall_id = tasks.stall_id
   and rule.product_id = items.product_id
   and rule.is_active
  where tasks.stall_id = p_stall_id
    and tasks.status = 'COMPLETED'
    and tasks.completed_at >= v_window_start;

  v_effective_throughput := greatest(
    case when v_completed_weight > 0
      then v_completed_weight / v_settings.window_minutes
      else (v_settings.max_items_per_window::numeric / v_settings.window_minutes)
        * sqrt(v_station_count::numeric)
    end,
    0.1
  );
  v_utilization := greatest(
    v_order_count::numeric * 100 / v_settings.max_orders_per_window,
    v_item_count::numeric * 100 / v_settings.max_items_per_window,
    v_weighted_load * 100 / v_settings.max_items_per_window
  );

  if v_settings.manual_wait_minutes is not null then
    v_quote_min := v_settings.manual_wait_minutes;
    v_quote_max := v_settings.manual_wait_minutes;
  else
    v_quote_min := ceil(
      greatest(v_settings.default_prep_minutes, v_requested_prep)
      + ((v_weighted_load + v_requested_weight) / v_effective_throughput)
      + v_settings.quote_buffer_minutes
    )::integer;
    v_quote_min := least(
      greatest(v_quote_min, v_settings.minimum_quote_minutes),
      v_settings.maximum_quote_minutes
    );
    v_quote_max := least(v_quote_min + 5, v_settings.maximum_quote_minutes);
  end if;

  return jsonb_build_object(
    'ok', true,
    'quote_min_minutes', v_quote_min,
    'quote_max_minutes', v_quote_max,
    'acknowledgment_threshold_minutes', v_settings.acknowledgment_threshold_minutes,
    'requires_acknowledgment', v_quote_max >= v_settings.acknowledgment_threshold_minutes,
    'utilization_percent', round(v_utilization, 2),
    'order_count', v_order_count,
    'item_count', v_item_count,
    'requested_item_count', v_requested_items,
    'weighted_load', round(v_weighted_load, 2),
    'requested_weight', round(v_requested_weight, 2),
    'product_limit_exceeded', v_product_limit_exceeded,
    'product_limit_product_id', v_product_limit_product_id,
    'effective_throughput_per_minute', round(v_effective_throughput, 2),
    'active_station_count', v_station_count,
    'warning_utilization_percent', v_settings.warning_utilization_percent,
    'pause_utilization_percent', v_settings.pause_utilization_percent,
    'pause_source', v_settings.pause_source,
    'auto_pause_enabled', v_settings.auto_pause_enabled,
    'auto_resume_enabled', v_settings.auto_resume_enabled,
    'window_start', v_window_start,
    'window_end', now(),
    'accepting_public_orders', (
      v_stall.is_active and v_stall.ordering_enabled
      and v_stall.business_status = 'OPEN'::public.stall_business_status
      and v_stall.ordering_state = 'OPEN'::public.stall_ordering_state
      and not v_stall.is_sold_out
    )
  );
end;
$$;

create or replace function public.refresh_stall_capacity(
  p_stall_id uuid,
  p_apply_automation boolean default true,
  p_reason text default 'SYSTEM_RECALCULATION'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_capacity_settings%rowtype;
  v_stall public.stalls%rowtype;
  v_snapshot jsonb;
  v_utilization numeric;
  v_quote integer;
  v_window_start timestamptz;
  v_action text;
begin
  perform 1 from public.stalls where id = p_stall_id for update;
  select * into v_settings from public.stall_capacity_settings where stall_id = p_stall_id;
  select * into v_stall from public.stalls where id = p_stall_id;
  v_snapshot := public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);
  if v_settings.id is null or not v_settings.is_active then return v_snapshot; end if;

  v_utilization := coalesce((v_snapshot->>'utilization_percent')::numeric, 0);
  v_quote := coalesce((v_snapshot->>'quote_max_minutes')::integer, 0);
  v_window_start := coalesce((v_snapshot->>'window_start')::timestamptz, now());

  update public.stall_capacity_settings
  set last_calculated_at = now()
  where stall_id = p_stall_id;

  if v_utilization >= v_settings.warning_utilization_percent
     and not exists (
       select 1 from public.capacity_events event
       where event.stall_id = p_stall_id
         and event.event_type = 'CAPACITY_WARNING'
         and event.created_at >= v_window_start
     ) then
    insert into public.capacity_events (
      organization_id, stall_id, event_type, window_start, window_end,
      order_count, item_count, weighted_load, estimated_wait_minutes, reason
    ) values (
      v_stall.organization_id, p_stall_id, 'CAPACITY_WARNING', v_window_start, now(),
      coalesce((v_snapshot->>'order_count')::integer, 0),
      coalesce((v_snapshot->>'item_count')::integer, 0),
      coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
      left(coalesce(nullif(btrim(p_reason), ''), 'CAPACITY_THRESHOLD_REACHED'), 300)
    );
    insert into public.operational_alerts (
      organization_id, stall_id, alert_type, severity, message
    ) values (
      v_stall.organization_id, p_stall_id, 'CAPACITY_WARNING', 'WARNING',
      '目前產能使用率已達 ' || round(v_utilization)::text || '%。'
    ) on conflict (stall_id, alert_type)
      where status in ('ACTIVE', 'ACKNOWLEDGED')
      do update set severity = excluded.severity, message = excluded.message,
        status = 'ACTIVE', detected_at = now(), acknowledged_at = null,
        resolved_at = null, updated_at = now();
  end if;

  if p_apply_automation
     and v_settings.auto_pause_enabled
     and v_utilization >= v_settings.pause_utilization_percent
     and v_settings.pause_source <> 'MANUAL'
     and v_stall.business_status = 'OPEN'::public.stall_business_status then
    update public.stall_capacity_settings
    set pause_source = 'AUTO', last_calculated_at = now()
    where stall_id = p_stall_id and pause_source <> 'AUTO';
    if found then
      update public.stalls set ordering_state = 'PAUSED'::public.stall_ordering_state
      where id = p_stall_id;
      update public.qr_codes set state = 'PAUSED'::public.qr_code_state
      where stall_id = p_stall_id and state = 'ACTIVE'::public.qr_code_state;
      update public.order_sessions
      set status = 'REVOKED'::public.order_session_status, revoked_at = now()
      where stall_id = p_stall_id and status = 'ACTIVE'::public.order_session_status;
      insert into public.capacity_events (
        organization_id, stall_id, event_type, window_start, window_end,
        order_count, item_count, weighted_load, estimated_wait_minutes, reason
      ) values (
        v_stall.organization_id, p_stall_id, 'AUTO_PAUSED', v_window_start, now(),
        coalesce((v_snapshot->>'order_count')::integer, 0),
        coalesce((v_snapshot->>'item_count')::integer, 0),
        coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
        left(coalesce(nullif(btrim(p_reason), ''), 'AUTO_PAUSE_THRESHOLD_REACHED'), 300)
      );
      insert into public.operational_alerts (
        organization_id, stall_id, alert_type, severity, message
      ) values (
        v_stall.organization_id, p_stall_id, 'CAPACITY_AUTO_PAUSED', 'CRITICAL',
        '產能已達上限，公開 QR 點餐已自動暫停。'
      ) on conflict (stall_id, alert_type)
        where status in ('ACTIVE', 'ACKNOWLEDGED')
        do update set status = 'ACTIVE', detected_at = now(), resolved_at = null,
          updated_at = now();
      v_action := 'CAPACITY_AUTO_PAUSED';
    end if;
  elsif p_apply_automation
     and v_settings.auto_resume_enabled
     and v_settings.pause_source = 'AUTO'
     and v_utilization < v_settings.warning_utilization_percent then
    update public.stall_capacity_settings
    set pause_source = 'NONE', last_calculated_at = now()
    where stall_id = p_stall_id and pause_source = 'AUTO';
    if found then
      update public.stalls set ordering_state = 'OPEN'::public.stall_ordering_state
      where id = p_stall_id;
      update public.qr_codes set state = 'ACTIVE'::public.qr_code_state
      where stall_id = p_stall_id
        and state = 'PAUSED'::public.qr_code_state
        and (expires_at is null or expires_at > now());
      insert into public.capacity_events (
        organization_id, stall_id, event_type, window_start, window_end,
        order_count, item_count, weighted_load, estimated_wait_minutes, reason
      ) values (
        v_stall.organization_id, p_stall_id, 'AUTO_RESUMED', v_window_start, now(),
        coalesce((v_snapshot->>'order_count')::integer, 0),
        coalesce((v_snapshot->>'item_count')::integer, 0),
        coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
        left(coalesce(nullif(btrim(p_reason), ''), 'CAPACITY_RECOVERED'), 300)
      );
      update public.operational_alerts
      set status = 'RESOLVED', resolved_at = now(), updated_at = now()
      where stall_id = p_stall_id
        and alert_type in ('CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED')
        and status in ('ACTIVE', 'ACKNOWLEDGED');
      v_action := 'CAPACITY_AUTO_RESUMED';
    end if;
  end if;

  if v_action is not null then
    insert into public.audit_logs (
      id, organization_id, stall_id, actor_profile_id, action, entity_type,
      entity_id, outcome, request_id, metadata
    ) values (
      gen_random_uuid(), v_stall.organization_id, p_stall_id, null, v_action, 'STALL', p_stall_id,
      'SUCCESS'::public.audit_outcome, 'capacity:' || gen_random_uuid()::text,
      jsonb_build_object(
        'utilizationPercent', round(v_utilization, 2),
        'estimatedWaitMinutes', v_quote,
        'reason', left(coalesce(p_reason, ''), 100)
      )::text
    );
  end if;

  return public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);
end;
$$;

create or replace function public.issue_order_session_with_capacity(
  p_qr_token text,
  p_session_token_hash text,
  p_ip_hash text,
  p_device_hash text,
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
  v_qr public.qr_codes%rowtype;
  v_capacity jsonb;
  v_result jsonb;
begin
  select * into v_qr from public.qr_codes where token = p_qr_token;
  if found then
    v_capacity := public.refresh_stall_capacity(v_qr.stall_id, true, 'PUBLIC_SESSION_REQUEST');
    if coalesce(v_capacity->>'pause_source', 'NONE') = 'AUTO'
       and not coalesce((v_capacity->>'accepting_public_orders')::boolean, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', 'CAPACITY_PAUSED',
        v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
        p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
      );
      return jsonb_build_object(
        'ok', false, 'code', 'CAPACITY_PAUSED', 'capacity', v_capacity
      );
    end if;
  end if;
  v_result := public.issue_order_session(
    p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
    p_qr_token_hash, p_behavior_hash, p_request_id
  );
  if coalesce((v_result->>'ok')::boolean, false) and v_capacity is not null then
    v_result := v_result || jsonb_build_object('capacity', v_capacity);
  end if;
  return v_result;
end;
$$;

create or replace function public.create_public_order_with_capacity(
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
  v_capacity jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_quote integer;
begin
  select * into v_session from public.order_sessions
  where token_hash = p_session_token_hash
  for update;
  if found then
    perform 1 from public.stalls
    where id = v_session.stall_id
    for update;
    v_capacity := public.calculate_stall_capacity(v_session.stall_id, p_items);
    if coalesce((v_capacity->>'product_limit_exceeded')::boolean, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_CAPACITY_EXCEEDED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'PRODUCT_CAPACITY_EXCEEDED', 'capacity', v_capacity
      );
    end if;
    if coalesce(v_capacity->>'pause_source', 'NONE') = 'AUTO'
       and not coalesce((v_capacity->>'accepting_public_orders')::boolean, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'CAPACITY_PAUSED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'CAPACITY_PAUSED', 'capacity', v_capacity
      );
    end if;
    if coalesce((v_capacity->>'requires_acknowledgment')::boolean, false)
       and not coalesce(p_wait_acknowledged, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'WAIT_ACKNOWLEDGMENT_REQUIRED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'WAIT_ACKNOWLEDGMENT_REQUIRED', 'capacity', v_capacity
      );
    end if;
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
  if not coalesce((v_result->>'idempotent_replay')::boolean, false) and v_capacity is not null then
    v_quote := coalesce((v_capacity->>'quote_max_minutes')::integer, 0);
    update public.orders
    set quoted_wait_minutes = v_quote,
        quoted_ready_at = created_at + make_interval(mins => v_quote),
        updated_at = now()
    where id = v_order_id and stall_id = v_session.stall_id;
  end if;
  select quoted_wait_minutes into v_quote from public.orders where id = v_order_id;
  v_result := jsonb_set(
    v_result, '{order,quoted_wait_minutes}', coalesce(to_jsonb(v_quote), 'null'::jsonb), true
  );
  v_result := jsonb_set(
    v_result, '{order,quoted_ready_at}',
    coalesce((select to_jsonb(quoted_ready_at) from public.orders where id = v_order_id), 'null'::jsonb),
    true
  );
  return v_result;
end;
$$;

create or replace function public.create_public_delivery_order_with_capacity(
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
  v_capacity jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_quote integer;
begin
  select * into v_session from public.order_sessions
  where token_hash = p_session_token_hash
  for update;
  if found then
    perform 1 from public.stalls
    where id = v_session.stall_id
    for update;
    v_capacity := public.calculate_stall_capacity(v_session.stall_id, p_items);
    if coalesce((v_capacity->>'product_limit_exceeded')::boolean, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_CAPACITY_EXCEEDED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'PRODUCT_CAPACITY_EXCEEDED', 'capacity', v_capacity
      );
    end if;
    if coalesce(v_capacity->>'pause_source', 'NONE') = 'AUTO'
       and not coalesce((v_capacity->>'accepting_public_orders')::boolean, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'CAPACITY_PAUSED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'CAPACITY_PAUSED', 'capacity', v_capacity
      );
    end if;
    if coalesce((v_capacity->>'requires_acknowledgment')::boolean, false)
       and not coalesce(p_wait_acknowledged, false) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'WAIT_ACKNOWLEDGMENT_REQUIRED',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object(
        'ok', false, 'code', 'WAIT_ACKNOWLEDGMENT_REQUIRED', 'capacity', v_capacity
      );
    end if;
  end if;

  v_result := public.create_public_delivery_order(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_phone, p_delivery_address, p_customer_note,
    p_items, p_tracking_token_hash, p_pickup_code_hash, p_request_id
  );
  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  if not coalesce((v_result->>'idempotent_replay')::boolean, false) and v_capacity is not null then
    v_quote := coalesce((v_capacity->>'quote_max_minutes')::integer, 0);
    update public.orders
    set quoted_wait_minutes = v_quote,
        quoted_ready_at = created_at + make_interval(mins => v_quote),
        updated_at = now()
    where id = v_order_id and stall_id = v_session.stall_id;
  end if;
  select quoted_wait_minutes into v_quote from public.orders where id = v_order_id;
  v_result := jsonb_set(
    v_result, '{order,quoted_wait_minutes}', coalesce(to_jsonb(v_quote), 'null'::jsonb), true
  );
  v_result := jsonb_set(
    v_result, '{order,quoted_ready_at}',
    coalesce((select to_jsonb(quoted_ready_at) from public.orders where id = v_order_id), 'null'::jsonb),
    true
  );
  return v_result;
end;
$$;

create or replace function public.refresh_capacity_after_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    begin
      perform public.refresh_stall_capacity(new.stall_id, true, 'ORDER_STATUS_CHANGED');
    exception when others then
      raise warning 'CAPACITY_REFRESH_FAILED:%', sqlstate;
    end;
  end if;
  return new;
end;
$$;

create trigger orders_refresh_capacity_after_change
after insert or update of status on public.orders
for each row execute function public.refresh_capacity_after_order_change();

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED', 'CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED'
  ));

alter table public.stall_capacity_settings enable row level security;
alter table public.stall_capacity_settings force row level security;
alter table public.product_capacity_rules enable row level security;
alter table public.product_capacity_rules force row level security;
alter table public.capacity_events enable row level security;
alter table public.capacity_events force row level security;

revoke all on table public.stall_capacity_settings from public, anon, authenticated;
revoke all on table public.product_capacity_rules from public, anon, authenticated;
revoke all on table public.capacity_events from public, anon, authenticated;
grant select on table public.stall_capacity_settings to authenticated;
grant select on table public.product_capacity_rules to authenticated;
grant select on table public.capacity_events to authenticated;
grant select, insert, update, delete on table public.stall_capacity_settings to service_role;
grant select, insert, update, delete on table public.product_capacity_rules to service_role;
grant select, insert, update, delete on table public.capacity_events to service_role;

create policy stall_capacity_settings_member_select
on public.stall_capacity_settings for select to authenticated
using (public.has_stall_role(
  stall_id,
  array['STALL_MANAGER', 'STAFF']::public.user_role[]
));
create policy product_capacity_rules_manager_select
on public.product_capacity_rules for select to authenticated
using (public.can_manage_stall(stall_id));
create policy capacity_events_member_select
on public.capacity_events for select to authenticated
using (public.has_stall_role(
  stall_id,
  array['STALL_MANAGER', 'STAFF']::public.user_role[]
));

revoke all on function public.enforce_capacity_scope() from public, anon, authenticated;
revoke all on function public.touch_capacity_updated_at() from public, anon, authenticated;
revoke all on function public.create_default_stall_capacity_settings() from public, anon, authenticated;
revoke all on function public.calculate_stall_capacity(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.refresh_stall_capacity(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.issue_order_session_with_capacity(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.create_public_order_with_capacity(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.create_public_delivery_order_with_capacity(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.refresh_capacity_after_order_change() from public, anon, authenticated;

grant execute on function public.calculate_stall_capacity(uuid, jsonb) to service_role;
grant execute on function public.refresh_stall_capacity(uuid, boolean, text) to service_role;
grant execute on function public.issue_order_session_with_capacity(text, text, text, text, text, text, text) to service_role;
grant execute on function public.create_public_order_with_capacity(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) to service_role;
grant execute on function public.create_public_delivery_order_with_capacity(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text, boolean
) to service_role;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, feature.feature_code, true, feature.limit_value,
  feature.configuration_json
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
cross join lateral (
  values
    ('WAIT_TIME_QUOTE'::text, 1::integer,
      jsonb_build_object('manualOverride', true)),
    ('CAPACITY_CONTROL'::text,
      case when plan.code in ('PRO', 'ENTERPRISE') then 500 else 0 end,
      jsonb_build_object(
        'automaticControl', plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE'),
        'productRules', plan.code in ('PRO', 'ENTERPRISE')
      ))
) feature(feature_code, limit_value, configuration_json)
where plan.code in ('TRIAL', 'LITE', 'STANDARD', 'PRO', 'ENTERPRISE')
  and (
    feature.feature_code = 'WAIT_TIME_QUOTE'
    or plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE')
  )
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();
