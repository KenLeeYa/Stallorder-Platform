alter table public.orders
  add column if not exists is_test boolean not null default false;

create or replace function public.enforce_new_order_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_code text;
begin
  v_organization_id := new.organization_id;
  if v_organization_id is null then
    select stall.organization_id into v_organization_id
    from public.stalls stall where stall.id = new.stall_id;
  end if;
  v_code := public.billing_order_access_code(v_organization_id, true);
  if tg_table_name = 'orders' then
    if new.is_test
      and v_code in ('TRIAL_ORDER_LIMIT_REACHED', 'ORDER_PACKAGE_REQUIRED') then
      return new;
    end if;
  end if;
  perform public.billing_raise_if_denied(v_code);
  return new;
end;
$$;

create table public.merchant_setup_progress (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.merchant_applications(id) on delete restrict,
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  stall_id uuid not null unique references public.stalls(id) on delete cascade,
  qr_code_id uuid not null unique references public.qr_codes(id) on delete restrict,
  current_step smallint not null default 1,
  merchant_profile_completed boolean not null default false,
  stall_profile_completed boolean not null default false,
  catalog_completed boolean not null default false,
  payment_options_completed boolean not null default false,
  team_setup_completed boolean not null default false,
  qr_preview_completed boolean not null default false,
  test_order_completed boolean not null default false,
  test_order_id uuid unique references public.orders(id) on delete restrict,
  go_live_completed boolean not null default false,
  test_order_completed_at timestamptz,
  go_live_completed_at timestamptz,
  completed_at timestamptz,
  completed_by_profile_id uuid references public.profiles(id) on delete set null,
  activated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_setup_progress_step_check check (current_step between 1 and 8),
  constraint merchant_setup_progress_test_completion_check check (
    not test_order_completed or (test_order_id is not null and test_order_completed_at is not null)
  ),
  constraint merchant_setup_progress_go_live_check check (
    not go_live_completed or (test_order_completed and go_live_completed_at is not null)
  )
);

create index merchant_setup_progress_go_live_idx
  on public.merchant_setup_progress (organization_id, go_live_completed);
create index merchant_setup_progress_test_order_idx
  on public.merchant_setup_progress (stall_id, test_order_completed);

create trigger merchant_setup_progress_touch_updated_at
before update on public.merchant_setup_progress
for each row execute function public.touch_merchant_application_updated_at();

alter table public.merchant_setup_progress enable row level security;
alter table public.merchant_setup_progress force row level security;

revoke all on public.merchant_setup_progress from public, anon, authenticated;
grant select on public.merchant_setup_progress to authenticated;
grant select, insert, update, delete on public.merchant_setup_progress to service_role;

create policy merchant_setup_progress_member_select
on public.merchant_setup_progress
for select to authenticated
using (public.is_platform_admin() or public.is_organization_member(organization_id));

create or replace function public.complete_merchant_setup_test_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_test
    and new.status = 'COMPLETED'::public.order_status
    and (tg_op = 'INSERT' or old.status <> 'COMPLETED'::public.order_status) then
    update public.merchant_setup_progress
    set test_order_completed = true,
        test_order_completed_at = coalesce(new.completed_at, now()),
        current_step = greatest(current_step, 8),
        updated_at = now()
    where test_order_id = new.id
      and organization_id = new.organization_id
      and stall_id = new.stall_id
      and not test_order_completed;
  end if;
  return null;
end;
$$;

create trigger orders_complete_merchant_setup_test_after_status
after insert or update of status on public.orders
for each row execute function public.complete_merchant_setup_test_order();

create or replace function public.record_billable_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
begin
  if not new.is_test
    and new.status = 'COMPLETED'::public.order_status
    and (tg_op = 'INSERT' or old.status <> 'COMPLETED'::public.order_status) then
    perform 1 from public.subscriptions subscription
    where subscription.organization_id = new.organization_id
    for update;

    v_period := date_trunc('month', coalesce(new.completed_at, now()))::date;
    insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      new.organization_id, new.stall_id, 'BILLABLE_ORDER_COMPLETED', 1,
      v_period, 'ORDER', new.id::text, coalesce(new.completed_at, now())
    ) on conflict do nothing;

    perform public.rebuild_billing_usage_summary(new.organization_id, v_period);
    perform public.reconcile_billing_usage_warnings(new.organization_id, v_period);
  end if;
  return null;
end;
$$;

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
      and not order_record.is_test
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
      and not payment_order.is_test
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

revoke all on function public.complete_merchant_setup_test_order() from public, anon, authenticated;
revoke all on function public.record_billable_order_completed() from public, anon, authenticated;
revoke all on function public.rebuild_daily_stall_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.complete_merchant_setup_test_order() to service_role;
grant execute on function public.record_billable_order_completed() to service_role;
grant execute on function public.rebuild_daily_stall_summary(uuid, date, date) to service_role;
