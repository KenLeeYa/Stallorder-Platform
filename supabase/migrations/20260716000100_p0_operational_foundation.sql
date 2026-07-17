-- P0 operational foundation: product schedules, business-day cutoffs,
-- dining table service state, and reversible cross-order kitchen batches.

do $$
begin
  create type public.dining_table_service_state as enum ('EMPTY', 'OCCUPIED', 'NEEDS_CLEANING');
exception
  when duplicate_object then null;
end
$$;

alter table public.stall_ordering_settings
  add column if not exists estimated_wait_minutes integer not null default 15,
  add column if not exists business_day_cutoff_hour smallint not null default 0;

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_estimated_wait_check,
  drop constraint if exists stall_ordering_settings_business_day_cutoff_check;
alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_estimated_wait_check
    check (estimated_wait_minutes between 0 and 240),
  add constraint stall_ordering_settings_business_day_cutoff_check
    check (business_day_cutoff_hour between 0 and 23);

alter table public.stall_products
  add column if not exists available_from timestamptz,
  add column if not exists available_until timestamptz;
alter table public.stall_products
  drop constraint if exists stall_products_availability_range_check;
alter table public.stall_products
  add constraint stall_products_availability_range_check
    check (available_from is null or available_until is null or available_from < available_until);
create index if not exists stall_products_schedule_idx
  on public.stall_products (stall_id, available_from, available_until)
  where is_enabled and not is_sold_out;

alter table public.dining_tables
  add column if not exists service_state public.dining_table_service_state not null default 'EMPTY',
  add column if not exists seated_at timestamptz,
  add column if not exists cleaned_at timestamptz;
create index if not exists dining_tables_service_state_idx
  on public.dining_tables (stall_id, service_state, seated_at);

create table if not exists public.order_item_batch_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  target_status public.order_item_status not null,
  item_snapshots jsonb not null,
  expires_at timestamptz not null,
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_item_batch_actions_snapshots_array
    check (jsonb_typeof(item_snapshots) = 'array' and jsonb_array_length(item_snapshots) between 1 and 100),
  constraint order_item_batch_actions_expiry_check check (expires_at > created_at)
);
create index if not exists order_item_batch_actions_stall_actor_idx
  on public.order_item_batch_actions (stall_id, actor_profile_id, created_at desc);
create index if not exists order_item_batch_actions_expiry_idx
  on public.order_item_batch_actions (expires_at);

alter table public.order_item_batch_actions enable row level security;
alter table public.order_item_batch_actions force row level security;
revoke all on table public.order_item_batch_actions from public, anon, authenticated;
grant select on table public.order_item_batch_actions to authenticated;
drop policy if exists order_item_batch_actions_authorized_select on public.order_item_batch_actions;
create policy order_item_batch_actions_authorized_select on public.order_item_batch_actions
for select to authenticated using (public.can_view_orders(stall_id));

create or replace function public.stall_business_date(p_stall_id uuid, p_timestamp timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (p_timestamp at time zone stall.timezone)
    - make_interval(hours => coalesce(settings.business_day_cutoff_hour, 0))
  )::date
  from public.stalls stall
  left join public.stall_ordering_settings settings on settings.stall_id = stall.id
  where stall.id = p_stall_id;
$$;
revoke all on function public.stall_business_date(uuid, timestamptz) from public, anon;
grant execute on function public.stall_business_date(uuid, timestamptz) to authenticated, service_role;

create or replace function public.refresh_dining_table_service_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id uuid;
  v_terminal boolean;
begin
  v_table_id := case when tg_op = 'DELETE' then old.dining_table_id else new.dining_table_id end;
  if v_table_id is null then return null; end if;

  if tg_op <> 'DELETE'
     and new.fulfillment_type = 'DINE_IN'::public.fulfillment_type
     and new.status in (
       'WAITING_CONFIRMATION'::public.order_status,
       'CONFIRMED'::public.order_status,
       'PREPARING'::public.order_status,
       'READY'::public.order_status
     ) then
    update public.dining_tables
    set service_state = 'OCCUPIED'::public.dining_table_service_state,
        seated_at = coalesce(seated_at, new.created_at),
        updated_at = now()
    where id = new.dining_table_id and stall_id = new.stall_id;
    return null;
  end if;

  select not exists (
    select 1 from public.orders order_record
    where order_record.dining_table_id = v_table_id
      and order_record.status in (
        'WAITING_CONFIRMATION'::public.order_status,
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'READY'::public.order_status
      )
  ) into v_terminal;

  if v_terminal then
    update public.dining_tables
    set service_state = case
          when tg_op <> 'DELETE' and new.status = 'COMPLETED'::public.order_status
            then 'NEEDS_CLEANING'::public.dining_table_service_state
          else 'EMPTY'::public.dining_table_service_state
        end,
        seated_at = case
          when tg_op <> 'DELETE' and new.status = 'COMPLETED'::public.order_status then seated_at
          else null
        end,
        cleaned_at = case
          when tg_op <> 'DELETE' and new.status = 'COMPLETED'::public.order_status then cleaned_at
          else now()
        end,
        updated_at = now()
    where id = v_table_id;
  end if;
  return null;
end;
$$;
revoke all on function public.refresh_dining_table_service_state() from public, anon, authenticated;
grant execute on function public.refresh_dining_table_service_state() to service_role;

drop trigger if exists orders_dining_table_service_state on public.orders;
create trigger orders_dining_table_service_state
after insert or update of status, dining_table_id, fulfillment_type or delete
on public.orders for each row execute function public.refresh_dining_table_service_state();

-- Keep the existing note-validation implementation intact and add schedule
-- validation as a small trusted wrapper around it.
alter function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) rename to create_public_order_with_notes_legacy;

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
  v_session_id uuid;
  v_tenant_id uuid;
  v_organization_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
begin
  select session_record.id, session_record.tenant_id, session_record.organization_id,
    session_record.stall_id, session_record.qr_code_id
  into v_session_id, v_tenant_id, v_organization_id, v_stall_id, v_qr_code_id
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash;

  if v_stall_id is not null and jsonb_typeof(p_items) = 'array' and exists (
    select 1
    from jsonb_array_elements(p_items) item
    left join public.stall_products stall_product
      on stall_product.stall_id = v_stall_id
      and stall_product.organization_id = v_organization_id
      and stall_product.product_id = (item->>'product_id')::uuid
    where stall_product.id is null
      or not stall_product.is_enabled
      or stall_product.is_sold_out
      or (stall_product.available_from is not null and now() < stall_product.available_from)
      or (stall_product.available_until is not null and now() >= stall_product.available_until)
  ) then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_SUBMIT', 'DENIED', 'PRODUCT_UNAVAILABLE',
      v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash,
      p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash,
      p_idempotency_hash
    );
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_UNAVAILABLE');
  end if;

  return public.create_public_order_with_notes_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );
end;
$$;

revoke all on function public.create_public_order_with_notes_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;

create or replace function public.rebuild_daily_stall_summary(
  p_stall_id uuid,
  p_date_from date,
  p_date_to date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stall public.stalls%rowtype;
  v_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then raise exception 'INVALID_SUMMARY_DATE_RANGE'; end if;
  if p_date_to - p_date_from > 366 then raise exception 'SUMMARY_DATE_RANGE_TOO_LARGE'; end if;
  select * into v_stall from public.stalls where id = p_stall_id;
  if not found then raise exception 'STALL_NOT_FOUND'; end if;

  with date_range as (
    select day::date as business_date from generate_series(p_date_from, p_date_to, interval '1 day') day
  ), order_stats as (
    select
      date_range.business_date,
      count(order_record.id)::integer as order_count,
      count(order_record.id) filter (where order_record.status in (
        'CONFIRMED'::public.order_status, 'PREPARING'::public.order_status,
        'READY'::public.order_status, 'COMPLETED'::public.order_status
      ))::integer as confirmed_order_count,
      count(order_record.id) filter (where order_record.status = 'COMPLETED'::public.order_status)::integer as completed_order_count,
      count(order_record.id) filter (where order_record.status = 'CANCELLED'::public.order_status)::integer as cancelled_order_count,
      count(order_record.id) filter (where order_record.status in (
        'WAITING_CONFIRMATION'::public.order_status, 'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status, 'READY'::public.order_status
      ))::integer as pending_order_count,
      count(order_record.id) filter (
        where order_record.payment_status = 'UNPAID'::public.payment_status
          and order_record.status not in ('CANCELLED'::public.order_status, 'EXPIRED'::public.order_status)
      )::integer as unpaid_order_count,
      coalesce(sum(order_record.subtotal) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as gross_sales,
      coalesce(sum(order_record.discount_amount) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as discount_amount,
      coalesce(sum(order_record.total) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as net_sales,
      max(order_record.created_at) as last_order_at
    from date_range
    left join public.orders order_record on order_record.stall_id = v_stall.id
      and public.stall_business_date(v_stall.id, order_record.created_at) = date_range.business_date
    group by date_range.business_date
  ), payment_stats as (
    select
      date_range.business_date,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'CASH'::public.payment_method), 0)::integer as cash_amount,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'MANUAL_TRANSFER'::public.payment_method), 0)::integer as manual_transfer_amount,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'OTHER'::public.payment_method), 0)::integer as other_payment_amount
    from date_range
    left join public.orders payment_order on payment_order.stall_id = v_stall.id
      and public.stall_business_date(v_stall.id, payment_order.created_at) = date_range.business_date
    left join public.payments payment on payment.order_id = payment_order.id
    group by date_range.business_date
  )
  insert into public.daily_stall_summaries (
    organization_id, stall_id, business_date, order_count, confirmed_order_count,
    completed_order_count, cancelled_order_count, pending_order_count, unpaid_order_count,
    gross_sales, discount_amount, net_sales, cash_amount, manual_transfer_amount,
    other_payment_amount, average_order_value, last_order_at, last_calculated_at, updated_at
  )
  select
    v_stall.organization_id, v_stall.id, order_stats.business_date, order_stats.order_count,
    order_stats.confirmed_order_count, order_stats.completed_order_count, order_stats.cancelled_order_count,
    order_stats.pending_order_count, order_stats.unpaid_order_count, order_stats.gross_sales,
    order_stats.discount_amount, order_stats.net_sales, payment_stats.cash_amount,
    payment_stats.manual_transfer_amount, payment_stats.other_payment_amount,
    case when order_stats.completed_order_count = 0 then 0
      else round(order_stats.net_sales::numeric / order_stats.completed_order_count)::integer end,
    order_stats.last_order_at, now(), now()
  from order_stats join payment_stats using (business_date)
  on conflict (stall_id, business_date) do update set
    organization_id = excluded.organization_id,
    order_count = excluded.order_count,
    confirmed_order_count = excluded.confirmed_order_count,
    completed_order_count = excluded.completed_order_count,
    cancelled_order_count = excluded.cancelled_order_count,
    pending_order_count = excluded.pending_order_count,
    unpaid_order_count = excluded.unpaid_order_count,
    gross_sales = excluded.gross_sales,
    discount_amount = excluded.discount_amount,
    net_sales = excluded.net_sales,
    cash_amount = excluded.cash_amount,
    manual_transfer_amount = excluded.manual_transfer_amount,
    other_payment_amount = excluded.other_payment_amount,
    average_order_value = excluded.average_order_value,
    last_order_at = excluded.last_order_at,
    last_calculated_at = excluded.last_calculated_at,
    updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.refresh_order_daily_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_date date;
  v_new_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_date := public.stall_business_date(old.stall_id, old.created_at);
    perform public.rebuild_daily_stall_summary(old.stall_id, v_old_date, v_old_date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_date := public.stall_business_date(new.stall_id, new.created_at);
    if tg_op = 'INSERT' or old.stall_id is distinct from new.stall_id or v_old_date is distinct from v_new_date then
      perform public.rebuild_daily_stall_summary(new.stall_id, v_new_date, v_new_date);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.refresh_payment_daily_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_order public.orders%rowtype;
  v_business_date date;
begin
  select * into payment_order from public.orders where id = coalesce(new.order_id, old.order_id);
  if found then
    v_business_date := public.stall_business_date(payment_order.stall_id, payment_order.created_at);
    perform public.rebuild_daily_stall_summary(payment_order.stall_id, v_business_date, v_business_date);
  end if;
  return null;
end;
$$;

-- Recompute the recent window once so existing local/production rows follow the
-- configured cutoff immediately after deployment.
do $$
declare
  stall_record record;
begin
  for stall_record in select id from public.stalls loop
    perform public.rebuild_daily_stall_summary(
      stall_record.id,
      public.stall_business_date(stall_record.id, now()) - 31,
      public.stall_business_date(stall_record.id, now())
    );
  end loop;
end
$$;
