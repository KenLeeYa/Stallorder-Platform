-- StallOrder Phase 1 commercial billing core.
-- This migration is additive to the existing commercial tables and preserves
-- every existing subscription, invoice, usage event, and organization.

insert into public.plans (
  code, display_name, base_price, included_stalls, additional_stall_price,
  max_stalls, included_orders, excess_order_price, is_active
) values
  ('TRIAL', '免費試用', 0, 1, null, 1, 100, 0, true),
  ('LITE', 'Lite', 399, 1, null, 1, 500, 0, true),
  ('STANDARD', 'Standard', 699, 1, 299, 10, 2000, 0, true),
  ('PRO', 'Pro', 1190, 3, 199, 50, 10000, 0, true),
  ('ENTERPRISE', 'Enterprise', 2990, 1, null, null, null, 0, true)
on conflict (code) do update set
  display_name = excluded.display_name,
  base_price = excluded.base_price,
  included_stalls = excluded.included_stalls,
  additional_stall_price = excluded.additional_stall_price,
  max_stalls = excluded.max_stalls,
  included_orders = excluded.included_orders,
  excess_order_price = excluded.excess_order_price,
  is_active = excluded.is_active,
  updated_at = now();

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete restrict,
  version integer not null check (version > 0),
  display_name text not null check (char_length(display_name) between 1 and 80),
  billing_interval text not null check (billing_interval in ('TRIAL', 'MONTHLY', 'ANNUAL', 'CUSTOM')),
  base_price integer not null check (base_price >= 0),
  annual_price integer check (annual_price is null or annual_price >= 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  trial_days integer check (trial_days is null or trial_days between 1 and 365),
  included_stalls integer not null check (included_stalls >= 1),
  max_stalls integer check (max_stalls is null or max_stalls >= included_stalls),
  additional_stall_price integer check (additional_stall_price is null or additional_stall_price >= 0),
  max_staff integer check (max_staff is null or max_staff >= 1),
  max_products integer check (max_products is null or max_products >= 1),
  max_qr_codes integer check (max_qr_codes is null or max_qr_codes >= 1),
  included_orders integer check (included_orders is null or included_orders >= 0),
  report_retention_days integer check (report_retention_days is null or report_retention_days >= 1),
  overage_policy text not null check (overage_policy in ('HARD_LIMIT', 'SOFT_LIMIT_MANUAL_BILLING', 'CUSTOM')),
  emergency_hard_cap_enabled boolean not null default false,
  emergency_hard_cap_orders integer check (emergency_hard_cap_orders is null or emergency_hard_cap_orders > 0),
  is_public boolean not null default true,
  requires_quote boolean not null default false,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint plan_versions_effective_window check (effective_until is null or effective_until > effective_from),
  constraint plan_versions_emergency_cap check (
    not emergency_hard_cap_enabled or emergency_hard_cap_orders is not null
  ),
  constraint plan_versions_plan_version_key unique (plan_id, version)
);

create index plan_versions_effective_idx
  on public.plan_versions (plan_id, effective_from desc, effective_until);

insert into public.plan_versions (
  plan_id, version, display_name, billing_interval, base_price, annual_price,
  currency, trial_days, included_stalls, max_stalls, additional_stall_price,
  max_staff, max_products, max_qr_codes, included_orders, report_retention_days,
  overage_policy, is_public, requires_quote
)
select plan.id, catalog.version, catalog.display_name, catalog.billing_interval,
  catalog.base_price, catalog.annual_price, 'TWD', catalog.trial_days,
  catalog.included_stalls, catalog.max_stalls, catalog.additional_stall_price,
  catalog.max_staff, catalog.max_products, catalog.max_qr_codes,
  catalog.included_orders, catalog.report_retention_days, catalog.overage_policy,
  catalog.is_public, catalog.requires_quote
from public.plans plan
join (values
  ('TRIAL', 1, '免費試用', 'TRIAL', 0, 0, 14, 1, 1, null, 2, 50, 1, 100, 14, 'HARD_LIMIT', true, false),
  ('LITE', 1, 'Lite', 'MONTHLY', 399, 3990, null, 1, 1, null, 2, 100, 1, 500, 90, 'SOFT_LIMIT_MANUAL_BILLING', true, false),
  ('STANDARD', 1, 'Standard', 'MONTHLY', 699, 6990, null, 1, 10, 299, 5, 300, 5, 2000, 365, 'SOFT_LIMIT_MANUAL_BILLING', true, false),
  ('PRO', 1, 'Pro', 'MONTHLY', 1190, 11900, null, 3, 50, 199, 15, 1000, 20, 10000, 1095, 'SOFT_LIMIT_MANUAL_BILLING', true, false),
  ('ENTERPRISE', 1, 'Enterprise', 'CUSTOM', 2990, null, null, 1, null, null, null, null, null, null, null, 'CUSTOM', false, true)
) as catalog(
  code, version, display_name, billing_interval, base_price, annual_price,
  trial_days, included_stalls, max_stalls, additional_stall_price, max_staff,
  max_products, max_qr_codes, included_orders, report_retention_days,
  overage_policy, is_public, requires_quote
) on catalog.code = plan.code
on conflict (plan_id, version) do nothing;

create table public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.plan_versions(id) on delete cascade,
  feature_code text not null check (feature_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  is_enabled boolean not null default true,
  limit_value integer,
  configuration_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_entitlements_config_object check (
    configuration_json is null or jsonb_typeof(configuration_json) = 'object'
  ),
  constraint plan_entitlements_version_feature_key unique (plan_version_id, feature_code)
);

create index plan_entitlements_feature_idx
  on public.plan_entitlements (feature_code, is_enabled, plan_version_id);

with feature_catalog(plan_code, feature_code) as (
  values
    ('TRIAL', 'QR_ORDERING'), ('TRIAL', 'MANUAL_CHECKOUT'),
    ('TRIAL', 'BASIC_REPORTS'), ('TRIAL', 'PRODUCT_MANAGEMENT'),
    ('TRIAL', 'SOLD_OUT_CONTROL'),
    ('LITE', 'QR_ORDERING'), ('LITE', 'MANUAL_CHECKOUT'),
    ('LITE', 'BASIC_REPORTS'), ('LITE', 'PRODUCT_MANAGEMENT'),
    ('LITE', 'SOLD_OUT_CONTROL'), ('LITE', 'BUSINESS_HOURS'),
    ('STANDARD', 'QR_ORDERING'), ('STANDARD', 'MANUAL_CHECKOUT'),
    ('STANDARD', 'BASIC_REPORTS'), ('STANDARD', 'PRODUCT_MANAGEMENT'),
    ('STANDARD', 'SOLD_OUT_CONTROL'), ('STANDARD', 'BUSINESS_HOURS'),
    ('STANDARD', 'MODIFIERS'), ('STANDARD', 'KITCHEN_VIEW'),
    ('STANDARD', 'CSV_EXPORT'), ('STANDARD', 'STAFF_ROLES'),
    ('STANDARD', 'MULTIPLE_QR_CODES'), ('STANDARD', 'MULTI_STALL_BASIC'),
    ('STANDARD', 'PRODUCT_SALES_REPORT'), ('STANDARD', 'PAYMENT_REPORT'),
    ('PRO', 'QR_ORDERING'), ('PRO', 'MANUAL_CHECKOUT'),
    ('PRO', 'BASIC_REPORTS'), ('PRO', 'PRODUCT_MANAGEMENT'),
    ('PRO', 'SOLD_OUT_CONTROL'), ('PRO', 'BUSINESS_HOURS'),
    ('PRO', 'MODIFIERS'), ('PRO', 'KITCHEN_VIEW'),
    ('PRO', 'CSV_EXPORT'), ('PRO', 'STAFF_ROLES'),
    ('PRO', 'MULTIPLE_QR_CODES'), ('PRO', 'MULTI_STALL_BASIC'),
    ('PRO', 'PRODUCT_SALES_REPORT'), ('PRO', 'PAYMENT_REPORT'),
    ('PRO', 'MULTI_STALL_DASHBOARD'), ('PRO', 'ADVANCED_REPORTS'),
    ('PRO', 'SCHEDULED_REPORTS'), ('PRO', 'CUSTOM_BRANDING'),
    ('PRO', 'AUDIT_VIEWER'), ('PRO', 'OPERATIONAL_ALERTS'),
    ('PRO', 'BULK_PRODUCT_ASSIGNMENT'), ('PRO', 'BULK_STALL_CONTROL'),
    ('PRO', 'PRIORITY_SUPPORT'),
    ('ENTERPRISE', 'QR_ORDERING'), ('ENTERPRISE', 'MANUAL_CHECKOUT'),
    ('ENTERPRISE', 'BASIC_REPORTS'), ('ENTERPRISE', 'PRODUCT_MANAGEMENT'),
    ('ENTERPRISE', 'SOLD_OUT_CONTROL'), ('ENTERPRISE', 'BUSINESS_HOURS'),
    ('ENTERPRISE', 'MODIFIERS'), ('ENTERPRISE', 'KITCHEN_VIEW'),
    ('ENTERPRISE', 'CSV_EXPORT'), ('ENTERPRISE', 'STAFF_ROLES'),
    ('ENTERPRISE', 'MULTIPLE_QR_CODES'), ('ENTERPRISE', 'MULTI_STALL_BASIC'),
    ('ENTERPRISE', 'MULTI_STALL_DASHBOARD'), ('ENTERPRISE', 'ADVANCED_REPORTS'),
    ('ENTERPRISE', 'SCHEDULED_REPORTS'), ('ENTERPRISE', 'CUSTOM_BRANDING'),
    ('ENTERPRISE', 'AUDIT_VIEWER'), ('ENTERPRISE', 'OPERATIONAL_ALERTS'),
    ('ENTERPRISE', 'BULK_PRODUCT_ASSIGNMENT'), ('ENTERPRISE', 'BULK_STALL_CONTROL'),
    ('ENTERPRISE', 'PRIORITY_SUPPORT')
)
insert into public.plan_entitlements (plan_version_id, feature_code, is_enabled)
select version.id, feature.feature_code, true
from feature_catalog feature
join public.plans plan on plan.code = feature.plan_code
join public.plan_versions version on version.plan_id = plan.id and version.version = 1
on conflict (plan_version_id, feature_code) do nothing;

alter table public.subscriptions
  add column plan_version_id uuid references public.plan_versions(id) on delete restrict,
  add column billing_interval text not null default 'MONTHLY'
    check (billing_interval in ('TRIAL', 'MONTHLY', 'ANNUAL', 'CUSTOM')),
  add column trial_started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column payment_due_at timestamptz,
  add column past_due_at timestamptz,
  add column grace_period_ends_at timestamptz,
  add column suspended_at timestamptz,
  add column cancelled_at timestamptz,
  add column reactivated_at timestamptz,
  add constraint subscriptions_trial_window check (
    trial_ends_at is null or (trial_started_at is not null and trial_ends_at > trial_started_at)
  ),
  add constraint subscriptions_grace_window check (
    grace_period_ends_at is null or past_due_at is null or grace_period_ends_at > past_due_at
  );

update public.subscriptions subscription
set plan_version_id = version.id,
    billing_interval = case when plan.code = 'TRIAL' then 'TRIAL' else 'MONTHLY' end,
    trial_started_at = case when subscription.status = 'TRIALING' then subscription.created_at else null end,
    trial_ends_at = case when subscription.status = 'TRIALING' then subscription.created_at + interval '14 days' else null end,
    payment_due_at = subscription.billing_period_end::timestamp at time zone 'Asia/Taipei'
from public.plans plan
join public.plan_versions version on version.plan_id = plan.id and version.version = 1
where subscription.plan_id = plan.id;

alter table public.subscriptions alter column plan_version_id set not null;
create index subscriptions_plan_version_status_idx
  on public.subscriptions (plan_version_id, status);
create index subscriptions_trial_expiry_idx
  on public.subscriptions (status, trial_ends_at)
  where status = 'TRIALING';

create or replace function public.resolve_subscription_plan_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  resolved_version public.plan_versions;
begin
  if new.plan_version_id is not null then
    select * into resolved_version
    from public.plan_versions version
    where version.id = new.plan_version_id;
    if resolved_version.id is null or resolved_version.plan_id <> new.plan_id then
      raise exception 'SUBSCRIPTION_PLAN_VERSION_MISMATCH';
    end if;
  else
    select * into resolved_version
    from public.plan_versions version
    where version.plan_id = new.plan_id
      and version.effective_from <= now()
      and (version.effective_until is null or version.effective_until > now())
    order by version.version desc
    limit 1;
    if resolved_version.id is null then
      raise exception 'SUBSCRIPTION_PLAN_VERSION_REQUIRED';
    end if;
    new.plan_version_id := resolved_version.id;
  end if;

  if new.status = 'TRIALING' then
    new.trial_started_at := coalesce(new.trial_started_at, now());
    new.trial_ends_at := coalesce(
      new.trial_ends_at,
      new.trial_started_at + make_interval(days => coalesce(resolved_version.trial_days, 14))
    );
  end if;
  if resolved_version.billing_interval = 'TRIAL' then
    new.billing_interval := 'TRIAL';
  end if;
  return new;
end;
$$;

create trigger subscriptions_resolve_plan_version_before_write
before insert or update of plan_id, plan_version_id, status on public.subscriptions
for each row execute function public.resolve_subscription_plan_version();

create table public.add_on_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  display_name text not null check (char_length(display_name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  billing_type text not null check (billing_type in ('MONTHLY', 'PER_STALL_MONTHLY', 'ONE_TIME', 'CUSTOM')),
  unit_price integer not null check (unit_price >= 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  feature_code text check (feature_code is null or feature_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  availability_status text not null default 'MANUAL_APPROVAL_REQUIRED'
    check (availability_status in ('ENABLED', 'MANUAL_APPROVAL_REQUIRED', 'COMING_SOON')),
  is_active boolean not null default true,
  is_public boolean not null default true,
  requires_manual_approval boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.add_on_catalog (
  code, display_name, description, billing_type, unit_price, feature_code,
  availability_status, is_public, requires_manual_approval
) values
  ('ADDITIONAL_STALL_STANDARD', 'Standard 額外攤位', '由平台管理員人工核准。', 'PER_STALL_MONTHLY', 299, 'MULTI_STALL_BASIC', 'ENABLED', true, true),
  ('ADDITIONAL_STALL_PRO', 'Pro 額外攤位', '由平台管理員人工核准。', 'PER_STALL_MONTHLY', 199, 'MULTI_STALL_BASIC', 'ENABLED', true, true),
  ('CUSTOM_DOMAIN', '自訂網域', 'Phase 1 僅接受人工評估，不執行自動設定。', 'MONTHLY', 199, 'CUSTOM_DOMAIN', 'MANUAL_APPROVAL_REQUIRED', true, true),
  ('PRINTER_INTEGRATION', '列印整合', '訂閱自動化尚未啟用。', 'PER_STALL_MONTHLY', 199, 'PRINTER_INTEGRATION', 'COMING_SOON', true, true),
  ('SCHEDULED_REPORTS', '排程報表', '訂閱自動化尚未啟用。', 'MONTHLY', 99, 'SCHEDULED_REPORTS', 'COMING_SOON', true, true),
  ('WHITE_LABEL', 'White Label', 'Phase 1 僅接受人工評估。', 'MONTHLY', 499, 'WHITE_LABEL', 'MANUAL_APPROVAL_REQUIRED', true, true),
  ('API_ACCESS', 'API Access', 'Phase 1 不自動開通。', 'CUSTOM', 0, 'API_ACCESS', 'MANUAL_APPROVAL_REQUIRED', false, true),
  ('CUSTOM_SERVICE', '客製服務', '由平台管理員建立人工報價項目。', 'CUSTOM', 0, null, 'ENABLED', false, true),
  ('ORDER_PACKAGE_LITE_100', 'Lite 100 筆訂單包', '人工指派 100 筆額度。', 'ONE_TIME', 100, null, 'ENABLED', true, true),
  ('ORDER_PACKAGE_STANDARD_500', 'Standard 500 筆訂單包', '人工指派 500 筆額度。', 'ONE_TIME', 250, null, 'ENABLED', true, true),
  ('ORDER_PACKAGE_PRO_1000', 'Pro 1,000 筆訂單包', '人工指派 1,000 筆額度。', 'ONE_TIME', 300, null, 'ENABLED', true, true)
on conflict (code) do nothing;

create table public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  item_type text not null check (item_type in (
    'BASE_PLAN', 'ADDITIONAL_STALL', 'ORDER_PACKAGE', 'ADD_ON',
    'CUSTOM_SERVICE', 'CREDIT', 'DISCOUNT'
  )),
  reference_id text check (reference_id is null or char_length(reference_id) <= 160),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  description text not null check (char_length(description) between 1 and 300),
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price >= 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'ACTIVE' check (status in ('PENDING', 'ACTIVE', 'ENDED', 'CANCELLED')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_items_active_window check (ends_at is null or ends_at > starts_at)
);

create index subscription_items_subscription_status_idx
  on public.subscription_items (subscription_id, status, starts_at);
create index subscription_items_org_code_idx
  on public.subscription_items (organization_id, code, status);

insert into public.subscription_items (
  organization_id, subscription_id, item_type, reference_id, code, description,
  quantity, unit_price, currency, status, starts_at
)
select subscription.organization_id, subscription.id, 'BASE_PLAN', version.id::text,
  plan.code, version.display_name, 1,
  case when subscription.billing_interval = 'ANNUAL'
    then coalesce(version.annual_price, version.base_price)
    else version.base_price
  end,
  version.currency, 'ACTIVE', subscription.created_at
from public.subscriptions subscription
join public.plan_versions version on version.id = subscription.plan_version_id
join public.plans plan on plan.id = version.plan_id
where not exists (
  select 1 from public.subscription_items item
  where item.subscription_id = subscription.id and item.item_type = 'BASE_PLAN' and item.status = 'ACTIVE'
);

alter table public.invoices drop constraint if exists invoices_total_consistent;
alter table public.invoices rename column total to total_amount;
alter table public.invoices
  add column discount_amount integer not null default 0 check (discount_amount >= 0),
  add column tax_amount integer not null default 0 check (tax_amount >= 0),
  add column amount_paid integer not null default 0 check (amount_paid >= 0),
  add column amount_due integer not null default 0 check (amount_due >= 0),
  add column due_at timestamptz,
  add column voided_at timestamptz,
  add column cancelled_at timestamptz;

update public.invoices
set status = case when status = 'ISSUED' then 'OPEN' else status end,
    amount_paid = case when status = 'PAID' then total_amount else 0 end,
    amount_due = case when status = 'PAID' then 0 else total_amount end,
    due_at = coalesce(issued_at + interval '14 days', billing_period_end::timestamp at time zone 'Asia/Taipei');

alter table public.invoices alter column due_at set not null;
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('DRAFT', 'OPEN', 'PAID', 'VOID', 'OVERDUE', 'CANCELLED'));
alter table public.invoices add constraint invoices_amount_formula check (
  subtotal + tax_amount - discount_amount = total_amount
  and total_amount - amount_paid = amount_due
  and amount_paid <= total_amount
  and discount_amount <= subtotal + tax_amount
);
alter table public.invoices add constraint invoices_status_timestamps check (
  (status <> 'PAID' or paid_at is not null)
  and (status <> 'VOID' or voided_at is not null)
  and (status <> 'CANCELLED' or cancelled_at is not null)
);
create index invoices_due_status_idx on public.invoices (status, due_at)
  where status in ('OPEN', 'OVERDUE');

create sequence public.invoice_number_seq;

create or replace function public.next_invoice_number(p_issued_at timestamptz default now())
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select 'SO-' || to_char(p_issued_at at time zone 'Asia/Taipei', 'YYYYMM') || '-'
    || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_invoice_number(timestamptz) from public, anon, authenticated;
grant execute on function public.next_invoice_number(timestamptz) to service_role;
alter table public.invoices alter column invoice_number set default public.next_invoice_number();

alter table public.invoice_line_items drop constraint if exists invoice_line_item_amount;
alter table public.invoice_line_items drop constraint if exists invoice_line_items_line_type_check;
alter table public.invoice_line_items rename column line_type to item_type;
alter table public.invoice_line_items rename column unit_amount to unit_price;
alter table public.invoice_line_items rename column amount to subtotal;
alter table public.invoice_line_items
  add column code text,
  add column metadata_json jsonb,
  add constraint invoice_line_items_type_check check (item_type in (
    'BASE_PLAN', 'ADDITIONAL_STALL', 'EXCESS_ORDER', 'ORDER_PACKAGE',
    'ADD_ON', 'CUSTOM_SERVICE', 'CREDIT', 'DISCOUNT'
  )),
  add constraint invoice_line_items_subtotal check (subtotal = quantity * unit_price),
  add constraint invoice_line_items_metadata_object check (
    metadata_json is null or jsonb_typeof(metadata_json) = 'object'
  );

update public.invoice_line_items
set code = case item_type
  when 'BASE_PLAN' then 'BASE_PLAN'
  when 'ADDITIONAL_STALL' then 'ADDITIONAL_STALL'
  when 'EXCESS_ORDER' then 'EXCESS_ORDER'
  when 'ADD_ON' then 'ADD_ON'
  else 'CUSTOM_SERVICE'
end
where code is null;

alter table public.invoice_line_items alter column code set not null;
alter table public.invoice_line_items add constraint invoice_line_items_code_format
  check (code ~ '^[A-Z][A-Z0-9_]{1,79}$');
drop index if exists public.invoice_line_items_org_type_idx;
create index invoice_line_items_org_type_idx
  on public.invoice_line_items (organization_id, item_type, created_at);

create or replace function public.recalculate_invoice_totals(p_invoice_id uuid)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.invoices;
  charge_total integer;
  discount_total integer;
begin
  select * into target from public.invoices where id = p_invoice_id for update;
  if target.id is null then
    raise exception 'INVOICE_NOT_FOUND';
  end if;
  if target.status not in ('DRAFT', 'OPEN', 'OVERDUE') then
    raise exception 'INVOICE_NOT_EDITABLE';
  end if;

  select
    coalesce(sum(item.subtotal) filter (where item.item_type not in ('CREDIT', 'DISCOUNT')), 0)::integer,
    coalesce(sum(item.subtotal) filter (where item.item_type in ('CREDIT', 'DISCOUNT')), 0)::integer
  into charge_total, discount_total
  from public.invoice_line_items item
  where item.invoice_id = p_invoice_id;

  if discount_total > charge_total + target.tax_amount then
    raise exception 'INVOICE_DISCOUNT_EXCEEDS_TOTAL';
  end if;

  update public.invoices invoice
  set subtotal = charge_total,
      discount_amount = discount_total,
      total_amount = charge_total + invoice.tax_amount - discount_total,
      amount_due = charge_total + invoice.tax_amount - discount_total - invoice.amount_paid,
      updated_at = now()
  where invoice.id = p_invoice_id
  returning * into target;
  return target;
end;
$$;

revoke all on function public.recalculate_invoice_totals(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_invoice_totals(uuid) to service_role;

create or replace function public.refresh_invoice_totals_after_line_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.recalculate_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end;
$$;

create trigger invoice_line_items_refresh_totals_after_write
after insert or update or delete on public.invoice_line_items
for each row execute function public.refresh_invoice_totals_after_line_item();

create table public.manual_payment_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_method text not null check (payment_method in ('BANK_TRANSFER', 'CASH', 'LINE_PAY_MANUAL', 'OTHER')),
  amount integer not null check (amount > 0),
  currency text not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  reference_number text check (reference_number is null or char_length(reference_number) <= 120),
  bank_last_five text check (bank_last_five is null or bank_last_five ~ '^[0-9]{5}$'),
  received_at timestamptz not null,
  recorded_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  verified_by_profile_id uuid references public.profiles(id) on delete restrict,
  verification_status text not null default 'PENDING_VERIFICATION'
    check (verification_status in ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'VOIDED')),
  note text check (note is null or char_length(note) <= 1000),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  verified_at timestamptz,
  rejected_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manual_payment_bank_fields check (
    bank_last_five is null or payment_method = 'BANK_TRANSFER'
  ),
  constraint manual_payment_status_timestamps check (
    (verification_status <> 'VERIFIED' or (verified_by_profile_id is not null and verified_at is not null))
    and (verification_status <> 'REJECTED' or (verified_by_profile_id is not null and rejected_at is not null))
    and (verification_status <> 'VOIDED' or voided_at is not null)
  ),
  constraint manual_payment_idempotency_key unique (organization_id, idempotency_key)
);

create index manual_payment_invoice_status_idx
  on public.manual_payment_records (invoice_id, verification_status, created_at);
create index manual_payment_org_status_idx
  on public.manual_payment_records (organization_id, verification_status, received_at desc);

alter table public.usage_events add column reference_type text;
alter table public.usage_events drop constraint if exists usage_events_event_type_check;
alter table public.usage_events add constraint usage_events_event_type_check check (event_type in (
  'ORDER_CREATED', 'BILLABLE_ORDER_COMPLETED', 'ACTIVE_STALL_CHANGED',
  'STAFF_MEMBERSHIP_CHANGED', 'QR_CODE_CREATED', 'CSV_EXPORTED'
));
alter table public.usage_events add constraint usage_events_reference_type_format check (
  reference_type is null or reference_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
);
create unique index usage_events_billable_order_unique_idx
  on public.usage_events (event_type, reference_id)
  where event_type = 'BILLABLE_ORDER_COMPLETED' and reference_id is not null;

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select orders.organization_id, orders.stall_id, 'BILLABLE_ORDER_COMPLETED', 1,
  date_trunc('month', coalesce(orders.completed_at, orders.updated_at) at time zone stall.timezone)::date,
  'ORDER', orders.id::text, coalesce(orders.completed_at, orders.updated_at)
from public.orders orders
join public.stalls stall on stall.id = orders.stall_id
where orders.status = 'COMPLETED'::public.order_status
on conflict do nothing;

create table public.billing_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_period date not null check (extract(day from billing_period) = 1),
  billable_order_count integer not null default 0 check (billable_order_count >= 0),
  active_stall_count integer not null default 0 check (active_stall_count >= 0),
  active_staff_count integer not null default 0 check (active_staff_count >= 0),
  qr_code_count integer not null default 0 check (qr_code_count >= 0),
  csv_export_count integer not null default 0 check (csv_export_count >= 0),
  storage_bytes bigint check (storage_bytes is null or storage_bytes >= 0),
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_usage_summary_period_key unique (organization_id, billing_period)
);

create index billing_usage_summaries_period_idx
  on public.billing_usage_summaries (billing_period, billable_order_count desc);

create table public.billing_feature_flags (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,99}$'),
  is_enabled boolean not null default false,
  phase integer not null check (phase between 1 and 3),
  description text not null check (char_length(description) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_feature_flags (code, is_enabled, phase, description) values
  ('MANUAL_BILLING_ENABLED', true, 1, 'Phase 1 人工 Invoice 與付款流程。'),
  ('AUTOMATED_BILLING_ENABLED', false, 2, '外部金流自動收款總開關。'),
  ('ECPAY_BILLING_ENABLED', false, 2, 'ECPay recurring billing。'),
  ('NEWEBPAY_BILLING_ENABLED', false, 2, 'NewebPay recurring billing。'),
  ('E_INVOICE_ENABLED', false, 2, '電子發票服務。'),
  ('EMAIL_BILLING_NOTIFICATIONS_ENABLED', false, 2, '帳務 Email 通知。'),
  ('AUTOMATIC_DUNNING_ENABLED', false, 3, '自動催收。'),
  ('AUTOMATIC_RENEWAL_ENABLED', false, 2, '自動續約。'),
  ('AUTOMATIC_OVERAGE_BILLING_ENABLED', false, 2, '超額自動計費。'),
  ('COUPONS_ENABLED', false, 3, '優惠券與促銷碼。'),
  ('PRORATION_ENABLED', false, 3, '按比例計費。'),
  ('CUSTOMER_BILLING_PORTAL_ENABLED', false, 3, '客戶自助帳務入口。'),
  ('RESELLER_BILLING_ENABLED', false, 3, '經銷商計費。'),
  ('PARTNER_BILLING_ENABLED', false, 3, '合作夥伴計費。'),
  ('BILLING_ANALYTICS_ADVANCED_ENABLED', false, 3, 'MRR/ARR/ARPU/Churn。')
on conflict (code) do nothing;

create table public.billing_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_type text not null check (notification_type in (
    'TRIAL_ENDING_7_DAYS', 'TRIAL_ENDING_3_DAYS', 'TRIAL_ENDING_1_DAY',
    'TRIAL_EXPIRED', 'USAGE_80_PERCENT', 'USAGE_90_PERCENT',
    'USAGE_100_PERCENT', 'USAGE_110_PERCENT', 'INVOICE_CREATED',
    'PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED', 'PAYMENT_REJECTED',
    'PAYMENT_OVERDUE', 'SUBSCRIPTION_PAST_DUE',
    'SUBSCRIPTION_GRACE_PERIOD', 'SUBSCRIPTION_SUSPENDED',
    'SUBSCRIPTION_REACTIVATED'
  )),
  severity text not null default 'INFO' check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  status text not null default 'UNREAD' check (status in ('UNREAD', 'READ', 'DISMISSED')),
  title text not null check (char_length(title) between 1 and 160),
  message text not null check (char_length(message) between 1 and 1000),
  entity_type text,
  entity_id uuid,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200),
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  dismissed_at timestamptz,
  constraint billing_notifications_metadata_object check (
    metadata_json is null or jsonb_typeof(metadata_json) = 'object'
  )
);

create unique index billing_notifications_dedupe_idx
  on public.billing_notifications (organization_id, dedupe_key)
  where dedupe_key is not null;
create index billing_notifications_org_status_idx
  on public.billing_notifications (organization_id, status, created_at desc);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_notification_id uuid not null references public.billing_notifications(id) on delete cascade,
  channel text not null check (channel in ('IN_APP', 'EMAIL')),
  status text not null default 'PENDING' check (status in ('PENDING', 'DELIVERED', 'FAILED', 'CANCELLED')),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_delivery_key unique (billing_notification_id, channel)
);

create index notification_outbox_pending_idx
  on public.notification_outbox (status, available_at)
  where status = 'PENDING';

create or replace function public.enforce_billing_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  expected_organization_id uuid;
begin
  if tg_table_name = 'subscription_items' then
    select subscription.organization_id into expected_organization_id
    from public.subscriptions subscription where subscription.id = new.subscription_id;
  elsif tg_table_name = 'manual_payment_records' then
    select invoice.organization_id into expected_organization_id
    from public.invoices invoice where invoice.id = new.invoice_id;
  elsif tg_table_name = 'notification_outbox' then
    select notification.organization_id into expected_organization_id
    from public.billing_notifications notification where notification.id = new.billing_notification_id;
  else
    expected_organization_id := new.organization_id;
  end if;

  if expected_organization_id is null or new.organization_id <> expected_organization_id then
    raise exception 'BILLING_ORGANIZATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger subscription_items_scope_before_write
before insert or update on public.subscription_items
for each row execute function public.enforce_billing_scope();
create trigger manual_payment_records_scope_before_write
before insert or update on public.manual_payment_records
for each row execute function public.enforce_billing_scope();
create trigger billing_usage_summaries_scope_before_write
before insert or update on public.billing_usage_summaries
for each row execute function public.enforce_billing_scope();
create trigger billing_notifications_scope_before_write
before insert or update on public.billing_notifications
for each row execute function public.enforce_billing_scope();
create trigger notification_outbox_scope_before_write
before insert or update on public.notification_outbox
for each row execute function public.enforce_billing_scope();

create trigger plan_entitlements_touch_updated_at
before update on public.plan_entitlements
for each row execute function public.touch_commercial_updated_at();
create trigger add_on_catalog_touch_updated_at
before update on public.add_on_catalog
for each row execute function public.touch_commercial_updated_at();
create trigger subscription_items_touch_updated_at
before update on public.subscription_items
for each row execute function public.touch_commercial_updated_at();
create trigger manual_payment_records_touch_updated_at
before update on public.manual_payment_records
for each row execute function public.touch_commercial_updated_at();
create trigger billing_usage_summaries_touch_updated_at
before update on public.billing_usage_summaries
for each row execute function public.touch_commercial_updated_at();
create trigger billing_feature_flags_touch_updated_at
before update on public.billing_feature_flags
for each row execute function public.touch_commercial_updated_at();
create trigger notification_outbox_touch_updated_at
before update on public.notification_outbox
for each row execute function public.touch_commercial_updated_at();

alter table public.plan_versions enable row level security;
alter table public.plan_versions force row level security;
alter table public.plan_entitlements enable row level security;
alter table public.plan_entitlements force row level security;
alter table public.add_on_catalog enable row level security;
alter table public.add_on_catalog force row level security;
alter table public.subscription_items enable row level security;
alter table public.subscription_items force row level security;
alter table public.manual_payment_records enable row level security;
alter table public.manual_payment_records force row level security;
alter table public.billing_usage_summaries enable row level security;
alter table public.billing_usage_summaries force row level security;
alter table public.billing_feature_flags enable row level security;
alter table public.billing_feature_flags force row level security;
alter table public.billing_notifications enable row level security;
alter table public.billing_notifications force row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;

revoke all on public.plan_versions, public.plan_entitlements, public.add_on_catalog,
  public.subscription_items, public.manual_payment_records,
  public.billing_usage_summaries, public.billing_feature_flags,
  public.billing_notifications, public.notification_outbox
  from public, anon, authenticated;

grant select on public.plan_versions, public.plan_entitlements, public.add_on_catalog,
  public.subscription_items, public.manual_payment_records,
  public.billing_usage_summaries, public.billing_notifications
  to authenticated;
grant insert on public.manual_payment_records to authenticated;
grant select, insert, update, delete on public.plan_versions, public.plan_entitlements,
  public.add_on_catalog, public.subscription_items, public.manual_payment_records,
  public.billing_usage_summaries, public.billing_feature_flags,
  public.billing_notifications, public.notification_outbox
  to service_role;
grant usage, select on sequence public.invoice_number_seq to service_role;

create policy plan_versions_catalog_select on public.plan_versions
for select to authenticated using (
  public.is_platform_admin()
  or (
    is_public
    and effective_from <= now()
    and (effective_until is null or effective_until > now())
  )
  or exists (
    select 1 from public.subscriptions subscription
    where subscription.plan_version_id = plan_versions.id
      and public.has_organization_role(
        subscription.organization_id,
        array[
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role,
          'FINANCE_VIEWER'::public.user_role
        ]
      )
  )
);

create policy plan_entitlements_catalog_select on public.plan_entitlements
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.plan_versions version
    where version.id = plan_entitlements.plan_version_id
      and version.is_public
      and version.effective_from <= now()
      and (version.effective_until is null or version.effective_until > now())
  )
  or exists (
    select 1 from public.subscriptions subscription
    where subscription.plan_version_id = plan_entitlements.plan_version_id
      and public.has_organization_role(
        subscription.organization_id,
        array[
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role,
          'FINANCE_VIEWER'::public.user_role
        ]
      )
  )
);

create policy add_on_catalog_select on public.add_on_catalog
for select to authenticated using (public.is_platform_admin() or (is_active and is_public));

create policy subscription_items_financial_select on public.subscription_items
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy manual_payment_records_financial_select on public.manual_payment_records
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create or replace function public.is_current_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = p_profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.is_active
  );
$$;

revoke all on function public.is_current_profile(uuid) from public, anon;
grant execute on function public.is_current_profile(uuid) to authenticated, service_role;

create policy manual_payment_records_owner_insert on public.manual_payment_records
for insert to authenticated with check (
  verification_status = 'PENDING_VERIFICATION'
  and verified_by_profile_id is null
  and public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
  and public.is_current_profile(recorded_by_profile_id)
);

create policy billing_usage_summaries_financial_select on public.billing_usage_summaries
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

create policy billing_notifications_financial_select on public.billing_notifications
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);
