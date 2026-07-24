-- KDS production stations, routing, task lifecycle, and least-privilege access.

do $$
begin
  create type public.kitchen_task_status as enum (
    'PENDING', 'PREPARING', 'COMPLETED', 'CANCELLED'
  );
exception when duplicate_object then null;
end
$$;

alter table public.stall_ordering_settings
  add column if not exists kds_warning_minutes integer not null default 5,
  add column if not exists kds_critical_minutes integer not null default 10,
  add column if not exists kds_default_view text not null default 'ORDER';

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_kds_thresholds_check,
  drop constraint if exists stall_ordering_settings_kds_default_view_check;
alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_kds_thresholds_check check (
    kds_warning_minutes between 1 and 120
    and kds_critical_minutes between 2 and 240
    and kds_critical_minutes > kds_warning_minutes
  ),
  add constraint stall_ordering_settings_kds_default_view_check check (
    kds_default_view in ('ORDER', 'ITEM', 'STATION')
  );

alter table public.orders
  add column if not exists pickup_code_display text;
alter table public.orders
  drop constraint if exists orders_pickup_code_display_check;
alter table public.orders
  add constraint orders_pickup_code_display_check check (
    pickup_code_display is null or pickup_code_display ~ '^[0-9]{3}([0-9]{3})?$'
  );

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG'
  ));

create table public.kitchen_stations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_stations_stall_code_unique unique (stall_id, code),
  constraint kitchen_stations_name_length_check check (char_length(name) between 1 and 80),
  constraint kitchen_stations_code_check check (code ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  constraint kitchen_stations_description_length_check check (
    description is null or char_length(description) between 1 and 300
  ),
  constraint kitchen_stations_sort_order_check check (sort_order between 0 and 10000),
  constraint kitchen_stations_default_active_check check (code <> 'DEFAULT' or is_active)
);
create index kitchen_stations_scope_idx
  on public.kitchen_stations (organization_id, stall_id, is_active, sort_order);

create table public.kitchen_station_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  station_id uuid not null references public.kitchen_stations(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_station_assignment_target_check check (
    num_nonnulls(category_id, product_id) = 1
  )
);
create unique index kitchen_station_assignment_product_unique
  on public.kitchen_station_assignments (stall_id, product_id)
  where product_id is not null;
create unique index kitchen_station_assignment_category_unique
  on public.kitchen_station_assignments (stall_id, category_id)
  where category_id is not null;
create index kitchen_station_assignments_scope_idx
  on public.kitchen_station_assignments (organization_id, stall_id, station_id, is_active);

create table public.order_production_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  station_id uuid not null references public.kitchen_stations(id) on delete restrict,
  status public.kitchen_task_status not null default 'PENDING',
  quantity integer not null,
  started_at timestamptz,
  completed_at timestamptz,
  assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_production_tasks_order_item_unique unique (order_item_id),
  constraint order_production_tasks_quantity_check check (quantity between 1 and 1000),
  constraint order_production_tasks_timestamps_check check (
    (status = 'PENDING' and completed_at is null)
    or (status = 'PREPARING' and started_at is not null and completed_at is null)
    or (status in ('COMPLETED', 'CANCELLED') and completed_at is not null)
  )
);
create index order_production_tasks_board_idx
  on public.order_production_tasks (stall_id, status, station_id, created_at);
create index order_production_tasks_order_idx
  on public.order_production_tasks (order_id, status, created_at);
create index order_production_tasks_assignee_idx
  on public.order_production_tasks (assigned_to_profile_id, status)
  where assigned_to_profile_id is not null;

create or replace function public.touch_kds_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger kitchen_stations_touch_before_update
before update on public.kitchen_stations
for each row execute function public.touch_kds_updated_at();
create trigger kitchen_station_assignments_touch_before_update
before update on public.kitchen_station_assignments
for each row execute function public.touch_kds_updated_at();
create trigger order_production_tasks_touch_before_update
before update on public.order_production_tasks
for each row execute function public.touch_kds_updated_at();

create or replace function public.enforce_kds_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
  v_order_id uuid;
begin
  select stall.organization_id into v_organization_id
  from public.stalls stall
  where stall.id = new.stall_id;
  if v_organization_id is null or v_organization_id <> new.organization_id then
    raise exception 'KDS_STALL_SCOPE_MISMATCH';
  end if;

  if tg_table_name = 'kitchen_station_assignments' then
    select station.organization_id, station.stall_id
      into v_organization_id, v_stall_id
    from public.kitchen_stations station
    where station.id = new.station_id;
    if v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then
      raise exception 'KDS_STATION_SCOPE_MISMATCH';
    end if;
    if new.category_id is not null and not exists (
      select 1 from public.product_categories category
      where category.id = new.category_id
        and category.organization_id = new.organization_id
    ) then
      raise exception 'KDS_CATEGORY_SCOPE_MISMATCH';
    end if;
    if new.product_id is not null and not exists (
      select 1 from public.products product
      where product.id = new.product_id
        and product.organization_id = new.organization_id
    ) then
      raise exception 'KDS_PRODUCT_SCOPE_MISMATCH';
    end if;
  elsif tg_table_name = 'order_production_tasks' then
    select orders.organization_id, orders.stall_id
      into v_organization_id, v_stall_id
    from public.orders orders
    where orders.id = new.order_id;
    if v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then
      raise exception 'KDS_ORDER_SCOPE_MISMATCH';
    end if;

    select item.order_id, item.organization_id, item.stall_id
      into v_order_id, v_organization_id, v_stall_id
    from public.order_items item
    where item.id = new.order_item_id;
    if v_order_id <> new.order_id
       or v_organization_id <> new.organization_id
       or v_stall_id <> new.stall_id then
      raise exception 'KDS_ORDER_ITEM_SCOPE_MISMATCH';
    end if;

    if not exists (
      select 1 from public.kitchen_stations station
      where station.id = new.station_id
        and station.organization_id = new.organization_id
        and station.stall_id = new.stall_id
    ) then
      raise exception 'KDS_TASK_STATION_SCOPE_MISMATCH';
    end if;

    if new.assigned_to_profile_id is not null and not exists (
      select 1
      from public.profiles profile
      where profile.id = new.assigned_to_profile_id
        and profile.is_active
        and (
          exists (
            select 1 from public.organization_memberships membership
            where membership.organization_id = new.organization_id
              and membership.profile_id = profile.id
              and membership.is_active
              and (
                membership.role = 'ORGANIZATION_OWNER'::public.user_role
                or membership.all_stalls
                or exists (
                  select 1 from public.stall_memberships stall_membership
                  where stall_membership.stall_id = new.stall_id
                    and stall_membership.profile_id = profile.id
                    and stall_membership.is_active
                )
              )
          )
          or exists (
            select 1 from public.stall_memberships membership
            where membership.stall_id = new.stall_id
              and membership.profile_id = profile.id
              and membership.is_active
          )
        )
    ) then
      raise exception 'KDS_ASSIGNEE_SCOPE_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_default_kitchen_station_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and old.code = 'DEFAULT'
     and exists (
       select 1
       from public.stalls stall
       where stall.id = old.stall_id
     ) then
    raise exception 'DEFAULT_KITCHEN_STATION_REQUIRED';
  end if;
  if tg_op = 'UPDATE'
     and old.code = 'DEFAULT'
     and (new.code <> 'DEFAULT' or not new.is_active) then
    raise exception 'DEFAULT_KITCHEN_STATION_REQUIRED';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger kitchen_stations_scope_before_write
before insert or update on public.kitchen_stations
for each row execute function public.enforce_kds_scope();
create trigger kitchen_stations_protect_default_before_write
before update or delete on public.kitchen_stations
for each row execute function public.prevent_default_kitchen_station_delete();
create trigger kitchen_station_assignments_scope_before_write
before insert or update on public.kitchen_station_assignments
for each row execute function public.enforce_kds_scope();
create trigger order_production_tasks_scope_before_write
before insert or update on public.order_production_tasks
for each row execute function public.enforce_kds_scope();

create or replace function public.create_default_kitchen_station()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kitchen_stations (
    organization_id, stall_id, name, code, description, sort_order
  ) values (
    new.organization_id, new.id, '綜合工作站', 'DEFAULT',
    '尚未分派工作站的品項會送至此處。', 0
  ) on conflict (stall_id, code) do nothing;
  return null;
end;
$$;

create trigger stalls_create_default_kitchen_station
after insert on public.stalls
for each row execute function public.create_default_kitchen_station();

insert into public.kitchen_stations (
  organization_id, stall_id, name, code, description, sort_order
)
select stall.organization_id, stall.id, '綜合工作站', 'DEFAULT',
  '尚未分派工作站的品項會送至此處。', 0
from public.stalls stall
on conflict (stall_id, code) do nothing;

create or replace function public.create_kds_tasks_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
begin
  with routed_items as (
    select
      item.organization_id,
      item.stall_id,
      item.order_id,
      item.id as order_item_id,
      item.quantity,
      case item.status
        when 'PENDING'::public.order_item_status
          then 'PENDING'::public.kitchen_task_status
        when 'PREPARING'::public.order_item_status
          then 'PREPARING'::public.kitchen_task_status
        else 'COMPLETED'::public.kitchen_task_status
      end as task_status,
      case
        when item.status = 'PENDING'::public.order_item_status then null
        else coalesce(item.preparing_at, item.ready_at, item.served_at, now())
      end as task_started_at,
      case
        when item.status in (
          'READY'::public.order_item_status,
          'SERVED'::public.order_item_status
        ) then coalesce(item.ready_at, item.served_at, now())
        else null
      end as task_completed_at,
      chosen_station.id as station_id
    from public.order_items item
    join public.orders orders on orders.id = item.order_id
    left join public.products product on product.id = item.product_id
    cross join lateral (
      select station.id
      from public.kitchen_stations station
      left join public.kitchen_station_assignments assignment
        on assignment.station_id = station.id
       and assignment.stall_id = item.stall_id
       and assignment.is_active
      where station.stall_id = item.stall_id
        and station.organization_id = item.organization_id
        and station.is_active
      order by case
        when assignment.product_id = item.product_id then 0
        when assignment.category_id = product.category_id then 1
        when station.code = 'DEFAULT' then 2
        else 3
      end, station.sort_order, station.created_at
      limit 1
    ) chosen_station
    where item.order_id = p_order_id
      and orders.status in (
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status,
        'READY'::public.order_status
      )
  ), inserted as (
    insert into public.order_production_tasks (
      organization_id, stall_id, order_id, order_item_id, station_id,
      status, quantity, started_at, completed_at, created_at, updated_at
    )
    select organization_id, stall_id, order_id, order_item_id, station_id,
      task_status, quantity, task_started_at, task_completed_at, now(), now()
    from routed_items
    on conflict (order_item_id) do nothing
    returning id, organization_id, stall_id, order_id
  ), events as (
    insert into public.order_events (
      id, organization_id, stall_id, order_id, event_type, created_at
    )
    select gen_random_uuid(), organization_id, stall_id, order_id, 'PRODUCTION_TASK_CREATED', now()
    from inserted
    returning 1
  )
  select count(*) into v_created from events;

  return v_created;
end;
$$;

create or replace function public.route_confirmed_order_to_kds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED'::public.order_status
     and old.status is distinct from new.status then
    perform public.create_kds_tasks_for_order(new.id);
  end if;

  if new.status = 'CANCELLED'::public.order_status
     and old.status is distinct from new.status then
    update public.order_production_tasks task
    set status = 'CANCELLED'::public.kitchen_task_status,
        completed_at = coalesce(task.completed_at, now()),
        updated_at = now()
    where task.order_id = new.id
      and task.status in (
        'PENDING'::public.kitchen_task_status,
        'PREPARING'::public.kitchen_task_status
      );
    if found then
      insert into public.order_events (
        id, organization_id, stall_id, order_id, event_type,
        previous_status, new_status, created_at
      ) values (
        gen_random_uuid(), new.organization_id, new.stall_id, new.id,
        'PRODUCTION_TASK_UPDATED', old.status, new.status, now()
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger orders_route_to_kds_after_status
after update of status on public.orders
for each row execute function public.route_confirmed_order_to_kds();

create or replace function public.route_new_order_item_to_kds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.orders orders
    where orders.id = new.order_id
      and orders.status in (
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status,
        'READY'::public.order_status
      )
  ) then
    perform public.create_kds_tasks_for_order(new.order_id);
  end if;
  return null;
end;
$$;

create trigger order_items_route_to_kds_after_insert
after insert on public.order_items
for each row execute function public.route_new_order_item_to_kds();

create or replace function public.sync_kds_task_from_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.kitchen_task_status;
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  v_status := case
    when new.status = 'PENDING'::public.order_item_status
      then 'PENDING'::public.kitchen_task_status
    when new.status = 'PREPARING'::public.order_item_status
      then 'PREPARING'::public.kitchen_task_status
    else 'COMPLETED'::public.kitchen_task_status
  end;

  update public.order_production_tasks task
  set status = v_status,
      started_at = case
        when v_status = 'PENDING' then null
        else coalesce(task.started_at, new.preparing_at, now())
      end,
      completed_at = case
        when v_status = 'COMPLETED' then coalesce(new.ready_at, new.served_at, now())
        else null
      end,
      updated_at = now()
  where task.order_item_id = new.id
    and task.status <> 'CANCELLED'::public.kitchen_task_status
    and task.status is distinct from v_status;

  if found then
    insert into public.order_events (
      id, organization_id, stall_id, order_id, event_type, created_at
    ) values (
      gen_random_uuid(), new.organization_id, new.stall_id, new.order_id,
      'PRODUCTION_TASK_UPDATED', now()
    );
  end if;
  return null;
end;
$$;

create trigger order_items_sync_kds_task_after_status
after update of status on public.order_items
for each row execute function public.sync_kds_task_from_order_item();

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
            and coalesce(orders.confirmed_at, orders.created_at)
              <= now() - make_interval(mins => v_critical_minutes)
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
      and coalesce(orders.confirmed_at, orders.created_at)
        <= now() - make_interval(mins => v_critical_minutes)
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

select public.create_kds_tasks_for_order(orders.id)
from public.orders orders
where orders.status in (
  'CONFIRMED'::public.order_status,
  'PREPARING'::public.order_status,
  'PACKING'::public.order_status,
  'READY'::public.order_status
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'kitchen_stations',
    'kitchen_station_assignments',
    'order_production_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
  end loop;
end
$$;

create policy kitchen_stations_authorized_select on public.kitchen_stations
for select to authenticated using (public.can_view_orders(stall_id));
create policy kitchen_station_assignments_authorized_select on public.kitchen_station_assignments
for select to authenticated using (public.can_view_orders(stall_id));
create policy order_production_tasks_authorized_select on public.order_production_tasks
for select to authenticated using (public.can_view_orders(stall_id));

-- The Data API exposes only kitchen-safe order columns. Financial values remain
-- available through trusted server routes after role and stall authorization.
revoke select on public.orders from authenticated;
grant select (
  id, organization_id, stall_id, order_no, source, customer_name,
  table_label, fulfillment_type, note, status, pickup_code_display,
  pickup_verified_at, confirmation_expires_at, confirmed_at, expired_at,
  completed_at, created_at, updated_at
) on public.orders to authenticated;

revoke all on function public.enforce_kds_scope() from public, anon, authenticated;
revoke all on function public.touch_kds_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_default_kitchen_station_delete() from public, anon, authenticated;
revoke all on function public.create_default_kitchen_station() from public, anon, authenticated;
revoke all on function public.create_kds_tasks_for_order(uuid) from public, anon, authenticated;
revoke all on function public.route_confirmed_order_to_kds() from public, anon, authenticated;
revoke all on function public.route_new_order_item_to_kds() from public, anon, authenticated;
revoke all on function public.sync_kds_task_from_order_item() from public, anon, authenticated;
revoke all on function public.refresh_kds_operational_alerts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enforce_kds_scope() to service_role;
grant execute on function public.touch_kds_updated_at() to service_role;
grant execute on function public.prevent_default_kitchen_station_delete() to service_role;
grant execute on function public.create_default_kitchen_station() to service_role;
grant execute on function public.create_kds_tasks_for_order(uuid) to service_role;
grant execute on function public.route_confirmed_order_to_kds() to service_role;
grant execute on function public.route_new_order_item_to_kds() to service_role;
grant execute on function public.sync_kds_task_from_order_item() to service_role;
grant execute on function public.refresh_kds_operational_alerts(uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_production_tasks'
  ) then
    alter publication supabase_realtime add table public.order_production_tasks;
  end if;
end
$$;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, 'KDS', true,
  case plan.code
    when 'TRIAL' then 1
    when 'LITE' then 1
    when 'STANDARD' then 3
    when 'PRO' then 10
    else null
  end,
  jsonb_build_object('maxStations', case plan.code
    when 'TRIAL' then 1
    when 'LITE' then 1
    when 'STANDARD' then 3
    when 'PRO' then 10
    else 100
  end)
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
where plan.code in ('TRIAL', 'LITE', 'STANDARD', 'PRO', 'ENTERPRISE')
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();
