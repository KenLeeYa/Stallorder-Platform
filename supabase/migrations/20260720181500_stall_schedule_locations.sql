-- Mobile-stall locations, market events, trusted QR schedule context, and
-- idempotent automatic ordering windows.

do $$
begin
  create type public.stall_schedule_status as enum (
    'SCHEDULED', 'OPEN', 'DELAYED', 'CANCELLED', 'COMPLETED'
  );
exception when duplicate_object then null;
end
$$;

create table public.stall_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  name text not null,
  address text not null,
  latitude numeric(9, 6),
  longitude numeric(10, 6),
  map_url text,
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_locations_name_length_check check (char_length(name) between 1 and 100),
  constraint stall_locations_address_length_check check (char_length(address) between 1 and 300),
  constraint stall_locations_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint stall_locations_longitude_check check (longitude is null or longitude between -180 and 180),
  constraint stall_locations_coordinates_pair_check check ((latitude is null) = (longitude is null)),
  constraint stall_locations_map_url_check check (
    map_url is null or (char_length(map_url) <= 500 and map_url ~ '^https://')
  ),
  constraint stall_locations_instructions_length_check check (
    instructions is null or char_length(instructions) <= 500
  ),
  unique (stall_id, name)
);

create table public.market_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  venue_name text not null,
  address text not null,
  latitude numeric(9, 6),
  longitude numeric(10, 6),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  organizer text,
  public_url text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_events_name_length_check check (char_length(name) between 1 and 150),
  constraint market_events_slug_check check (
    char_length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint market_events_description_length_check check (
    description is null or char_length(description) <= 1000
  ),
  constraint market_events_venue_length_check check (char_length(venue_name) between 1 and 150),
  constraint market_events_address_length_check check (char_length(address) between 1 and 300),
  constraint market_events_latitude_check check (latitude is null or latitude between -90 and 90),
  constraint market_events_longitude_check check (longitude is null or longitude between -180 and 180),
  constraint market_events_coordinates_pair_check check ((latitude is null) = (longitude is null)),
  constraint market_events_time_check check (ends_at > starts_at),
  constraint market_events_organizer_length_check check (
    organizer is null or char_length(organizer) <= 150
  ),
  constraint market_events_public_url_check check (
    public_url is null or (char_length(public_url) <= 500 and public_url ~ '^https://')
  ),
  unique (organization_id, slug)
);

create table public.stall_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  location_id uuid references public.stall_locations(id) on delete restrict,
  market_event_id uuid references public.market_events(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  ordering_opens_at timestamptz,
  ordering_closes_at timestamptz,
  status public.stall_schedule_status not null default 'SCHEDULED',
  special_notice text,
  menu_override_id uuid,
  auto_open_enabled boolean not null default false,
  auto_close_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_schedules_context_check check (
    location_id is not null or market_event_id is not null
  ),
  constraint stall_schedules_time_check check (ends_at > starts_at),
  constraint stall_schedules_ordering_window_check check (
    coalesce(ordering_closes_at, ends_at) > coalesce(ordering_opens_at, starts_at)
  ),
  constraint stall_schedules_notice_length_check check (
    special_notice is null or char_length(special_notice) <= 500
  )
);

create index stall_locations_scope_idx
  on public.stall_locations (organization_id, stall_id, is_active, name);
create index market_events_window_idx
  on public.market_events (organization_id, starts_at, ends_at);
create index stall_schedules_stall_window_idx
  on public.stall_schedules (organization_id, stall_id, starts_at, ends_at);
create index stall_schedules_automation_idx
  on public.stall_schedules (status, ordering_opens_at, ordering_closes_at)
  where status in ('SCHEDULED', 'OPEN', 'DELAYED');
create index stall_schedules_event_idx
  on public.stall_schedules (market_event_id, starts_at)
  where market_event_id is not null;

alter table public.qr_codes
  add column location_id uuid references public.stall_locations(id) on delete restrict,
  add column market_event_id uuid references public.market_events(id) on delete restrict,
  add column stall_schedule_id uuid references public.stall_schedules(id) on delete restrict,
  add column fulfillment_type_context public.fulfillment_type;

alter table public.order_sessions
  add column location_id uuid references public.stall_locations(id) on delete restrict,
  add column market_event_id uuid references public.market_events(id) on delete restrict,
  add column stall_schedule_id uuid references public.stall_schedules(id) on delete restrict,
  add column fulfillment_type_context public.fulfillment_type;

alter table public.orders
  add column location_id uuid references public.stall_locations(id) on delete restrict,
  add column market_event_id uuid references public.market_events(id) on delete restrict,
  add column stall_schedule_id uuid references public.stall_schedules(id) on delete restrict;

create index qr_codes_schedule_state_idx
  on public.qr_codes (stall_schedule_id, state)
  where stall_schedule_id is not null;
create index qr_codes_location_state_idx
  on public.qr_codes (location_id, state)
  where location_id is not null;
create index qr_codes_event_state_idx
  on public.qr_codes (market_event_id, state)
  where market_event_id is not null;
create index order_sessions_schedule_status_idx
  on public.order_sessions (stall_schedule_id, status, expires_at)
  where stall_schedule_id is not null;
create index orders_schedule_created_idx
  on public.orders (stall_schedule_id, created_at desc)
  where stall_schedule_id is not null;
create index orders_location_created_idx
  on public.orders (location_id, created_at desc)
  where location_id is not null;

create or replace function public.touch_stall_schedule_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_stall_schedule_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_location public.stall_locations%rowtype;
  v_event public.market_events%rowtype;
begin
  if new.location_id is not null then
    select * into v_location from public.stall_locations where id = new.location_id;
    if not found or v_location.organization_id <> new.organization_id
       or v_location.stall_id <> new.stall_id then
      raise exception 'STALL_SCHEDULE_LOCATION_SCOPE_MISMATCH';
    end if;
  end if;

  if new.market_event_id is not null then
    select * into v_event from public.market_events where id = new.market_event_id;
    if not found or v_event.organization_id <> new.organization_id then
      raise exception 'STALL_SCHEDULE_EVENT_SCOPE_MISMATCH';
    end if;
    if new.starts_at < v_event.starts_at - interval '30 days'
       or new.ends_at > v_event.ends_at + interval '30 days' then
      raise exception 'STALL_SCHEDULE_EVENT_WINDOW_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_market_event_scope_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'MARKET_EVENT_ORGANIZATION_IMMUTABLE';
  end if;
  if exists (
    select 1
    from public.stall_schedules schedule
    where schedule.market_event_id = old.id
      and (
        schedule.starts_at < new.starts_at - interval '30 days'
        or schedule.ends_at > new.ends_at + interval '30 days'
      )
  ) then
    raise exception 'MARKET_EVENT_SCHEDULE_WINDOW_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_ordering_context_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_location public.stall_locations%rowtype;
  v_event public.market_events%rowtype;
  v_schedule public.stall_schedules%rowtype;
begin
  if new.location_id is not null then
    select * into v_location from public.stall_locations where id = new.location_id;
    if not found or v_location.organization_id <> new.organization_id
       or v_location.stall_id <> new.stall_id then
      raise exception 'ORDERING_LOCATION_SCOPE_MISMATCH';
    end if;
  end if;

  if new.market_event_id is not null then
    select * into v_event from public.market_events where id = new.market_event_id;
    if not found or v_event.organization_id <> new.organization_id then
      raise exception 'ORDERING_EVENT_SCOPE_MISMATCH';
    end if;
  end if;

  if new.stall_schedule_id is not null then
    select * into v_schedule from public.stall_schedules where id = new.stall_schedule_id;
    if not found or v_schedule.organization_id <> new.organization_id
       or v_schedule.stall_id <> new.stall_id
       or v_schedule.location_id is distinct from new.location_id
       or v_schedule.market_event_id is distinct from new.market_event_id then
      raise exception 'ORDERING_SCHEDULE_SCOPE_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_qr_schedule_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fulfillment_type_context = 'DINE_IN'::public.fulfillment_type
     and new.dining_table_id is null then
    raise exception 'DINE_IN_QR_REQUIRES_TABLE';
  end if;
  if new.dining_table_id is not null
     and new.fulfillment_type_context is not null
     and new.fulfillment_type_context <> 'DINE_IN'::public.fulfillment_type then
    raise exception 'TABLE_QR_ORDER_TYPE_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_order_session_schedule_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_qr public.qr_codes%rowtype;
begin
  if new.location_id is null and new.market_event_id is null
     and new.stall_schedule_id is null and new.fulfillment_type_context is null then
    return new;
  end if;
  select * into v_qr from public.qr_codes where id = new.qr_code_id;
  if not found
     or v_qr.location_id is distinct from new.location_id
     or v_qr.market_event_id is distinct from new.market_event_id
     or v_qr.stall_schedule_id is distinct from new.stall_schedule_id
     or v_qr.fulfillment_type_context is distinct from new.fulfillment_type_context then
    raise exception 'ORDER_SESSION_QR_CONTEXT_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_order_schedule_fulfillment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_context public.fulfillment_type;
begin
  if new.stall_schedule_id is null then return new; end if;
  select session.fulfillment_type_context into v_context
  from public.order_sessions session where session.order_id = new.id;
  if v_context is not null and new.fulfillment_type is distinct from v_context then
    raise exception 'ORDER_FULFILLMENT_CONTEXT_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger stall_locations_10_derive_scope
before insert or update on public.stall_locations
for each row execute function public.derive_stall_organization_scope();
create trigger stall_locations_20_touch
before update on public.stall_locations
for each row execute function public.touch_stall_schedule_updated_at();
create trigger market_events_touch
before update on public.market_events
for each row execute function public.touch_stall_schedule_updated_at();
create trigger market_events_validate_scope
before update of organization_id, starts_at, ends_at on public.market_events
for each row execute function public.enforce_market_event_scope_update();
create trigger stall_schedules_10_derive_scope
before insert or update on public.stall_schedules
for each row execute function public.derive_stall_organization_scope();
create trigger stall_schedules_20_validate_scope
before insert or update on public.stall_schedules
for each row execute function public.enforce_stall_schedule_scope();
create trigger stall_schedules_30_touch
before update on public.stall_schedules
for each row execute function public.touch_stall_schedule_updated_at();
create trigger qr_codes_schedule_context_before_write
before insert or update of location_id, market_event_id, stall_schedule_id,
  fulfillment_type_context, dining_table_id on public.qr_codes
for each row execute function public.enforce_ordering_context_scope();
create trigger qr_codes_schedule_type_before_write
before insert or update of fulfillment_type_context, dining_table_id on public.qr_codes
for each row execute function public.enforce_qr_schedule_type();
create trigger order_sessions_schedule_context_before_write
before insert or update of location_id, market_event_id, stall_schedule_id,
  fulfillment_type_context on public.order_sessions
for each row execute function public.enforce_ordering_context_scope();
create trigger order_sessions_schedule_type_before_write
before insert or update of location_id, market_event_id, stall_schedule_id,
  fulfillment_type_context on public.order_sessions
for each row execute function public.enforce_order_session_schedule_context();
create trigger orders_schedule_context_before_write
before insert or update of location_id, market_event_id, stall_schedule_id,
  fulfillment_type on public.orders
for each row execute function public.enforce_ordering_context_scope();
create trigger orders_schedule_fulfillment_before_write
before insert or update of location_id, market_event_id, stall_schedule_id,
  fulfillment_type on public.orders
for each row execute function public.enforce_order_schedule_fulfillment();

create or replace function public.validate_ordering_schedule_context(
  p_qr_code_id uuid,
  p_ordering_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_location public.stall_locations%rowtype;
  v_event public.market_events%rowtype;
  v_schedule public.stall_schedules%rowtype;
  v_now timestamptz := now();
begin
  select * into v_qr from public.qr_codes where id = p_qr_code_id;
  if not found then return 'QR_NOT_FOUND'; end if;

  if v_qr.fulfillment_type_context = 'DELIVERY'::public.fulfillment_type
     and p_ordering_mode <> 'DELIVERY' then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if v_qr.fulfillment_type_context in (
       'TAKEOUT'::public.fulfillment_type,
       'DINE_IN'::public.fulfillment_type
     ) and p_ordering_mode <> 'DEFAULT' then
    return 'ORDER_MODE_CONFLICT';
  end if;

  if v_qr.location_id is not null then
    select * into v_location from public.stall_locations where id = v_qr.location_id;
    if not found or not v_location.is_active then return 'LOCATION_UNAVAILABLE'; end if;
  end if;

  if v_qr.stall_schedule_id is not null then
    select * into v_schedule from public.stall_schedules
    where id = v_qr.stall_schedule_id;
    if not found or v_schedule.organization_id <> v_qr.organization_id
       or v_schedule.stall_id <> v_qr.stall_id
       or v_schedule.location_id is distinct from v_qr.location_id
       or v_schedule.market_event_id is distinct from v_qr.market_event_id then
      return 'SCHEDULE_CONTEXT_MISMATCH';
    end if;
    if v_schedule.status in (
      'CANCELLED'::public.stall_schedule_status,
      'COMPLETED'::public.stall_schedule_status
    ) or coalesce(v_schedule.ordering_closes_at, v_schedule.ends_at) <= v_now then
      return 'SCHEDULE_CLOSED';
    end if;
    if v_schedule.status <> 'OPEN'::public.stall_schedule_status
       or coalesce(v_schedule.ordering_opens_at, v_schedule.starts_at) > v_now then
      return 'SCHEDULE_NOT_ACTIVE';
    end if;
  end if;

  if v_qr.market_event_id is not null then
    select * into v_event from public.market_events where id = v_qr.market_event_id;
    if not found or v_event.organization_id <> v_qr.organization_id then
      return 'EVENT_NOT_ACTIVE';
    end if;
    if v_event.ends_at <= v_now then return 'EVENT_EXPIRED'; end if;
    if v_qr.stall_schedule_id is null and v_event.starts_at > v_now then
      return 'EVENT_NOT_ACTIVE';
    end if;
  end if;

  return null;
end;
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.process_stall_schedules(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.stall_schedules%rowtype;
  v_opened integer := 0;
  v_closed integer := 0;
  v_missed integer := 0;
begin
  for v_schedule in
    select schedule.*
    from public.stall_schedules schedule
    where schedule.status = 'SCHEDULED'::public.stall_schedule_status
      and schedule.auto_open_enabled
      and coalesce(schedule.ordering_opens_at, schedule.starts_at) <= p_now
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) > p_now
    order by coalesce(schedule.ordering_opens_at, schedule.starts_at), schedule.id
    for update skip locked
  loop
    update public.stall_schedules
    set status = 'OPEN'::public.stall_schedule_status, updated_at = p_now
    where id = v_schedule.id
      and status = 'SCHEDULED'::public.stall_schedule_status;
    if found then
      update public.stalls stall
      set business_status = 'OPEN'::public.stall_business_status,
          ordering_enabled = true,
          ordering_state = 'OPEN'::public.stall_ordering_state,
          updated_at = p_now
      where stall.id = v_schedule.stall_id
        and stall.organization_id = v_schedule.organization_id
        and stall.is_active
        and not stall.is_sold_out
        and not exists (
          select 1 from public.stall_capacity_settings settings
          where settings.stall_id = stall.id
            and settings.pause_source = 'MANUAL'
        );

      insert into public.audit_logs (
        id, organization_id, stall_id, actor_profile_id, action, entity_type,
        entity_id, outcome, request_id, metadata
      ) values (
        gen_random_uuid(), v_schedule.organization_id, v_schedule.stall_id, null,
        'STALL_SCHEDULE_AUTOMATIC_OPENED', 'STALL_SCHEDULE', v_schedule.id,
        'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
        jsonb_build_object('processedAt', p_now)::text
      );
      v_opened := v_opened + 1;
    end if;
  end loop;

  for v_schedule in
    select schedule.*
    from public.stall_schedules schedule
    where schedule.status = 'OPEN'::public.stall_schedule_status
      and schedule.auto_close_enabled
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) <= p_now
    order by coalesce(schedule.ordering_closes_at, schedule.ends_at), schedule.id
    for update skip locked
  loop
    update public.stall_schedules
    set status = 'COMPLETED'::public.stall_schedule_status, updated_at = p_now
    where id = v_schedule.id
      and status = 'OPEN'::public.stall_schedule_status;
    if found then
      if not exists (
        select 1 from public.stall_schedules other
        where other.stall_id = v_schedule.stall_id
          and other.id <> v_schedule.id
          and other.status = 'OPEN'::public.stall_schedule_status
          and coalesce(other.ordering_opens_at, other.starts_at) <= p_now
          and coalesce(other.ordering_closes_at, other.ends_at) > p_now
      ) then
        update public.stalls
        set ordering_state = 'CLOSED'::public.stall_ordering_state,
            updated_at = p_now
        where id = v_schedule.stall_id
          and organization_id = v_schedule.organization_id;
        update public.order_sessions
        set status = 'REVOKED'::public.order_session_status,
            revoked_at = coalesce(revoked_at, p_now)
        where stall_id = v_schedule.stall_id
          and status = 'ACTIVE'::public.order_session_status;
      end if;

      insert into public.audit_logs (
        id, organization_id, stall_id, actor_profile_id, action, entity_type,
        entity_id, outcome, request_id, metadata
      ) values (
        gen_random_uuid(), v_schedule.organization_id, v_schedule.stall_id, null,
        'STALL_SCHEDULE_AUTOMATIC_CLOSED', 'STALL_SCHEDULE', v_schedule.id,
        'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
        jsonb_build_object('processedAt', p_now)::text
      );
      v_closed := v_closed + 1;
    end if;
  end loop;

  for v_schedule in
    select schedule.*
    from public.stall_schedules schedule
    where schedule.status = 'SCHEDULED'::public.stall_schedule_status
      and schedule.auto_close_enabled
      and coalesce(schedule.ordering_closes_at, schedule.ends_at) <= p_now
    order by coalesce(schedule.ordering_closes_at, schedule.ends_at), schedule.id
    for update skip locked
  loop
    update public.stall_schedules
    set status = 'COMPLETED'::public.stall_schedule_status, updated_at = p_now
    where id = v_schedule.id
      and status = 'SCHEDULED'::public.stall_schedule_status;
    if found then
      insert into public.audit_logs (
        id, organization_id, stall_id, actor_profile_id, action, entity_type,
        entity_id, outcome, request_id, metadata
      ) values (
        gen_random_uuid(), v_schedule.organization_id, v_schedule.stall_id, null,
        'STALL_SCHEDULE_AUTOMATIC_MISSED', 'STALL_SCHEDULE', v_schedule.id,
        'SUCCESS'::public.audit_outcome, 'schedule:' || gen_random_uuid()::text,
        jsonb_build_object('processedAt', p_now)::text
      );
      v_missed := v_missed + 1;
    end if;
  end loop;

  update public.operational_alerts alert
  set status = 'RESOLVED', resolved_at = p_now, updated_at = p_now
  where alert.alert_type = 'SCHEDULE_START_DELAYED'
    and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    and not exists (
      select 1 from public.stall_schedules schedule
      where schedule.stall_id = alert.stall_id
        and schedule.status = 'DELAYED'::public.stall_schedule_status
    );

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select schedule.organization_id, schedule.stall_id,
    'SCHEDULE_START_DELAYED', 'WARNING',
    '出攤行程已標記延遲，請確認實際開攤與接單狀態。'
  from public.stall_schedules schedule
  where schedule.status = 'DELAYED'::public.stall_schedule_status
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = schedule.stall_id
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

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED', 'CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED',
    'CASH_SHIFT_NOT_CLOSED', 'CASH_OVER_SHORT', 'SCHEDULE_START_DELAYED'
  ));

alter table public.stall_locations enable row level security;
alter table public.stall_locations force row level security;
alter table public.market_events enable row level security;
alter table public.market_events force row level security;
alter table public.stall_schedules enable row level security;
alter table public.stall_schedules force row level security;

revoke all on table public.stall_locations from public, anon, authenticated;
revoke all on table public.market_events from public, anon, authenticated;
revoke all on table public.stall_schedules from public, anon, authenticated;
grant select on table public.stall_locations to authenticated;
grant select on table public.market_events to authenticated;
grant select on table public.stall_schedules to authenticated;
grant select, insert, update, delete on table public.stall_locations to service_role;
grant select, insert, update, delete on table public.market_events to service_role;
grant select, insert, update, delete on table public.stall_schedules to service_role;

create policy stall_locations_authorized_select on public.stall_locations
for select to authenticated
using (public.has_stall_role(
  stall_id, array['STALL_MANAGER', 'STAFF']::public.user_role[]
));
create policy stall_schedules_authorized_select on public.stall_schedules
for select to authenticated
using (public.has_stall_role(
  stall_id, array['STALL_MANAGER', 'STAFF']::public.user_role[]
));
create policy market_events_organization_admin_select on public.market_events
for select to authenticated
using (public.has_organization_role(
  organization_id,
  array['ORGANIZATION_OWNER', 'ORGANIZATION_ADMIN']::public.user_role[]
));

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, feature.feature_code, true, feature.limit_value,
  feature.configuration_json
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
cross join lateral (
  values
    ('STALL_LOCATION'::text,
      case
        when plan.code = 'LITE' then 1
        when plan.code in ('TRIAL', 'STANDARD') then 10
        else 100
      end,
      jsonb_build_object(
        'multipleLocations', plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE')
      )),
    ('STALL_SCHEDULE'::text,
      case when plan.code = 'LITE' then 30 else 365 end,
      jsonb_build_object(
        'recurringCopy', plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE'),
        'automaticOrdering', plan.code in ('TRIAL', 'STANDARD', 'PRO', 'ENTERPRISE'),
        'eventSchedule', plan.code in ('PRO', 'ENTERPRISE')
      ))
) feature(feature_code, limit_value, configuration_json)
where plan.code in ('TRIAL', 'LITE', 'STANDARD', 'PRO', 'ENTERPRISE')
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'stallorder-stall-schedules') then
    perform cron.schedule(
      'stallorder-stall-schedules',
      '* * * * *',
      'select app_private.process_stall_schedules()'
    );
  end if;
end
$$;

revoke all on function public.touch_stall_schedule_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_stall_schedule_scope() from public, anon, authenticated;
revoke all on function public.enforce_market_event_scope_update() from public, anon, authenticated;
revoke all on function public.enforce_ordering_context_scope() from public, anon, authenticated;
revoke all on function public.enforce_qr_schedule_type() from public, anon, authenticated;
revoke all on function public.enforce_order_session_schedule_context() from public, anon, authenticated;
revoke all on function public.enforce_order_schedule_fulfillment() from public, anon, authenticated;
revoke all on function public.validate_ordering_schedule_context(uuid, text) from public, anon, authenticated;
revoke all on function app_private.process_stall_schedules(timestamptz) from public, anon, authenticated;
grant execute on function public.validate_ordering_schedule_context(uuid, text) to service_role;
grant execute on function app_private.process_stall_schedules(timestamptz) to service_role;

create or replace function public.issue_order_session_with_schedule(
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
  v_qr_found boolean := false;
begin
  perform app_private.process_stall_schedules(now());
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

  v_result := public.issue_order_session_with_capacity(
    p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
    p_qr_token_hash, p_behavior_hash, p_request_id
  );
  if coalesce((v_result->>'ok')::boolean, false) and v_qr_found then
    v_session_id := (v_result->>'order_session_id')::uuid;
    update public.order_sessions
    set location_id = v_qr.location_id,
        market_event_id = v_qr.market_event_id,
        stall_schedule_id = v_qr.stall_schedule_id,
        fulfillment_type_context = v_qr.fulfillment_type_context
    where id = v_session_id
      and qr_code_id = v_qr.id
      and status = 'ACTIVE'::public.order_session_status;
  end if;
  return v_result;
end;
$$;

create or replace function public.create_public_order_with_schedule(
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
    perform app_private.process_stall_schedules(now());
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

create or replace function public.create_public_delivery_order_with_schedule(
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
    perform app_private.process_stall_schedules(now());
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

revoke all on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_public_order_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.create_public_delivery_order_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.create_public_order_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) to service_role;
grant execute on function public.create_public_delivery_order_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  text, text, jsonb, text, text, text, boolean
) to service_role;
