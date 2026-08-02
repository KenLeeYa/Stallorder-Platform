-- Staff-only fulfillment controls, trusted takeaway preorder slots, and a
-- server-authoritative daily lottery that reuses existing checkout discounts.

alter table public.stall_ordering_settings
  add column if not exists staff_delivery_enabled boolean not null default false,
  add column if not exists takeout_preorder_enabled boolean not null default false,
  add column if not exists preorder_min_lead_minutes smallint not null default 60,
  add column if not exists preorder_max_days smallint not null default 7,
  add column if not exists preorder_slot_minutes smallint not null default 30,
  add column if not exists lottery_enabled boolean not null default false,
  add column if not exists lottery_discount_option_id uuid,
  add column if not exists lottery_discount_win_rate_bps smallint not null default 0;

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_preorder_min_lead_check,
  add constraint stall_ordering_settings_preorder_min_lead_check
    check (preorder_min_lead_minutes between 15 and 1440),
  drop constraint if exists stall_ordering_settings_preorder_max_days_check,
  add constraint stall_ordering_settings_preorder_max_days_check
    check (preorder_max_days between 1 and 30),
  drop constraint if exists stall_ordering_settings_preorder_slot_check,
  add constraint stall_ordering_settings_preorder_slot_check
    check (preorder_slot_minutes in (15, 30, 60, 120)),
  drop constraint if exists stall_ordering_settings_lottery_win_rate_check,
  add constraint stall_ordering_settings_lottery_win_rate_check
    check (lottery_discount_win_rate_bps between 0 and 10000),
  drop constraint if exists stall_ordering_settings_lottery_discount_fkey,
  add constraint stall_ordering_settings_lottery_discount_fkey
    foreign key (lottery_discount_option_id)
    references public.discount_options(id) on delete set null;

create or replace function public.enforce_lottery_discount_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lottery_discount_option_id is not null and not exists (
    select 1
    from public.discount_options discount
    where discount.id = new.lottery_discount_option_id
      and discount.organization_id = new.organization_id
      and discount.stall_id = new.stall_id
  ) then
    raise exception 'LOTTERY_DISCOUNT_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists stall_ordering_settings_lottery_scope_before_write
  on public.stall_ordering_settings;
create trigger stall_ordering_settings_lottery_scope_before_write
before insert or update of lottery_discount_option_id, organization_id, stall_id
on public.stall_ordering_settings
for each row execute function public.enforce_lottery_discount_scope();

alter table public.order_sessions
  drop constraint if exists order_sessions_ordering_mode_check;
alter table public.order_sessions
  add constraint order_sessions_ordering_mode_check
  check (ordering_mode in ('DEFAULT', 'DELIVERY', 'PREORDER'));
alter table public.order_sessions
  add column if not exists requested_fulfillment_at timestamptz;

alter table public.orders
  add column if not exists discount_source text not null default 'NONE',
  add column if not exists lottery_draw_id uuid;

alter table public.order_items
  add column if not exists source_line_index smallint;
alter table public.order_items
  drop constraint if exists order_items_source_line_index_check,
  add constraint order_items_source_line_index_check
    check (source_line_index is null or source_line_index between 1 and 100);
create unique index if not exists order_items_order_source_line_unique
  on public.order_items (order_id, source_line_index)
  where source_line_index is not null;

alter table public.orders
  drop constraint if exists orders_discount_source_check,
  add constraint orders_discount_source_check
    check (discount_source in ('NONE', 'STAFF', 'LOTTERY'));

create table if not exists public.public_lottery_draws (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  order_session_id uuid not null references public.order_sessions(id) on delete cascade,
  device_hash text not null,
  business_date date not null,
  selected_product_id uuid references public.products(id) on delete set null,
  selected_product_name text not null,
  discount_option_id uuid references public.discount_options(id) on delete set null,
  discount_label text,
  discount_rate_bps integer,
  expires_at timestamptz not null,
  redeemed_order_id uuid unique references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint public_lottery_draws_device_hash_check
    check (char_length(device_hash) between 32 and 200),
  constraint public_lottery_draws_discount_rate_check
    check (discount_rate_bps is null or discount_rate_bps between 1 and 10000),
  constraint public_lottery_draws_discount_snapshot_check
    check (
      (discount_label is null and discount_rate_bps is null)
      or (discount_label is not null and discount_rate_bps is not null)
    ),
  constraint public_lottery_draws_stall_device_day_unique
    unique (stall_id, device_hash, business_date)
);

create index if not exists public_lottery_draws_tenant_idx
  on public.public_lottery_draws (organization_id, stall_id, business_date desc);
create index if not exists public_lottery_draws_session_idx
  on public.public_lottery_draws (order_session_id);
create index if not exists public_lottery_draws_expiry_idx
  on public.public_lottery_draws (expires_at)
  where redeemed_order_id is null;

alter table public.orders
  drop constraint if exists orders_lottery_draw_id_fkey,
  add constraint orders_lottery_draw_id_fkey
    foreign key (lottery_draw_id)
    references public.public_lottery_draws(id) on delete set null;
create unique index if not exists orders_lottery_draw_unique
  on public.orders (lottery_draw_id)
  where lottery_draw_id is not null;

create or replace function public.enforce_public_lottery_draw_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.id = new.order_session_id;

  if not found
     or v_session.organization_id <> new.organization_id
     or v_session.stall_id <> new.stall_id
     or v_session.device_hash <> new.device_hash then
    raise exception 'LOTTERY_SESSION_SCOPE_MISMATCH';
  end if;

  if new.selected_product_id is not null and not exists (
    select 1
    from public.products product
    join public.stall_products assignment
      on assignment.product_id = product.id
      and assignment.organization_id = product.organization_id
    where product.id = new.selected_product_id
      and product.organization_id = new.organization_id
      and assignment.stall_id = new.stall_id
  ) then
    raise exception 'LOTTERY_PRODUCT_SCOPE_MISMATCH';
  end if;

  if new.discount_option_id is not null and not exists (
    select 1
    from public.discount_options discount
    where discount.id = new.discount_option_id
      and discount.organization_id = new.organization_id
      and discount.stall_id = new.stall_id
  ) then
    raise exception 'LOTTERY_DISCOUNT_SCOPE_MISMATCH';
  end if;

  if new.redeemed_order_id is not null and not exists (
    select 1
    from public.orders order_record
    where order_record.id = new.redeemed_order_id
      and order_record.organization_id = new.organization_id
      and order_record.stall_id = new.stall_id
      and order_record.device_hash = new.device_hash
  ) then
    raise exception 'LOTTERY_ORDER_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists public_lottery_draws_scope_before_write
  on public.public_lottery_draws;
create trigger public_lottery_draws_scope_before_write
before insert or update of organization_id, stall_id, order_session_id,
  device_hash, selected_product_id, discount_option_id, redeemed_order_id
on public.public_lottery_draws
for each row execute function public.enforce_public_lottery_draw_scope();

create or replace function public.enforce_order_lottery_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lottery_draw_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.public_lottery_draws draw
    where draw.id = new.lottery_draw_id
      and draw.organization_id = new.organization_id
      and draw.stall_id = new.stall_id
      and draw.device_hash = new.device_hash
      and draw.redeemed_order_id = new.id
  ) then
    raise exception 'LOTTERY_ORDER_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_lottery_scope_before_write on public.orders;
create trigger orders_lottery_scope_before_write
before insert or update of lottery_draw_id, organization_id, stall_id, device_hash
on public.orders
for each row execute function public.enforce_order_lottery_scope();

alter table public.public_lottery_draws enable row level security;
alter table public.public_lottery_draws force row level security;

revoke all on table public.public_lottery_draws from public, anon, authenticated;
grant select on table public.public_lottery_draws to authenticated;
grant select, insert, update, delete on table public.public_lottery_draws to service_role;

create policy public_lottery_draws_manager_select
on public.public_lottery_draws for select to authenticated
using (app_private.can_manage_stall(stall_id));

create or replace function public.get_takeout_preorder_slots(
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
  select * into v_stall
  from public.stalls stall
  where stall.id = p_stall_id;

  if not found
     or not coalesce(v_settings.takeout_preorder_enabled, false)
     or not v_stall.is_active
     or v_stall.is_sold_out
     or v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state
     or v_stall.business_status = 'PAUSED'::public.stall_business_status then
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
      business_window.local_opens_at,
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
    limit 2880
  )
  select coalesce(jsonb_agg(scheduled_at order by scheduled_at), '[]'::jsonb)
  into v_slots
  from valid_slots;

  return coalesce(v_slots, '[]'::jsonb);
end;
$$;

create or replace function public.resolve_public_ordering_mode(
  p_qr_token text,
  p_requested_mode text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_qr public.qr_codes%rowtype;
  v_stall public.stalls%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
begin
  if p_requested_mode <> 'DEFAULT' then return p_requested_mode; end if;
  select * into v_qr from public.qr_codes qr where qr.token = p_qr_token;
  if not found then return p_requested_mode; end if;
  select * into v_stall from public.stalls stall where stall.id = v_qr.stall_id;
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_qr.stall_id;

  if coalesce(v_settings.takeout_preorder_enabled, false)
     and v_stall.is_active
     and not v_stall.is_sold_out
     and v_stall.business_status <> 'PAUSED'::public.stall_business_status
     and v_stall.ordering_state <> 'PAUSED'::public.stall_ordering_state
     and (
       not v_stall.ordering_enabled
       or v_stall.business_status = 'CLOSED'::public.stall_business_status
       or v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state
     )
     and v_qr.dining_table_id is null
     and v_qr.market_event_id is null
     and v_qr.stall_schedule_id is null
     and v_qr.fulfillment_type_context is distinct from 'DINE_IN'::public.fulfillment_type
     and v_qr.fulfillment_type_context is distinct from 'DELIVERY'::public.fulfillment_type then
    return 'PREORDER';
  end if;
  return p_requested_mode;
end;
$$;

create or replace function public.validate_takeout_preorder_slot(
  p_stall_id uuid,
  p_scheduled_pickup_at timestamptz,
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
begin
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = p_stall_id;

  if not found or not v_settings.takeout_preorder_enabled then
    return 'PREORDER_DISABLED';
  end if;
  if p_scheduled_pickup_at is null then
    return 'PREORDER_TIME_REQUIRED';
  end if;
  if p_scheduled_pickup_at <= now() then
    return 'PREORDER_TIME_INVALID';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements_text(
      public.get_takeout_preorder_slots(p_stall_id, p_reference_time)
    ) slot(value)
    where slot.value::timestamptz = p_scheduled_pickup_at
  ) then
    return 'PREORDER_TIME_INVALID';
  end if;
  return null;
end;
$$;

create or replace function public.draw_public_lottery(
  p_session_token_hash text,
  p_device_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_stall public.stalls%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_existing public.public_lottery_draws%rowtype;
  v_product record;
  v_discount public.discount_options%rowtype;
  v_business_date date;
  v_expires_at timestamptz;
  v_random_bytes bytea;
  v_random_value integer;
  v_bucket integer;
  v_allowed_ip boolean;
  v_allowed_qr boolean;
  v_draw_id uuid := gen_random_uuid();
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if not found
     or v_session.status <> 'ACTIVE'::public.order_session_status
     or v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;
  if v_session.device_hash <> p_device_hash then
    return jsonb_build_object('ok', false, 'code', 'SESSION_DEVICE_MISMATCH');
  end if;
  if v_session.ordering_mode <> 'DEFAULT' then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_UNAVAILABLE');
  end if;

  select * into v_stall from public.stalls where id = v_session.stall_id;
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_session.stall_id;
  if not coalesce(v_settings.lottery_enabled, false)
     or not v_stall.is_active
     or v_stall.is_sold_out
     or exists (
       select 1 from public.qr_codes qr
       where qr.id = v_session.qr_code_id
         and (qr.dining_table_id is not null
           or qr.market_event_id is not null
           or qr.stall_schedule_id is not null
           or qr.fulfillment_type_context in (
             'DINE_IN'::public.fulfillment_type,
             'DELIVERY'::public.fulfillment_type
           ))
     ) then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_UNAVAILABLE');
  end if;

  v_business_date := app_private.stall_business_date(v_stall.id, now());
  select * into v_existing
  from public.public_lottery_draws draw
  where draw.stall_id = v_session.stall_id
    and draw.device_hash = p_device_hash
    and draw.business_date = v_business_date;
  if found then
    return jsonb_build_object(
      'ok', true,
      'drawId', v_existing.id,
      'productId', v_existing.selected_product_id,
      'productName', v_existing.selected_product_name,
      'discountWon', v_existing.discount_option_id is not null,
      'discountLabel', v_existing.discount_label,
      'discountRateBps', v_existing.discount_rate_bps,
      'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
  end if;

  -- A browser-provided device id is not a financial security boundary. Keep
  -- the per-device daily idempotency above, and cap new draws by the trusted
  -- session IP and QR scopes to prevent simple device-id rotation abuse.
  v_allowed_ip := public.consume_public_rate_limit(
    v_session.stall_id,
    'LOTTERY_IP',
    v_session.ip_hash,
    10,
    86400
  );
  v_allowed_qr := public.consume_public_rate_limit(
    v_session.stall_id,
    'LOTTERY_QR',
    encode(extensions.digest(v_session.qr_code_id::text, 'sha256'), 'hex'),
    500,
    86400
  );
  if not (v_allowed_ip and v_allowed_qr) then
    return jsonb_build_object('ok', false, 'code', 'LOTTERY_RATE_LIMITED');
  end if;

  select product.id, product.name
  into v_product
  from public.stall_products assignment
  join public.products product
    on product.id = assignment.product_id
    and product.organization_id = assignment.organization_id
  join public.product_categories category
    on category.id = product.category_id
    and category.organization_id = product.organization_id
    and category.is_active
  where assignment.organization_id = v_session.organization_id
    and assignment.stall_id = v_session.stall_id
    and assignment.is_enabled
    and not assignment.is_sold_out
    and product.is_active
    and product.kind = 'SINGLE'::public.product_kind
    and (assignment.available_from is null or assignment.available_from <= now())
    and (assignment.available_until is null or assignment.available_until > now())
  order by gen_random_uuid()
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  if v_settings.lottery_discount_option_id is not null
     and v_settings.lottery_discount_win_rate_bps > 0 then
    select * into v_discount
    from public.discount_options discount
    where discount.id = v_settings.lottery_discount_option_id
      and discount.organization_id = v_session.organization_id
      and discount.stall_id = v_session.stall_id
      and discount.is_enabled;
    if found then
      -- Reject the incomplete 5536-value tail before modulo so every bucket
      -- has exactly six representatives and the configured odds stay exact.
      loop
        v_random_bytes := extensions.gen_random_bytes(2);
        v_random_value := get_byte(v_random_bytes, 0) * 256
          + get_byte(v_random_bytes, 1);
        exit when v_random_value < 60000;
      end loop;
      v_bucket := v_random_value % 10000;
      if v_bucket >= v_settings.lottery_discount_win_rate_bps then
        v_discount := null;
      end if;
    end if;
  end if;

  v_expires_at := (
    (v_business_date + 1)::timestamp
    + make_interval(hours => coalesce(v_settings.business_day_cutoff_hour, 0))
  ) at time zone v_stall.timezone;
  insert into public.public_lottery_draws (
    id, organization_id, stall_id, order_session_id, device_hash,
    business_date, selected_product_id, selected_product_name,
    discount_option_id, discount_label, discount_rate_bps, expires_at
  ) values (
    v_draw_id, v_session.organization_id, v_session.stall_id, v_session.id,
    p_device_hash, v_business_date, v_product.id, v_product.name,
    v_discount.id, v_discount.name, v_discount.rate_bps, v_expires_at
  );

  return jsonb_build_object(
    'ok', true,
    'drawId', v_draw_id,
    'productId', v_product.id,
    'productName', v_product.name,
    'discountWon', v_discount.id is not null,
    'discountLabel', v_discount.name,
    'discountRateBps', v_discount.rate_bps,
    'expiresAt', v_expires_at,
    'idempotentReplay', false
  );
exception
  when unique_violation then
    select * into v_existing
    from public.public_lottery_draws draw
    where draw.stall_id = v_session.stall_id
      and draw.device_hash = p_device_hash
      and draw.business_date = v_business_date;
    return jsonb_build_object(
      'ok', true,
      'drawId', v_existing.id,
      'productId', v_existing.selected_product_id,
      'productName', v_existing.selected_product_name,
      'discountWon', v_existing.discount_option_id is not null,
      'discountLabel', v_existing.discount_label,
      'discountRateBps', v_existing.discount_rate_bps,
      'expiresAt', v_existing.expires_at,
      'idempotentReplay', true
    );
end;
$$;

revoke all on function public.enforce_lottery_discount_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_public_lottery_draw_scope()
  from public, anon, authenticated;
revoke all on function public.enforce_order_lottery_scope()
  from public, anon, authenticated;
revoke all on function public.get_takeout_preorder_slots(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.validate_takeout_preorder_slot(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.resolve_public_ordering_mode(text, text)
  from public, anon, authenticated;
revoke all on function public.draw_public_lottery(text, text)
  from public, anon, authenticated;

grant execute on function public.get_takeout_preorder_slots(uuid, timestamptz)
  to service_role;
grant execute on function public.validate_takeout_preorder_slot(uuid, timestamptz, timestamptz)
  to service_role;
grant execute on function public.resolve_public_ordering_mode(text, text)
  to service_role;
grant execute on function public.draw_public_lottery(text, text)
  to service_role;

-- PREORDER is restricted to static takeaway QR codes. Event/schedule QR codes
-- keep their established live-window contract rather than silently accepting
-- an order for a different location or event.
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

  if p_ordering_mode not in ('DEFAULT', 'DELIVERY', 'PREORDER') then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if v_qr.fulfillment_type_context = 'DELIVERY'::public.fulfillment_type
     and p_ordering_mode <> 'DELIVERY' then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if v_qr.fulfillment_type_context = 'DINE_IN'::public.fulfillment_type
     and p_ordering_mode <> 'DEFAULT' then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if v_qr.fulfillment_type_context = 'TAKEOUT'::public.fulfillment_type
     and p_ordering_mode not in ('DEFAULT', 'PREORDER') then
    return 'ORDER_MODE_CONFLICT';
  end if;
  if p_ordering_mode = 'PREORDER' and (
    v_qr.dining_table_id is not null
    or v_qr.stall_schedule_id is not null
    or v_qr.market_event_id is not null
    or v_qr.fulfillment_type_context in (
      'DINE_IN'::public.fulfillment_type,
      'DELIVERY'::public.fulfillment_type
    )
  ) then
    return 'PREORDER_CONTEXT_UNAVAILABLE';
  end if;

  if v_qr.location_id is not null then
    select * into v_location from public.stall_locations where id = v_qr.location_id;
    if not found or not v_location.is_active then return 'LOCATION_UNAVAILABLE'; end if;
  end if;

  if p_ordering_mode = 'PREORDER' then
    return null;
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

create or replace function public.issue_preorder_order_session(
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
  v_stall public.stalls%rowtype;
  v_tenant public.tenants%rowtype;
  v_settings public.stall_ordering_settings%rowtype;
  v_session_id uuid := gen_random_uuid();
  v_expires_at timestamptz;
  v_code text;
  v_allowed_ip boolean;
  v_allowed_device boolean;
  v_allowed_qr boolean;
  v_allowed_stall boolean;
  v_allowed_behavior boolean;
begin
  select * into v_qr
  from public.qr_codes qr
  where qr.token = p_qr_token
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'QR_NOT_FOUND');
  end if;

  select * into v_stall from public.stalls where id = v_qr.stall_id;
  select * into v_tenant from public.tenants where id = v_qr.tenant_id;
  select * into v_settings
  from public.stall_ordering_settings settings
  where settings.stall_id = v_qr.stall_id;

  v_code := public.validate_ordering_schedule_context(v_qr.id, 'PREORDER');
  if v_code is not null then
    perform public.record_public_order_attempt(
      p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
      v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
      p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  if v_qr.state = 'REVOKED'::public.qr_code_state then
    v_code := 'QR_REVOKED';
  elsif v_qr.state = 'PAUSED'::public.qr_code_state then
    v_code := 'QR_PAUSED';
  elsif v_qr.state = 'EXPIRED'::public.qr_code_state
     or (v_qr.expires_at is not null and v_qr.expires_at <= now()) then
    v_code := 'QR_EXPIRED';
  elsif not v_stall.is_active then
    v_code := 'STALL_CLOSED';
  elsif v_stall.ordering_state = 'PAUSED'::public.stall_ordering_state
     or v_stall.business_status = 'PAUSED'::public.stall_business_status then
    v_code := 'ORDERING_PAUSED';
  elsif v_stall.is_sold_out then
    v_code := 'STALL_SOLD_OUT';
  elsif not coalesce(v_settings.takeout_preorder_enabled, false) then
    v_code := 'PREORDER_DISABLED';
  elsif public.get_takeout_preorder_slots(v_stall.id, now()) = '[]'::jsonb then
    v_code := 'PREORDER_TIME_UNAVAILABLE';
  elsif v_tenant.status not in (
    'TRIALING'::public.tenant_status,
    'ACTIVE'::public.tenant_status,
    'GRACE_PERIOD'::public.tenant_status
  ) then
    v_code := 'TENANT_INACTIVE';
  else
    v_code := public.billing_order_access_code(v_qr.organization_id, true);
    if v_code = 'OK' then v_code := null; end if;
  end if;

  if v_code is not null then
    perform public.record_public_order_attempt(
      p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
      v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
      p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
    );
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;

  v_allowed_ip := public.consume_public_rate_limit(
    v_qr.stall_id, 'SESSION_IP', p_ip_hash,
    v_settings.max_sessions_per_ip_window, v_settings.order_window_seconds
  );
  v_allowed_device := public.consume_public_rate_limit(
    v_qr.stall_id, 'SESSION_DEVICE', p_device_hash,
    v_settings.max_sessions_per_device_window, v_settings.order_window_seconds
  );
  v_allowed_qr := public.consume_public_rate_limit(
    v_qr.stall_id, 'SESSION_QR', p_qr_token_hash,
    v_settings.max_sessions_per_qr_window, v_settings.order_window_seconds
  );
  v_allowed_stall := public.consume_public_rate_limit(
    v_qr.stall_id, 'SESSION_STALL',
    encode(extensions.digest(v_qr.stall_id::text, 'sha256'), 'hex'),
    v_settings.max_sessions_per_stall_window, v_settings.order_window_seconds
  );
  v_allowed_behavior := public.consume_public_rate_limit(
    v_qr.stall_id, 'SESSION_BEHAVIOR', p_behavior_hash,
    v_settings.max_behavior_frequency * 5, v_settings.order_window_seconds
  );
  if not (v_allowed_ip and v_allowed_device and v_allowed_qr
      and v_allowed_stall and v_allowed_behavior) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  v_expires_at := now() + make_interval(secs => v_settings.order_session_ttl_seconds);
  insert into public.order_sessions (
    id, tenant_id, organization_id, stall_id, qr_code_id, token_hash,
    device_hash, ip_hash, status, expires_at, ordering_mode, location_id,
    market_event_id, stall_schedule_id, fulfillment_type_context, created_at
  ) values (
    v_session_id, v_qr.tenant_id, v_qr.organization_id, v_qr.stall_id,
    v_qr.id, p_session_token_hash, p_device_hash, p_ip_hash,
    'ACTIVE'::public.order_session_status, v_expires_at, 'PREORDER',
    v_qr.location_id, v_qr.market_event_id, v_qr.stall_schedule_id,
    v_qr.fulfillment_type_context,
    now()
  );

  perform public.record_public_order_attempt(
    p_request_id, 'SESSION_ISSUE', 'ALLOWED', 'PREORDER_SESSION_ISSUED',
    v_qr.tenant_id, v_qr.stall_id, v_qr.id, v_session_id, p_ip_hash,
    p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, null
  );
  return jsonb_build_object(
    'ok', true,
    'organization_id', v_qr.organization_id,
    'stall_id', v_qr.stall_id,
    'qr_code_id', v_qr.id,
    'order_session_id', v_session_id,
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'SESSION_TOKEN_COLLISION');
end;
$$;

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

revoke all on function public.validate_ordering_schedule_context(uuid, text)
  from public, anon, authenticated;
revoke all on function public.issue_preorder_order_session(
  text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.validate_ordering_schedule_context(uuid, text)
  to service_role;
grant execute on function public.issue_preorder_order_session(
  text, text, text, text, text, text, text
) to service_role;
grant execute on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) to service_role;

-- The established shared-product writer remains the single pricing core.
-- PREORDER sessions may write while the live ordering switch is CLOSED, but
-- the outer experience wrapper validates the configured future slot first.
create or replace function public.create_public_order_legacy(
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
  elsif not v_stall.is_active or (
    v_stall.ordering_state = 'CLOSED'::public.stall_ordering_state
    and v_session.ordering_mode <> 'PREORDER'
  ) then
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

  if v_item_count > 100 or v_distinct_count > v_settings.max_unique_products then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif exists (
    with canonical_lines as (
      select
        (item->>'product_id')::uuid as product_id,
        btrim(coalesce(item->>'note', '')) as note,
        (
          select coalesce(jsonb_agg(selected.value::uuid order by selected.value::uuid), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
        ) as modifier_option_ids,
        (
          select coalesce(jsonb_agg(selected.value::uuid order by selected.value::uuid), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(item->'bundle_choice_ids', '[]'::jsonb)) selected(value)
        ) as bundle_choice_ids
      from jsonb_array_elements(p_items) item
    )
    select 1
    from canonical_lines
    group by product_id, note, modifier_option_ids, bundle_choice_ids
    having count(*) > 1
  ) then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'TOO_MANY_OR_DUPLICATE_PRODUCTS', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_OR_DUPLICATE_PRODUCTS');
  elsif v_total_quantity > v_settings.max_total_quantity then
    perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'EXCESSIVE_TOTAL_QUANTITY', v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
    return jsonb_build_object('ok', false, 'code', 'EXCESSIVE_TOTAL_QUANTITY');
  elsif exists (
    select 1 from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer, note text)
    where item.quantity < 1 or item.quantity > v_settings.max_item_quantity
       or char_length(coalesce(item.note, '')) > v_settings.max_note_length
  ) or exists (
    select 1
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
    group by item.product_id
    having sum(item.quantity) > v_settings.max_item_quantity
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
    unit_price, quantity, note, source_line_index, created_at
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
    (requested.item->>'quantity')::integer,
    nullif(left(trim(requested.item->>'note'), v_settings.max_note_length), ''),
    requested.line_index::smallint,
    v_created_at
  from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
  join public.stall_products stall_product
    on stall_product.product_id = (requested.item->>'product_id')::uuid
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

revoke all on function public.create_public_order_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;

-- Rebind note validation and snapshots to the request line ordinal. Product id
-- alone is no longer a unique line identity when customers order two variants.
create or replace function public.create_public_order_with_notes_legacy(
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
  v_result jsonb;
  v_order_id uuid;
  v_session_id uuid;
  v_tenant_id uuid;
  v_organization_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
  v_table_id uuid;
  v_table_label text;
  v_table_active boolean;
  v_dine_in_enabled boolean;
  v_fulfillment public.fulfillment_type := 'TAKEOUT'::public.fulfillment_type;
  v_order_total integer;
  v_idempotent_replay boolean;
begin
  select session_record.id, session_record.tenant_id, session_record.organization_id,
    session_record.stall_id, session_record.qr_code_id, qr.dining_table_id, settings.dine_in_enabled
  into v_session_id, v_tenant_id, v_organization_id, v_stall_id, v_qr_code_id,
    v_table_id, v_dine_in_enabled
  from public.order_sessions session_record
  join public.qr_codes qr on qr.id = session_record.qr_code_id
  join public.stall_ordering_settings settings on settings.stall_id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash;

  if v_table_id is not null then
    select label, is_active into v_table_label, v_table_active
    from public.dining_tables where id = v_table_id for share;
  end if;
  if v_table_id is not null and (not coalesce(v_table_active, false) or not coalesce(v_dine_in_enabled, false)) then
    return jsonb_build_object('ok', false, 'code', 'TABLE_UNAVAILABLE');
  end if;

  if v_organization_id is not null and jsonb_typeof(p_items) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p_items) item
      where case
        when not (item ? 'modifier_option_ids') then false
        when jsonb_typeof(item->'modifier_option_ids') <> 'array' then true
        else jsonb_array_length(item->'modifier_option_ids') > 50
      end
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      select 1 from (
        select requested.line_index, selected.value::uuid as option_id
        from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
        cross join lateral jsonb_array_elements_text(coalesce(requested.item->'modifier_option_ids', '[]'::jsonb)) selected(value)
        group by requested.line_index, selected.value::uuid
        having count(*) > 1
      ) duplicate_selection
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      with selected as (
        select (item->>'product_id')::uuid as product_id, selected.value::uuid as option_id
        from jsonb_array_elements(p_items) item
        cross join lateral jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
      )
      select 1 from selected
      left join public.product_note_options note_option
        on note_option.id = selected.option_id and note_option.organization_id = v_organization_id and note_option.is_active
      left join public.product_note_groups note_group
        on note_group.id = note_option.note_group_id and note_group.organization_id = v_organization_id and note_group.is_active
      left join public.product_note_group_assignments assignment
        on assignment.note_group_id = note_group.id and assignment.product_id = selected.product_id
          and assignment.organization_id = v_organization_id and assignment.is_active
      where note_option.id is null or note_group.id is null or assignment.id is null
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      with requested as (
        select (item->>'product_id')::uuid as product_id,
          coalesce(item->'modifier_option_ids', '[]'::jsonb) as selected_options
        from jsonb_array_elements(p_items) item
      )
      select 1
      from requested
      join public.product_note_group_assignments assignment
        on assignment.product_id = requested.product_id
        and assignment.organization_id = v_organization_id and assignment.is_active
      join public.product_note_groups note_group
        on note_group.id = assignment.note_group_id
        and note_group.organization_id = v_organization_id and note_group.is_active
      cross join lateral (
        select count(*)::integer as selected_count
        from jsonb_array_elements_text(requested.selected_options) selected(value)
        join public.product_note_options note_option
          on note_option.id = selected.value::uuid
          and note_option.note_group_id = note_group.id and note_option.is_active
      ) selection_count
      where selection_count.selected_count < note_group.min_selections
        or (note_group.max_selections is not null and selection_count.selected_count > note_group.max_selections)
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;
  end if;

  v_result := public.create_public_order_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );

  if coalesce((v_result->>'ok')::boolean, false) and v_result ? 'order' then
    v_order_id := (v_result #>> '{order,order_id}')::uuid;
    v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);

    if not v_idempotent_replay then
      update public.order_items set base_unit_price = unit_price where order_id = v_order_id;

      insert into public.order_item_note_options (
        organization_id, stall_id, order_item_id, note_group_id, note_option_id,
        group_name, option_name, price_delta, sort_order, created_at
      )
      select v_organization_id, v_stall_id, order_item.id, note_group.id, note_option.id,
        note_group.name, note_option.name, note_option.price_delta,
        note_group.sort_order * 1000 + note_option.sort_order, now()
      from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
      cross join lateral jsonb_array_elements_text(coalesce(requested.item->'modifier_option_ids', '[]'::jsonb)) selected(value)
      join public.order_items order_item
        on order_item.order_id = v_order_id
       and order_item.source_line_index = requested.line_index
      join public.product_note_options note_option on note_option.id = selected.value::uuid
      join public.product_note_groups note_group on note_group.id = note_option.note_group_id;

      update public.order_items order_item
      set unit_price = greatest(0, order_item.base_unit_price + modifier_total.price_delta)
      from (
        select item.id, coalesce(sum(note.price_delta), 0)::integer as price_delta
        from public.order_items item
        left join public.order_item_note_options note on note.order_item_id = item.id
        where item.order_id = v_order_id
        group by item.id
      ) modifier_total
      where order_item.id = modifier_total.id;

      select coalesce(sum(unit_price * quantity), 0)::integer into v_order_total
      from public.order_items where order_id = v_order_id;
      update public.orders set subtotal = v_order_total, total = v_order_total where id = v_order_id;
      update public.audit_logs
      set metadata = (coalesce(nullif(metadata, ''), '{}')::jsonb || jsonb_build_object('total', v_order_total))::text
      where entity_id = v_order_id and action = 'PUBLIC_ORDER_CREATED';
    else
      select total into v_order_total from public.orders where id = v_order_id;
    end if;

    if v_table_id is not null then
      v_fulfillment := 'DINE_IN'::public.fulfillment_type;
      update public.orders
      set dining_table_id = v_table_id,
          table_label = v_table_label,
          fulfillment_type = v_fulfillment,
          pickup_code_hash = null
      where id = v_order_id;
    end if;
    v_result := jsonb_set(v_result, '{order,fulfillment_type}', to_jsonb(v_fulfillment::text), true);
    v_result := jsonb_set(v_result, '{order,pickup_required}', to_jsonb(v_fulfillment = 'TAKEOUT'::public.fulfillment_type), true);
    v_result := jsonb_set(v_result, '{order,total_amount}', to_jsonb(v_order_total), true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_public_order_with_notes_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_notes_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;

-- Keep the established billing, operational, note-option, and shared-product
-- chain intact, then add bundle validation and pricing as its outermost layer.
alter function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) rename to create_public_order_bundle_legacy;

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
  v_result jsonb;
  v_order_id uuid;
  v_order_total integer;
  v_idempotent_replay boolean;
  v_fulfillment_at timestamptz := now();
  v_billing_code text;
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;

  if v_session.ordering_mode = 'PREORDER' then
    v_fulfillment_at := v_session.requested_fulfillment_at;
    if v_fulfillment_at is null then
      return jsonb_build_object('ok', false, 'code', 'PREORDER_TIME_REQUIRED');
    end if;
    if jsonb_typeof(p_items) = 'array' and exists (
      select 1
      from jsonb_array_elements(p_items) item
      left join public.stall_products assignment
        on assignment.stall_id = v_session.stall_id
       and assignment.organization_id = v_session.organization_id
       and assignment.product_id = (item->>'product_id')::uuid
      where assignment.product_id is null
         or not assignment.is_enabled
         or assignment.is_sold_out
         or (
           assignment.available_from is not null
           and v_fulfillment_at < assignment.available_from
         )
         or (
           assignment.available_until is not null
           and v_fulfillment_at >= assignment.available_until
         )
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
    end if;
  end if;

  if v_session.id is not null and jsonb_typeof(p_items) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      where case
        when not (item ? 'bundle_choice_ids') then false
        when jsonb_typeof(item->'bundle_choice_ids') <> 'array' then true
        else jsonb_array_length(item->'bundle_choice_ids') > 50
      end
    ) or exists (
      select 1
      from (
        select requested.line_index, selected.value::uuid as choice_id
        from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
        cross join lateral jsonb_array_elements_text(
          coalesce(requested.item->'bundle_choice_ids', '[]'::jsonb)
        ) selected(value)
        group by requested.line_index, selected.value::uuid
        having count(*) > 1
      ) duplicate_selection
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;

    -- SINGLE products cannot carry bundle selections. A BUNDLE must have at
    -- least one configured group and every group must satisfy its trusted
    -- minimum/maximum selection bounds.
    if exists (
      with requested as (
        select (item->>'product_id')::uuid as product_id,
          coalesce(item->'bundle_choice_ids', '[]'::jsonb) as selected_choices
        from jsonb_array_elements(p_items) item
      )
      select 1
      from requested
      join public.products product
        on product.id = requested.product_id
       and product.organization_id = v_session.organization_id
      where (
        product.kind = 'SINGLE'::public.product_kind
        and jsonb_array_length(requested.selected_choices) <> 0
      ) or (
        product.kind = 'BUNDLE'::public.product_kind
        and not exists (
          select 1
          from public.product_bundle_choice_groups choice_group
          where choice_group.organization_id = v_session.organization_id
            and choice_group.bundle_product_id = product.id
        )
      ) or (
        product.kind = 'BUNDLE'::public.product_kind
        and exists (
          select 1
          from public.product_bundle_choice_groups choice_group
          cross join lateral (
            select count(*)::integer as selected_count
            from jsonb_array_elements_text(requested.selected_choices) selected(value)
            join public.product_bundle_choices choice
              on choice.id = selected.value::uuid
             and choice.organization_id = v_session.organization_id
             and choice.choice_group_id = choice_group.id
             and choice.is_enabled
          ) selection_count
          where choice_group.organization_id = v_session.organization_id
            and choice_group.bundle_product_id = product.id
            and (
              selection_count.selected_count < choice_group.min_selections
              or selection_count.selected_count > choice_group.max_selections
            )
        )
      )
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;

    -- Every selected id must belong to the requested bundle and resolve to an
    -- active SINGLE component that is currently sellable at this stall.
    if exists (
      select 1
      from jsonb_array_elements(p_items) item
      cross join lateral jsonb_array_elements_text(
        coalesce(item->'bundle_choice_ids', '[]'::jsonb)
      ) selected(value)
      left join public.product_bundle_choices choice
        on choice.id = selected.value::uuid
       and choice.organization_id = v_session.organization_id
       and choice.is_enabled
      left join public.product_bundle_choice_groups choice_group
        on choice_group.id = choice.choice_group_id
       and choice_group.organization_id = v_session.organization_id
       and choice_group.bundle_product_id = (item->>'product_id')::uuid
      left join public.products component
        on component.id = choice.component_product_id
       and component.organization_id = v_session.organization_id
       and component.kind = 'SINGLE'::public.product_kind
       and component.is_active
      left join public.product_categories component_category
        on component_category.id = component.category_id
       and component_category.organization_id = v_session.organization_id
       and component_category.is_active
      left join public.stall_products component_assignment
        on component_assignment.product_id = component.id
       and component_assignment.organization_id = v_session.organization_id
       and component_assignment.stall_id = v_session.stall_id
       and component_assignment.is_enabled
       and not component_assignment.is_sold_out
       and (
         component_assignment.available_from is null
         or component_assignment.available_from <= v_fulfillment_at
       )
       and (
         component_assignment.available_until is null
         or component_assignment.available_until > v_fulfillment_at
       )
      where choice.id is null
         or choice_group.id is null
         or component.id is null
         or component_category.id is null
         or component_assignment.product_id is null
    ) then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_BUNDLE',
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_BUNDLE');
    end if;
  end if;

  if v_session.ordering_mode = 'PREORDER' then
    -- The operational legacy wrapper evaluates availability at now(). The
    -- checks above use the trusted pickup time instead, while this explicit
    -- billing gate preserves the next layer before entering note validation.
    v_billing_code := public.billing_order_access_code(
      v_session.organization_id,
      true
    );
    if v_billing_code <> 'OK' then
      perform public.record_public_order_attempt(
        p_request_id, 'ORDER_SUBMIT', 'DENIED', v_billing_code,
        v_session.tenant_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, p_idempotency_hash
      );
      return jsonb_build_object('ok', false, 'code', v_billing_code);
    end if;
    v_result := public.create_public_order_with_notes_legacy(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id
    );
  else
    v_result := public.create_public_order_bundle_legacy(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id
    );
  end if;
  if not coalesce((v_result->>'ok')::boolean, false) or not (v_result ? 'order') then
    return v_result;
  end if;

  v_order_id := (v_result #>> '{order,order_id}')::uuid;
  v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);
  if not v_idempotent_replay then
    with inserted as (
      insert into public.order_item_note_options (
        organization_id, stall_id, order_item_id, note_group_id,
        note_option_id, group_name, option_name, price_delta, sort_order,
        created_at
      )
      select
        v_session.organization_id,
        v_session.stall_id,
        order_item.id,
        null,
        null,
        '套餐 · ' || choice_group.name,
        component.name || case when choice.quantity > 1
          then ' × ' || choice.quantity::text else '' end,
        choice.price_delta,
        choice_group.sort_order * 1000 + choice.sort_order,
        now()
      from jsonb_array_elements(p_items) with ordinality as requested(item, line_index)
      cross join lateral jsonb_array_elements_text(
        coalesce(requested.item->'bundle_choice_ids', '[]'::jsonb)
      ) selected(value)
      join public.order_items order_item
        on order_item.order_id = v_order_id
       and order_item.source_line_index = requested.line_index
      join public.product_bundle_choices choice
        on choice.id = selected.value::uuid
       and choice.organization_id = v_session.organization_id
      join public.product_bundle_choice_groups choice_group
        on choice_group.id = choice.choice_group_id
       and choice_group.bundle_product_id = order_item.product_id
      join public.products component
        on component.id = choice.component_product_id
       and component.organization_id = v_session.organization_id
      returning order_item_id, price_delta
    ), affected as (
      select distinct order_item_id from inserted
    ), bundle_delta as (
      select order_item_id, sum(price_delta)::integer as price_delta
      from inserted
      group by order_item_id
    ), note_delta as (
      -- Data-modifying CTE rows are exposed through RETURNING, while this
      -- table scan intentionally sees only the pre-existing note selections.
      select option.order_item_id, sum(option.price_delta)::integer as price_delta
      from public.order_item_note_options option
      join affected on affected.order_item_id = option.order_item_id
      group by option.order_item_id
    ), trusted_price as (
      select order_item.id,
        order_item.base_unit_price
          + coalesce(note_delta.price_delta, 0)
          + bundle_delta.price_delta as unit_price
      from public.order_items order_item
      join affected on affected.order_item_id = order_item.id
      join bundle_delta on bundle_delta.order_item_id = order_item.id
      left join note_delta on note_delta.order_item_id = order_item.id
    )
    update public.order_items order_item
    set unit_price = greatest(0, trusted_price.unit_price)
    from trusted_price
    where order_item.id = trusted_price.id;

    select coalesce(sum(unit_price * quantity), 0)::integer
    into v_order_total
    from public.order_items
    where order_id = v_order_id;
    update public.orders
    set subtotal = v_order_total,
        total = v_order_total,
        updated_at = now()
    where id = v_order_id;
  else
    select total into v_order_total from public.orders where id = v_order_id;
  end if;

  v_result := jsonb_set(
    v_result,
    '{order,total_amount}',
    to_jsonb(v_order_total),
    true
  );
  return v_result;
end;
$$;

revoke all on function public.create_public_order_bundle_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order_bundle_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;
grant execute on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;

create or replace function public.create_public_preorder_with_schedule(
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
  -- Keep the public writer signature aligned with live-order submissions while
  -- intentionally ignoring wait acknowledgement for future preorder slots.
  perform coalesce(p_wait_acknowledged, false);

  select * into v_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;
  if found and v_session.status = 'ACTIVE'::public.order_session_status then
    perform app_private.process_stall_schedules(now());
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

  -- A future preorder must not be rejected by the live queue, the current
  -- fifteen-minute product counters, or a wait-time acknowledgement. The
  -- established writer below still enforces tenant, product, billing, abuse,
  -- note, and catalog rules; slot capacity can be added separately per slot.
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

revoke all on function public.create_public_preorder_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_public_preorder_with_schedule(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean
) to service_role;

create or replace function public.create_public_order_with_experience(
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
    v_result := public.create_public_preorder_with_schedule(
      p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
      p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
      p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
      p_pickup_code_hash, p_request_id, p_wait_acknowledged
    );
  else
    v_result := public.create_public_order_with_schedule(
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

revoke all on function public.create_public_order_with_experience(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_public_order_with_experience(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text, boolean, timestamptz, uuid
) to service_role;
