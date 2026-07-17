-- P1 operational tools: cancellation analytics, grouped dine-in checkout,
-- managed print queue, cash shifts, business hours, and discount approval audit.

do $$
begin
  create type public.cancellation_reason as enum (
    'SOLD_OUT', 'CUSTOMER_CANCELLED', 'WAIT_TOO_LONG', 'DUPLICATE_ORDER', 'OTHER'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.print_job_status as enum (
    'PENDING', 'PRINTING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
  );
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.cash_shift_status as enum ('OPEN', 'CLOSED');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.cash_movement_type as enum ('CASH_IN', 'CASH_OUT');
exception when duplicate_object then null;
end
$$;

alter table public.stall_ordering_settings
  add column if not exists discount_approval_threshold_bps integer not null default 8000;
alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_discount_approval_threshold_check;
alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_discount_approval_threshold_check
    check (discount_approval_threshold_bps between 0 and 10000);

alter table public.orders
  add column if not exists discount_applied_by uuid references public.profiles(id) on delete set null,
  add column if not exists discount_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists discount_approval_reason text,
  add column if not exists cancellation_reason public.cancellation_reason,
  add column if not exists cancellation_detail text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;
alter table public.orders
  drop constraint if exists orders_discount_approval_reason_length_check,
  drop constraint if exists orders_cancellation_detail_length_check;
alter table public.orders
  add constraint orders_discount_approval_reason_length_check
    check (discount_approval_reason is null or char_length(discount_approval_reason) between 1 and 200),
  add constraint orders_cancellation_detail_length_check
    check (cancellation_detail is null or char_length(cancellation_detail) between 1 and 200);
create index if not exists orders_cancellation_report_idx
  on public.orders (stall_id, cancellation_reason, cancelled_at)
  where status = 'CANCELLED'::public.order_status;

create table if not exists public.stall_business_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  day_of_week smallint not null,
  opens_at text not null default '17:00',
  closes_at text not null default '23:00',
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_business_hours_stall_day_unique unique (stall_id, day_of_week),
  constraint stall_business_hours_day_check check (day_of_week between 0 and 6),
  constraint stall_business_hours_open_time_check check (opens_at ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint stall_business_hours_close_time_check check (closes_at ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);
create index if not exists stall_business_hours_tenant_idx
  on public.stall_business_hours (organization_id, stall_id);

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  name text not null,
  is_enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint printers_stall_name_unique unique (stall_id, name),
  constraint printers_name_length_check check (char_length(name) between 1 and 80)
);
create index if not exists printers_tenant_enabled_idx
  on public.printers (organization_id, stall_id, is_enabled);
create index if not exists printers_heartbeat_idx
  on public.printers (stall_id, last_seen_at);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  printer_id uuid references public.printers(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  reprint_of_id uuid references public.print_jobs(id) on delete set null,
  status public.print_job_status not null default 'PENDING',
  copies integer not null default 1,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  next_retry_at timestamptz,
  queued_at timestamptz not null default now(),
  printing_at timestamptz,
  printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_copies_check check (copies between 1 and 10),
  constraint print_jobs_attempts_check check (attempt_count between 0 and 20 and max_attempts between 1 and 20),
  constraint print_jobs_error_length_check check (last_error is null or char_length(last_error) between 1 and 500)
);
create unique index if not exists print_jobs_initial_order_unique
  on public.print_jobs (order_id) where reprint_of_id is null;
create index if not exists print_jobs_queue_idx
  on public.print_jobs (organization_id, stall_id, status, queued_at);
create index if not exists print_jobs_printer_idx
  on public.print_jobs (printer_id, status, next_retry_at);
create index if not exists print_jobs_order_idx
  on public.print_jobs (order_id, created_at desc);

create table if not exists public.cash_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  status public.cash_shift_status not null default 'OPEN',
  opening_amount integer not null,
  system_expected_amount integer,
  counted_amount integer,
  variance_amount integer,
  note text,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  closed_by uuid references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_shifts_opening_amount_check check (opening_amount between 0 and 100000000),
  constraint cash_shifts_counted_amount_check check (counted_amount is null or counted_amount between 0 and 100000000),
  constraint cash_shifts_note_length_check check (note is null or char_length(note) between 1 and 500),
  constraint cash_shifts_close_fields_check check (
    (status = 'OPEN' and closed_at is null and closed_by is null)
    or
    (status = 'CLOSED' and closed_at is not null and closed_by is not null
      and system_expected_amount is not null and counted_amount is not null and variance_amount is not null)
  )
);
create unique index if not exists cash_shifts_one_open_per_stall
  on public.cash_shifts (stall_id) where status = 'OPEN';
create index if not exists cash_shifts_tenant_idx
  on public.cash_shifts (organization_id, stall_id, opened_at desc);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  cash_shift_id uuid not null references public.cash_shifts(id) on delete cascade,
  type public.cash_movement_type not null,
  amount integer not null,
  reason text not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint cash_movements_amount_check check (amount between 1 and 100000000),
  constraint cash_movements_reason_length_check check (char_length(reason) between 1 and 200)
);
create index if not exists cash_movements_shift_idx
  on public.cash_movements (cash_shift_id, created_at);
create index if not exists cash_movements_tenant_idx
  on public.cash_movements (organization_id, stall_id, created_at desc);

create table if not exists public.checkout_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  dining_table_id uuid not null references public.dining_tables(id) on delete restrict,
  payment_option_id uuid references public.payment_options(id) on delete set null,
  discount_option_id uuid references public.discount_options(id) on delete set null,
  method_label text not null,
  discount_label text,
  discount_rate_bps integer,
  subtotal integer not null,
  discount_amount integer not null default 0,
  total integer not null,
  cash_received integer,
  change_amount integer,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint checkout_groups_amounts_check check (
    subtotal >= 0 and discount_amount >= 0 and total >= 0
    and subtotal - discount_amount = total
  ),
  constraint checkout_groups_cash_check check (
    (cash_received is null and change_amount is null)
    or (cash_received >= total and change_amount = cash_received - total)
  ),
  constraint checkout_groups_discount_rate_check check (
    discount_rate_bps is null or discount_rate_bps between 1 and 10000
  )
);
create index if not exists checkout_groups_tenant_idx
  on public.checkout_groups (organization_id, stall_id, created_at desc);
create index if not exists checkout_groups_table_idx
  on public.checkout_groups (dining_table_id, created_at desc);

alter table public.payments
  add column if not exists checkout_group_id uuid references public.checkout_groups(id) on delete set null;
create index if not exists payments_checkout_group_idx
  on public.payments (checkout_group_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'stall_business_hours', 'printers', 'print_jobs', 'cash_shifts',
    'cash_movements', 'checkout_groups'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end
$$;

drop policy if exists stall_business_hours_authorized_select on public.stall_business_hours;
create policy stall_business_hours_authorized_select on public.stall_business_hours
for select to authenticated using (public.can_manage_stall(stall_id));

drop policy if exists printers_authorized_select on public.printers;
create policy printers_authorized_select on public.printers
for select to authenticated using (public.can_view_orders(stall_id));

drop policy if exists print_jobs_authorized_select on public.print_jobs;
create policy print_jobs_authorized_select on public.print_jobs
for select to authenticated using (public.can_view_orders(stall_id));

drop policy if exists cash_shifts_authorized_select on public.cash_shifts;
create policy cash_shifts_authorized_select on public.cash_shifts
for select to authenticated using (public.can_view_stall_financials(stall_id));

drop policy if exists cash_movements_authorized_select on public.cash_movements;
create policy cash_movements_authorized_select on public.cash_movements
for select to authenticated using (public.can_view_stall_financials(stall_id));

drop policy if exists checkout_groups_authorized_select on public.checkout_groups;
create policy checkout_groups_authorized_select on public.checkout_groups
for select to authenticated using (public.can_view_stall_financials(stall_id));

create or replace function public.queue_confirmed_order_print_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer_id uuid;
begin
  if new.status <> 'CONFIRMED'::public.order_status
     or old.status = 'CONFIRMED'::public.order_status
     or not exists (
       select 1 from public.stall_ordering_settings settings
       where settings.stall_id = new.stall_id and settings.print_module_enabled
     ) then
    return null;
  end if;

  select printer.id into v_printer_id
  from public.printers printer
  where printer.stall_id = new.stall_id
    and printer.organization_id = new.organization_id
    and printer.is_enabled
  order by (printer.last_seen_at >= now() - interval '90 seconds') desc,
    printer.last_seen_at desc nulls last, printer.created_at asc
  limit 1;

  insert into public.print_jobs (
    organization_id, stall_id, order_id, printer_id, status, queued_at, created_at, updated_at
  ) values (
    new.organization_id, new.stall_id, new.id, v_printer_id,
    'PENDING'::public.print_job_status, now(), now(), now()
  ) on conflict do nothing;
  return null;
end;
$$;
revoke all on function public.queue_confirmed_order_print_job() from public, anon, authenticated;
grant execute on function public.queue_confirmed_order_print_job() to service_role;

drop trigger if exists orders_queue_print_job on public.orders;
create trigger orders_queue_print_job
after update of status on public.orders
for each row execute function public.queue_confirmed_order_print_job();
