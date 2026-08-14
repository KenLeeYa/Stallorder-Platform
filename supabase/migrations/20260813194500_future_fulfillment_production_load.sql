set lock_timeout = '5s';
set statement_timeout = '2min';

alter function public.refresh_kds_operational_alerts(uuid, uuid)
  rename to refresh_kds_operational_alerts_legacy_20260813;

create or replace function public.refresh_kds_operational_alerts(
  p_organization_id uuid,
  p_stall_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_critical_minutes integer;
  v_changed integer := 0;
  v_affected integer := 0;
begin
  select settings.kds_critical_minutes into v_critical_minutes
  from public.stall_ordering_settings settings
  where settings.organization_id = p_organization_id
    and settings.stall_id = p_stall_id;
  if v_critical_minutes is null then
    raise exception 'KDS_STALL_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kds-alerts:' || p_stall_id::text, 0));

  update public.operational_alerts alert
  set status = 'RESOLVED', resolved_at = now()
  where alert.organization_id = p_organization_id
    and alert.stall_id = p_stall_id
    and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    and (
      (
        alert.alert_type = 'KDS_ORDER_OVERDUE'
        and not exists (
          select 1
          from public.order_production_tasks task
          join public.orders orders on orders.id = task.order_id
          where task.stall_id = p_stall_id
            and task.status in ('PENDING', 'PREPARING')
            and orders.status in ('CONFIRMED', 'PREPARING', 'PACKING')
            and (
              orders.status in ('PREPARING', 'PACKING')
              or public.stall_business_date(
                orders.stall_id,
                coalesce(
                  orders.committed_fulfillment_at,
                  orders.requested_fulfillment_at,
                  orders.scheduled_pickup_at,
                  now()
                )
              ) <= public.stall_business_date(orders.stall_id, now())
            )
            and greatest(
              coalesce(orders.confirmed_at, orders.created_at),
              case when orders.status in ('PREPARING', 'PACKING')
                then coalesce(task.started_at, orders.confirmed_at, orders.created_at)
                else coalesce(
                  orders.committed_fulfillment_at,
                  orders.requested_fulfillment_at,
                  orders.scheduled_pickup_at,
                  coalesce(orders.confirmed_at, orders.created_at)
                )
              end
            ) <= now() - make_interval(mins => v_critical_minutes)
        )
      )
      or (
        alert.alert_type = 'STATION_BACKLOG'
        and not exists (
          select 1
          from public.order_production_tasks task
          join public.orders orders on orders.id = task.order_id
          where task.stall_id = p_stall_id
            and task.status in ('PENDING', 'PREPARING')
            and orders.status in ('CONFIRMED', 'PREPARING', 'PACKING')
            and (
              orders.status in ('PREPARING', 'PACKING')
              or public.stall_business_date(
                orders.stall_id,
                coalesce(
                  orders.committed_fulfillment_at,
                  orders.requested_fulfillment_at,
                  orders.scheduled_pickup_at,
                  now()
                )
              ) <= public.stall_business_date(orders.stall_id, now())
            )
          group by task.station_id
          having sum(task.quantity) >= 10
        )
      )
    );
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select p_organization_id, p_stall_id, 'KDS_ORDER_OVERDUE', 'CRITICAL',
    '廚房有訂單超過設定的嚴重逾時門檻，請立即確認製作進度。'
  where exists (
    select 1
    from public.order_production_tasks task
    join public.orders orders on orders.id = task.order_id
    where task.stall_id = p_stall_id
      and task.status in ('PENDING', 'PREPARING')
      and orders.status in ('CONFIRMED', 'PREPARING', 'PACKING')
      and (
        orders.status in ('PREPARING', 'PACKING')
        or public.stall_business_date(
          orders.stall_id,
          coalesce(
            orders.committed_fulfillment_at,
            orders.requested_fulfillment_at,
            orders.scheduled_pickup_at,
            now()
          )
        ) <= public.stall_business_date(orders.stall_id, now())
      )
      and greatest(
        coalesce(orders.confirmed_at, orders.created_at),
        case when orders.status in ('PREPARING', 'PACKING')
          then coalesce(task.started_at, orders.confirmed_at, orders.created_at)
          else coalesce(
            orders.committed_fulfillment_at,
            orders.requested_fulfillment_at,
            orders.scheduled_pickup_at,
            coalesce(orders.confirmed_at, orders.created_at)
          )
        end
      ) <= now() - make_interval(mins => v_critical_minutes)
  )
  and not exists (
    select 1 from public.operational_alerts alert
    where alert.stall_id = p_stall_id
      and alert.alert_type = 'KDS_ORDER_OVERDUE'
      and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
  );
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select p_organization_id, p_stall_id, 'STATION_BACKLOG', 'WARNING',
    backlog.station_name || '目前累積 ' || backlog.item_count::text || ' 份待製作品項。'
  from (
    select station.name as station_name, sum(task.quantity)::integer as item_count
    from public.order_production_tasks task
    join public.orders orders on orders.id = task.order_id
    join public.kitchen_stations station on station.id = task.station_id
    where task.stall_id = p_stall_id
      and task.status in ('PENDING', 'PREPARING')
      and orders.status in ('CONFIRMED', 'PREPARING', 'PACKING')
      and (
        orders.status in ('PREPARING', 'PACKING')
        or public.stall_business_date(
          orders.stall_id,
          coalesce(
            orders.committed_fulfillment_at,
            orders.requested_fulfillment_at,
            orders.scheduled_pickup_at,
            now()
          )
        ) <= public.stall_business_date(orders.stall_id, now())
      )
    group by station.id, station.name
    having sum(task.quantity) >= 10
    order by sum(task.quantity) desc, station.sort_order
    limit 1
  ) backlog
  where not exists (
    select 1 from public.operational_alerts alert
    where alert.stall_id = p_stall_id
      and alert.alert_type = 'STATION_BACKLOG'
      and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
  );
  get diagnostics v_affected = row_count;
  v_changed := v_changed + v_affected;

  return v_changed;
end;
$$;

alter function public.calculate_stall_capacity(uuid, jsonb)
  rename to calculate_stall_capacity_legacy_20260813;

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
    )
    and (
      orders.status in (
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status
      )
      or public.stall_business_date(
        orders.stall_id,
        coalesce(
          orders.committed_fulfillment_at,
          orders.requested_fulfillment_at,
          orders.scheduled_pickup_at,
          now()
        )
      ) <= public.stall_business_date(orders.stall_id, now())
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
      and (
        orders.status in (
          'PREPARING'::public.order_status,
          'PACKING'::public.order_status
        )
        or (
          public.stall_business_date(
            orders.stall_id,
            coalesce(
              orders.committed_fulfillment_at,
              orders.requested_fulfillment_at,
              orders.scheduled_pickup_at,
              now()
            )
          ) <= public.stall_business_date(orders.stall_id, now())
          and orders.created_at >= v_window_start
        )
      )
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

revoke all on function public.refresh_kds_operational_alerts_legacy_20260813(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.calculate_stall_capacity_legacy_20260813(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.refresh_kds_operational_alerts(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.calculate_stall_capacity(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.refresh_kds_operational_alerts(uuid, uuid)
to service_role;
grant execute on function public.calculate_stall_capacity(uuid, jsonb)
to service_role;
