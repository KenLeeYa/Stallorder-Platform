-- Phase 1 trusted manual-billing workflow requests.

alter table public.billing_notifications
  drop constraint if exists billing_notifications_notification_type_check;
alter table public.billing_notifications
  add constraint billing_notifications_notification_type_check check (notification_type in (
    'TRIAL_ENDING_7_DAYS', 'TRIAL_ENDING_3_DAYS', 'TRIAL_ENDING_1_DAY',
    'TRIAL_EXPIRED', 'TRIAL_EXTENDED', 'USAGE_80_PERCENT', 'USAGE_90_PERCENT',
    'USAGE_100_PERCENT', 'USAGE_110_PERCENT', 'INVOICE_CREATED', 'INVOICE_VOIDED',
    'PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED',
    'PAYMENT_OVERDUE', 'SUBSCRIPTION_PAST_DUE', 'SUBSCRIPTION_GRACE_PERIOD',
    'SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_REACTIVATED',
    'ADDITIONAL_STALL_APPROVED', 'ORDER_PACKAGE_ASSIGNED', 'ADD_ON_ASSIGNED',
    'CREDIT_ISSUED', 'BILLING_REQUEST_REJECTED'
  ));

-- Cascading account deletion removes the parent invoice before its line items.
-- Skip recalculation only in that case; ordinary line-item writes still recalculate.
create or replace function public.refresh_invoice_totals_after_line_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if exists (select 1 from public.invoices where id = target_invoice_id) then
    perform public.recalculate_invoice_totals(target_invoice_id);
  end if;
  return coalesce(new, old);
end;
$$;

create table public.billing_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  request_type text not null check (request_type in ('PLAN_CHANGE', 'ADDITIONAL_STALL')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_plan_version_id uuid references public.plan_versions(id) on delete restrict,
  requested_billing_interval text check (requested_billing_interval in ('MONTHLY', 'ANNUAL')),
  requested_quantity integer check (requested_quantity between 1 and 100),
  reason text not null default '' check (char_length(reason) <= 500),
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  decided_by_profile_id uuid references public.profiles(id) on delete restrict,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  invoice_id uuid references public.invoices(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_change_request_payload check (
    (request_type = 'PLAN_CHANGE' and requested_plan_version_id is not null
      and requested_billing_interval is not null and requested_quantity is null)
    or
    (request_type = 'ADDITIONAL_STALL' and requested_plan_version_id is null
      and requested_billing_interval is null and requested_quantity is not null)
  ),
  constraint billing_change_request_decision check (
    (status = 'PENDING' and decided_by_profile_id is null and decided_at is null)
    or
    (status <> 'PENDING' and decided_by_profile_id is not null and decided_at is not null)
  )
);

create unique index billing_change_requests_one_pending_type_idx
  on public.billing_change_requests (organization_id, request_type)
  where status = 'PENDING';
create index billing_change_requests_admin_queue_idx
  on public.billing_change_requests (status, request_type, created_at);
create index billing_change_requests_org_created_idx
  on public.billing_change_requests (organization_id, created_at desc);

create trigger billing_change_requests_touch_updated_at
before update on public.billing_change_requests
for each row execute function public.touch_commercial_updated_at();

alter table public.billing_change_requests enable row level security;
alter table public.billing_change_requests force row level security;

revoke all on public.billing_change_requests from public, anon, authenticated;
grant select, insert on public.billing_change_requests to authenticated;
grant select, insert, update, delete on public.billing_change_requests to service_role;

create policy billing_change_requests_financial_select
on public.billing_change_requests
for select to authenticated
using (
  public.is_platform_admin()
  or public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy billing_change_requests_owner_insert
on public.billing_change_requests
for insert to authenticated
with check (
  status = 'PENDING'
  and public.is_current_profile(requested_by_profile_id)
  and public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);
