-- Phase 4: durable daily rollups and explicit manual-payment records.
do $$
begin
  create type public.payment_method as enum ('CASH', 'MANUAL_TRANSFER', 'OTHER');
exception
  when duplicate_object then null;
end;
$$;

alter table public.orders add column completed_at timestamptz;
update public.orders
set completed_at = updated_at
where status = 'COMPLETED'::public.order_status
  and completed_at is null;
create index orders_organization_stall_completed_idx
  on public.orders (organization_id, stall_id, completed_at)
  where completed_at is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount integer not null,
  method public.payment_method not null default 'CASH',
  status public.payment_status not null default 'PAID',
  reference text,
  recorded_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_order_key unique (order_id),
  constraint payments_amount_nonnegative check (amount >= 0),
  constraint payments_status_valid check (status in ('PAID'::public.payment_status, 'REFUNDED'::public.payment_status))
);

create or replace function public.derive_payment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_scope record;
begin
  select organization_id, stall_id into order_scope
  from public.orders
  where id = new.order_id;

  if order_scope is null then
    raise exception 'PAYMENT_ORDER_NOT_FOUND';
  end if;
  if new.organization_id <> order_scope.organization_id
     or new.stall_id <> order_scope.stall_id then
    raise exception 'PAYMENT_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger payments_scope_before_write
before insert or update on public.payments
for each row execute function public.derive_payment_scope();

insert into public.payments (
  organization_id, stall_id, order_id, amount, method, status, paid_at,
  created_at, updated_at
)
select
  organization_id,
  stall_id,
  id,
  total,
  'CASH'::public.payment_method,
  payment_status,
  coalesce(paid_at, completed_at, updated_at),
  coalesce(paid_at, completed_at, updated_at),
  updated_at
from public.orders
where payment_status in ('PAID'::public.payment_status, 'REFUNDED'::public.payment_status)
on conflict (order_id) do nothing;

create index payments_organization_stall_paid_idx
  on public.payments (organization_id, stall_id, paid_at);
create index payments_status_method_paid_idx
  on public.payments (status, method, paid_at);
create index payments_recorded_by_idx
  on public.payments (recorded_by, paid_at)
  where recorded_by is not null;

create table public.daily_stall_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  business_date date not null,
  order_count integer not null default 0,
  confirmed_order_count integer not null default 0,
  completed_order_count integer not null default 0,
  cancelled_order_count integer not null default 0,
  pending_order_count integer not null default 0,
  unpaid_order_count integer not null default 0,
  gross_sales integer not null default 0,
  discount_amount integer not null default 0,
  net_sales integer not null default 0,
  cash_amount integer not null default 0,
  manual_transfer_amount integer not null default 0,
  other_payment_amount integer not null default 0,
  average_order_value integer not null default 0,
  last_order_at timestamptz,
  last_calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_stall_summaries_stall_organization_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint daily_stall_summaries_stall_date_key unique (stall_id, business_date),
  constraint daily_stall_summaries_nonnegative check (
    order_count >= 0
    and confirmed_order_count >= 0
    and completed_order_count >= 0
    and cancelled_order_count >= 0
    and pending_order_count >= 0
    and unpaid_order_count >= 0
    and gross_sales >= 0
    and discount_amount >= 0
    and net_sales >= 0
    and cash_amount >= 0
    and manual_transfer_amount >= 0
    and other_payment_amount >= 0
    and average_order_value >= 0
  )
);

create index daily_stall_summaries_organization_date_idx
  on public.daily_stall_summaries (organization_id, business_date, stall_id);
create index daily_stall_summaries_stall_date_idx
  on public.daily_stall_summaries (stall_id, business_date desc);

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
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'INVALID_SUMMARY_DATE_RANGE';
  end if;
  if p_date_to - p_date_from > 366 then
    raise exception 'SUMMARY_DATE_RANGE_TOO_LARGE';
  end if;

  select * into v_stall
  from public.stalls
  where id = p_stall_id;
  if not found then
    raise exception 'STALL_NOT_FOUND';
  end if;

  with date_range as (
    select day::date as business_date
    from generate_series(p_date_from, p_date_to, interval '1 day') day
  ),
  order_stats as (
    select
      date_range.business_date,
      count(order_record.id)::integer as order_count,
      count(order_record.id) filter (
        where order_record.status in (
          'CONFIRMED'::public.order_status,
          'PREPARING'::public.order_status,
          'READY'::public.order_status,
          'COMPLETED'::public.order_status
        )
      )::integer as confirmed_order_count,
      count(order_record.id) filter (where order_record.status = 'COMPLETED'::public.order_status)::integer as completed_order_count,
      count(order_record.id) filter (where order_record.status = 'CANCELLED'::public.order_status)::integer as cancelled_order_count,
      count(order_record.id) filter (
        where order_record.status in (
          'WAITING_CONFIRMATION'::public.order_status,
          'CONFIRMED'::public.order_status,
          'PREPARING'::public.order_status,
          'READY'::public.order_status
        )
      )::integer as pending_order_count,
      count(order_record.id) filter (
        where order_record.payment_status = 'UNPAID'::public.payment_status
          and order_record.status not in ('CANCELLED'::public.order_status, 'EXPIRED'::public.order_status)
      )::integer as unpaid_order_count,
      coalesce(sum(order_record.total) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as gross_sales,
      max(order_record.created_at) as last_order_at
    from date_range
    left join public.orders order_record
      on order_record.stall_id = v_stall.id
     and (order_record.created_at at time zone v_stall.timezone)::date = date_range.business_date
    group by date_range.business_date
  ),
  payment_stats as (
    select
      date_range.business_date,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'CASH'::public.payment_method
      ), 0)::integer as cash_amount,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'MANUAL_TRANSFER'::public.payment_method
      ), 0)::integer as manual_transfer_amount,
      coalesce(sum(payment.amount) filter (
        where payment.status = 'PAID'::public.payment_status
          and payment.method = 'OTHER'::public.payment_method
      ), 0)::integer as other_payment_amount
    from date_range
    left join public.orders payment_order
      on payment_order.stall_id = v_stall.id
     and (payment_order.created_at at time zone v_stall.timezone)::date = date_range.business_date
    left join public.payments payment on payment.order_id = payment_order.id
    group by date_range.business_date
  )
  insert into public.daily_stall_summaries (
    organization_id, stall_id, business_date, order_count,
    confirmed_order_count, completed_order_count, cancelled_order_count,
    pending_order_count, unpaid_order_count, gross_sales, discount_amount,
    net_sales, cash_amount, manual_transfer_amount, other_payment_amount,
    average_order_value, last_order_at, last_calculated_at, updated_at
  )
  select
    v_stall.organization_id,
    v_stall.id,
    order_stats.business_date,
    order_stats.order_count,
    order_stats.confirmed_order_count,
    order_stats.completed_order_count,
    order_stats.cancelled_order_count,
    order_stats.pending_order_count,
    order_stats.unpaid_order_count,
    order_stats.gross_sales,
    0,
    order_stats.gross_sales,
    payment_stats.cash_amount,
    payment_stats.manual_transfer_amount,
    payment_stats.other_payment_amount,
    case
      when order_stats.completed_order_count = 0 then 0
      else round(order_stats.gross_sales::numeric / order_stats.completed_order_count)::integer
    end,
    order_stats.last_order_at,
    now(),
    now()
  from order_stats
  join payment_stats using (business_date)
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

do $$
declare
  summary_range record;
begin
  for summary_range in
    select
      stall.id as stall_id,
      min((order_record.created_at at time zone stall.timezone)::date) as date_from,
      max((order_record.created_at at time zone stall.timezone)::date) as date_to
    from public.stalls stall
    join public.orders order_record on order_record.stall_id = stall.id
    group by stall.id
  loop
    perform public.rebuild_daily_stall_summary(
      summary_range.stall_id,
      summary_range.date_from,
      summary_range.date_to
    );
  end loop;
end;
$$;

create or replace function public.refresh_order_daily_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_timezone text;
  new_timezone text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select timezone into old_timezone from public.stalls where id = old.stall_id;
    perform public.rebuild_daily_stall_summary(
      old.stall_id,
      (old.created_at at time zone old_timezone)::date,
      (old.created_at at time zone old_timezone)::date
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select timezone into new_timezone from public.stalls where id = new.stall_id;
    if tg_op = 'INSERT'
       or old.stall_id is distinct from new.stall_id
       or (old.created_at at time zone old_timezone)::date is distinct from (new.created_at at time zone new_timezone)::date then
      perform public.rebuild_daily_stall_summary(
        new.stall_id,
        (new.created_at at time zone new_timezone)::date,
        (new.created_at at time zone new_timezone)::date
      );
    elsif tg_op = 'UPDATE' then
      -- The old-scope rebuild above also covers same-day status/payment changes.
      null;
    end if;
  end if;
  return null;
end;
$$;

create trigger orders_daily_summary_after_write
after insert or update of status, payment_status, total, created_at, stall_id or delete
on public.orders
for each row execute function public.refresh_order_daily_summary();

create or replace function public.refresh_payment_daily_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_order public.orders%rowtype;
  stall_timezone text;
begin
  select * into payment_order
  from public.orders
  where id = coalesce(new.order_id, old.order_id);
  if found then
    select timezone into stall_timezone from public.stalls where id = payment_order.stall_id;
    perform public.rebuild_daily_stall_summary(
      payment_order.stall_id,
      (payment_order.created_at at time zone stall_timezone)::date,
      (payment_order.created_at at time zone stall_timezone)::date
    );
  end if;
  return null;
end;
$$;

create trigger payments_daily_summary_after_write
after insert or update of amount, method, status, order_id or delete
on public.payments
for each row execute function public.refresh_payment_daily_summary();

create or replace function public.can_view_stall_financials(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.stalls stall
      join public.organization_memberships membership
        on membership.organization_id = stall.organization_id
      where stall.id = p_stall_id
        and membership.profile_id = public.current_profile_id()
        and membership.is_active
        and membership.role in (
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role,
          'FINANCE_VIEWER'::public.user_role
        )
        and (
          membership.role <> 'ORGANIZATION_ADMIN'::public.user_role
          or membership.all_stalls
          or public.can_access_stall(p_stall_id)
        )
    )
    or public.has_stall_role(
      p_stall_id,
      array['STALL_MANAGER'::public.user_role]
    );
$$;

alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.daily_stall_summaries enable row level security;
alter table public.daily_stall_summaries force row level security;

create policy payments_financial_select on public.payments
for select to authenticated
using (public.can_view_stall_financials(stall_id));

create policy daily_stall_summaries_financial_select on public.daily_stall_summaries
for select to authenticated
using (public.can_view_stall_financials(stall_id));

revoke all on public.payments, public.daily_stall_summaries from public, anon, authenticated;
grant select on public.payments, public.daily_stall_summaries to authenticated;
grant select, insert, update, delete on public.payments, public.daily_stall_summaries to service_role;

revoke all on function public.rebuild_daily_stall_summary(uuid, date, date) from public, anon, authenticated;
revoke all on function public.can_view_stall_financials(uuid) from public, anon;
grant execute on function public.rebuild_daily_stall_summary(uuid, date, date) to service_role;
grant execute on function public.can_view_stall_financials(uuid) to authenticated;
