-- PAYG pricing, per-stall usage, refund credits, and guarded open-beta access.
-- Existing plans, subscriptions, invoices, and usage events remain immutable.

alter table public.plans
  add column pricing_mode text not null default 'FIXED',
  add column usage_unit_price integer not null default 0,
  add column usage_metric text,
  add column usage_scope text,
  add column monthly_cap_amount integer,
  add column minimum_charge integer not null default 0;

alter table public.plans
  add constraint plans_pricing_mode_check
    check (pricing_mode in ('FIXED', 'USAGE', 'USAGE_PER_STALL_CAPPED', 'CUSTOM')),
  add constraint plans_usage_pricing_amounts_check
    check (
      usage_unit_price >= 0
      and minimum_charge >= 0
      and (monthly_cap_amount is null or monthly_cap_amount >= minimum_charge)
    ),
  add constraint plans_usage_pricing_contract_check
    check (
      pricing_mode not in ('USAGE', 'USAGE_PER_STALL_CAPPED')
      or (usage_metric is not null and usage_scope is not null)
    );

alter table public.plan_versions
  add column pricing_mode text not null default 'FIXED',
  add column usage_unit_price integer not null default 0,
  add column usage_metric text,
  add column usage_scope text,
  add column monthly_cap_amount integer,
  add column minimum_charge integer not null default 0;

alter table public.plan_versions
  add constraint plan_versions_pricing_mode_check
    check (pricing_mode in ('FIXED', 'USAGE', 'USAGE_PER_STALL_CAPPED', 'CUSTOM')),
  add constraint plan_versions_usage_pricing_amounts_check
    check (
      usage_unit_price >= 0
      and minimum_charge >= 0
      and (monthly_cap_amount is null or monthly_cap_amount >= minimum_charge)
    ),
  add constraint plan_versions_usage_pricing_contract_check
    check (
      pricing_mode not in ('USAGE', 'USAGE_PER_STALL_CAPPED')
      or (usage_metric is not null and usage_scope is not null)
    );

alter table public.subscriptions
  add column pricing_effective_at timestamptz;

alter table public.invoices
  add column plan_version_id uuid references public.plan_versions(id) on delete restrict,
  add column pricing_mode text,
  add column pricing_snapshot_json jsonb;

do $$
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

    with historical_invoice_contracts as (
      select distinct on (line_item.invoice_id)
        line_item.invoice_id,
        version.id as plan_version_id,
        version.pricing_mode,
        jsonb_build_object(
          'planVersionId', version.id,
          'planCode', plan.code,
          'planVersion', version.version,
          'pricingMode', version.pricing_mode,
          'currency', version.currency,
          'baseFee', version.base_price,
          'usageUnitPrice', version.usage_unit_price,
          'usageMetric', version.usage_metric,
          'usageScope', version.usage_scope,
          'monthlyCapAmount', version.monthly_cap_amount,
          'minimumCharge', version.minimum_charge
        ) as pricing_snapshot_json
      from public.invoice_line_items line_item
      join public.plan_versions version on version.id::text = line_item.reference_id
      join public.plans plan on plan.id = version.plan_id
      where line_item.item_type = 'BASE_PLAN'
      order by line_item.invoice_id, line_item.created_at desc, line_item.id desc
    )
    update public.invoices invoice
    set plan_version_id = contract.plan_version_id,
        pricing_mode = contract.pricing_mode,
        pricing_snapshot_json = contract.pricing_snapshot_json
    from historical_invoice_contracts contract
    where invoice.id = contract.invoice_id
      and invoice.plan_version_id is null;

    if exists (
      select 1
      from public.invoices invoice
      join (
        select distinct on (line_item.invoice_id)
          line_item.invoice_id,
          version.id as plan_version_id
        from public.invoice_line_items line_item
        join public.plan_versions version on version.id::text = line_item.reference_id
        where line_item.item_type = 'BASE_PLAN'
        order by line_item.invoice_id, line_item.created_at desc, line_item.id desc
      ) contract on contract.invoice_id = invoice.id
      where invoice.plan_version_id is distinct from contract.plan_version_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'PAYG_INVOICE_PRICING_BACKFILL_MISMATCH';
    end if;
  end if;
end;
$$;

alter table public.invoices
  add constraint invoices_pricing_mode_check
    check (pricing_mode is null or pricing_mode in ('FIXED', 'USAGE', 'USAGE_PER_STALL_CAPPED', 'CUSTOM')),
  add constraint invoices_pricing_snapshot_object_check
    check (pricing_snapshot_json is null or jsonb_typeof(pricing_snapshot_json) = 'object');

create index invoices_plan_version_period_idx
  on public.invoices (plan_version_id, billing_period_start, billing_period_end);

do $$
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

insert into public.billing_feature_flags (code, is_enabled, phase, description) values
  ('OPEN_BETA_FREE_ACCESS_ENABLED', true, 1, '開放測試期間允許免費使用；保留可信用量，不自動關帳。'),
  ('MERCHANT_BILLING_VISIBLE', false, 1, '控制商家端訂閱、帳單與付款入口是否可見。'),
  ('PAYG_BILLING_ENABLED', false, 2, 'PAYG 計價與人工對帳核心總開關。'),
  ('PAYG_NEW_MERCHANTS_ENABLED', false, 2, '新商家 Trial 結束後可轉入 PAYG。'),
  ('PAYG_LEGACY_MIGRATION_ENABLED', false, 2, '允許平台管理員明確遷移舊方案至 PAYG。'),
  ('PAYG_REFUND_CREDITS_ENABLED', false, 2, 'PAYG 關帳採計完整退款負向用量。'),
  ('PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED', false, 3, '允許 PAYG 自動關帳；開放測試期間禁止啟用。')
on conflict (code) do nothing;

insert into public.plans (
  code, display_name, base_price, included_stalls, additional_stall_price,
  max_stalls, included_orders, excess_order_price, pricing_mode,
  usage_unit_price, usage_metric, usage_scope, monthly_cap_amount,
  minimum_charge, is_active
) values (
  'PAYG', 'Stallorder', 0, 1, 0,
  null, null, 0, 'USAGE_PER_STALL_CAPPED',
  1, 'NET_BILLABLE_COMPLETED_ORDER', 'STALL', 1499,
  0, true
)
on conflict (code) do nothing;

insert into public.plan_versions (
  plan_id, version, display_name, billing_interval, base_price, annual_price,
  currency, trial_days, included_stalls, max_stalls, additional_stall_price,
  max_staff, max_products, max_qr_codes, included_orders, report_retention_days,
  overage_policy, pricing_mode, usage_unit_price, usage_metric, usage_scope,
  monthly_cap_amount, minimum_charge, is_public, requires_quote
)
select
  plan.id, 1, 'Stallorder', 'MONTHLY', 0, null,
  'TWD', null, 1, null, 0,
  null, null, null, null, 1095,
  'CUSTOM', 'USAGE_PER_STALL_CAPPED', 1,
  'NET_BILLABLE_COMPLETED_ORDER', 'STALL', 1499, 0, true, false
from public.plans plan
where plan.code = 'PAYG'
on conflict (plan_id, version) do nothing;

  if not exists (
    select 1
    from public.plans plan
    join public.plan_versions version on version.plan_id = plan.id and version.version = 1
    where plan.code = 'PAYG'
      and plan.base_price = 0
      and plan.pricing_mode = 'USAGE_PER_STALL_CAPPED'
      and plan.usage_unit_price = 1
      and plan.usage_metric = 'NET_BILLABLE_COMPLETED_ORDER'
      and plan.usage_scope = 'STALL'
      and plan.monthly_cap_amount = 1499
      and plan.minimum_charge = 0
      and version.base_price = 0
      and version.currency = 'TWD'
      and version.pricing_mode = 'USAGE_PER_STALL_CAPPED'
      and version.usage_unit_price = 1
      and version.usage_metric = 'NET_BILLABLE_COMPLETED_ORDER'
      and version.usage_scope = 'STALL'
      and version.monthly_cap_amount = 1499
      and version.minimum_charge = 0
  ) then
    raise exception using errcode = 'P0001', message = 'PAYG_PRICING_CONTRACT_MISMATCH';
  end if;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select
  payg_version.id,
  feature.feature_code,
  feature.feature_code in (
    'AUDIT_VIEWER', 'BASIC_REPORTS', 'BULK_PRODUCT_ASSIGNMENT',
    'BULK_STALL_CONTROL', 'BUSINESS_HOURS', 'CAPACITY_CONTROL',
    'CASH_RECONCILIATION', 'CASH_SHIFT', 'CDS', 'CSV_EXPORT', 'KDS',
    'KITCHEN_VIEW', 'MANUAL_CHECKOUT', 'MODIFIERS', 'MULTI_STALL_BASIC',
    'MULTI_STALL_DASHBOARD', 'MULTIPLE_QR_CODES', 'OPERATIONAL_ALERTS',
    'PAYMENT_REPORT', 'PRODUCT_MANAGEMENT', 'PRODUCT_SALES_REPORT',
    'QR_ORDERING', 'SCHEDULED_REPORTS', 'SOLD_OUT_CONTROL', 'STAFF_ROLES',
    'STALL_LOCATION', 'STALL_SCHEDULE', 'WAIT_TIME_QUOTE'
  ),
  feature.limit_value,
  feature.configuration_json
from public.plan_versions payg_version
join public.plans payg_plan
  on payg_plan.id = payg_version.plan_id and payg_plan.code = 'PAYG'
cross join (
  select entitlement.feature_code, entitlement.limit_value, entitlement.configuration_json
  from public.plan_entitlements entitlement
  join public.plan_versions source_version
    on source_version.id = entitlement.plan_version_id and source_version.version = 1
  join public.plans source_plan
    on source_plan.id = source_version.plan_id and source_plan.code = 'PRO'
) feature
where payg_version.version = 1
on conflict (plan_version_id, feature_code) do nothing;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select
  version.id, 'PRINTER_INTEGRATION', true, null,
  '{"merchantModuleOptIn":true}'::jsonb
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id and plan.code = 'PAYG'
where version.version = 1
on conflict (plan_version_id, feature_code) do nothing;

update public.plan_versions version
set is_public = false
from public.plans plan
where plan.id = version.plan_id
  and plan.code in ('LITE', 'STANDARD', 'PRO')
  and version.is_public;

update public.add_on_catalog
set is_public = false,
    updated_at = now()
where code in (
  'ADDITIONAL_STALL_STANDARD', 'ADDITIONAL_STALL_PRO',
  'ORDER_PACKAGE_LITE_100', 'ORDER_PACKAGE_STANDARD_500',
  'ORDER_PACKAGE_PRO_1000'
)
  and is_public;

  end if;
end;
$$;

alter table public.usage_events
  drop constraint if exists usage_events_event_type_check;
alter table public.usage_events
  add constraint usage_events_event_type_check check (event_type in (
    'ORDER_CREATED', 'BILLABLE_ORDER_COMPLETED', 'BILLABLE_ORDER_FULL_REFUND',
    'ACTIVE_STALL_CHANGED', 'STAFF_MEMBERSHIP_CHANGED',
    'QR_CODE_CREATED', 'CSV_EXPORTED'
  ));

create unique index usage_events_full_refund_unique_idx
  on public.usage_events (event_type, reference_id)
  where event_type = 'BILLABLE_ORDER_FULL_REFUND' and reference_id is not null;

create index usage_events_payg_stall_period_idx
  on public.usage_events (organization_id, stall_id, billing_period, event_type)
  where stall_id is not null
    and event_type in ('BILLABLE_ORDER_COMPLETED', 'BILLABLE_ORDER_FULL_REFUND');

create table public.billing_stall_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete restrict,
  billing_period date not null check (extract(day from billing_period) = 1),
  gross_completed_order_count integer not null default 0 check (gross_completed_order_count >= 0),
  full_refund_credit_count integer not null default 0 check (full_refund_credit_count >= 0),
  net_billable_order_count integer not null default 0 check (net_billable_order_count >= 0),
  unit_price integer not null default 1 check (unit_price >= 0),
  uncapped_amount integer not null default 0 check (uncapped_amount >= 0),
  cap_amount integer not null default 1499 check (cap_amount >= 0),
  final_charge integer not null default 0 check (final_charge >= 0),
  cap_savings integer not null default 0 check (cap_savings >= 0),
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_stall_usage_summary_period_key
    unique (organization_id, stall_id, billing_period),
  constraint billing_stall_usage_summary_arithmetic_check check (
    net_billable_order_count = greatest(gross_completed_order_count - full_refund_credit_count, 0)
    and uncapped_amount = net_billable_order_count * unit_price
    and final_charge = least(uncapped_amount, cap_amount)
    and cap_savings = uncapped_amount - final_charge
  )
);

create index billing_stall_usage_summaries_org_period_idx
  on public.billing_stall_usage_summaries
  (organization_id, billing_period, final_charge desc);
create index billing_stall_usage_summaries_stall_period_idx
  on public.billing_stall_usage_summaries (stall_id, billing_period);

create or replace function public.enforce_billing_stall_summary_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.stalls stall
    where stall.id = new.stall_id
      and stall.organization_id = new.organization_id
  ) then
    raise exception using errcode = 'P0001', message = 'BILLING_ORGANIZATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger billing_stall_usage_summaries_scope_before_write
before insert or update on public.billing_stall_usage_summaries
for each row execute function public.enforce_billing_stall_summary_scope();

create trigger billing_stall_usage_summaries_touch_updated_at
before update on public.billing_stall_usage_summaries
for each row execute function public.touch_commercial_updated_at();

alter table public.billing_stall_usage_summaries enable row level security;
alter table public.billing_stall_usage_summaries force row level security;

revoke all on table public.billing_stall_usage_summaries
  from public, anon, authenticated;

create policy billing_stall_usage_summaries_financial_select
on public.billing_stall_usage_summaries
for select to authenticated using (
  app_private.is_platform_admin()
  or app_private.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
);

grant select (
  id, organization_id, stall_id, billing_period,
  gross_completed_order_count, full_refund_credit_count,
  net_billable_order_count, unit_price, uncapped_amount,
  cap_amount, final_charge, cap_savings,
  calculated_at, created_at, updated_at
) on table public.billing_stall_usage_summaries to authenticated;
grant select, insert, update, delete on table public.billing_stall_usage_summaries to service_role;

create or replace function public.billing_open_beta_free_access_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select flag.is_enabled
    from public.billing_feature_flags flag
    where flag.code = 'OPEN_BETA_FREE_ACCESS_ENABLED'
  ), false);
$$;

create or replace function public.billing_order_access_code(
  p_organization_id uuid,
  p_lock boolean default true
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_version public.plan_versions%rowtype;
  v_order_count integer := 0;
  v_package_orders integer := 0;
begin
  if p_organization_id is null then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  end if;
  if p_lock then
    select subscription.* into v_subscription
    from public.subscriptions subscription
    where subscription.organization_id = p_organization_id
    for update;
  else
    select subscription.* into v_subscription
    from public.subscriptions subscription
    where subscription.organization_id = p_organization_id;
  end if;

  if not found or v_subscription.status = 'CANCELLED' then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  elsif v_subscription.status = 'SUSPENDED' then
    return 'SUBSCRIPTION_SUSPENDED';
  elsif v_subscription.status not in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD') then
    return 'SUBSCRIPTION_NOT_ACTIVE';
  end if;

  if public.billing_open_beta_free_access_enabled() then
    return 'OK';
  end if;

  select version.* into strict v_version
  from public.plan_versions version
  where version.id = v_subscription.plan_version_id;

  if not exists (
    select 1 from public.plan_entitlements entitlement
    where entitlement.plan_version_id = v_subscription.plan_version_id
      and entitlement.feature_code = 'QR_ORDERING'
      and entitlement.is_enabled
  ) then
    return 'FEATURE_NOT_INCLUDED';
  end if;

  if v_subscription.status = 'TRIALING' then
    if v_subscription.trial_ends_at is null or v_subscription.trial_ends_at <= now() then
      return 'TRIAL_EXPIRED';
    end if;
    if v_version.included_orders is not null then
      select coalesce(sum(event.quantity), 0)::integer into v_order_count
      from public.usage_events event
      where event.organization_id = p_organization_id
        and event.event_type = 'BILLABLE_ORDER_COMPLETED'
        and event.occurred_at >= coalesce(v_subscription.trial_started_at, v_subscription.created_at)
        and event.occurred_at < v_subscription.trial_ends_at;
      if v_order_count >= v_version.included_orders then
        return 'TRIAL_ORDER_LIMIT_REACHED';
      end if;
    end if;
  elsif v_version.emergency_hard_cap_enabled then
    select coalesce(sum(event.quantity), 0)::integer into v_order_count
    from public.usage_events event
    where event.organization_id = p_organization_id
      and event.event_type = 'BILLABLE_ORDER_COMPLETED'
      and event.occurred_at >= v_subscription.billing_period_start
      and event.occurred_at < v_subscription.billing_period_end;
    select coalesce(sum(
      public.billing_order_package_quantity(item.code) * item.quantity
    ), 0)::integer into v_package_orders
    from public.subscription_items item
    where item.subscription_id = v_subscription.id
      and item.item_type = 'ORDER_PACKAGE'
      and item.status = 'ACTIVE'
      and item.starts_at < v_subscription.billing_period_end
      and (item.ends_at is null or item.ends_at >= v_subscription.billing_period_start);
    if v_order_count >= coalesce(v_version.emergency_hard_cap_orders, 0) + v_package_orders then
      return 'ORDER_PACKAGE_REQUIRED';
    end if;
  end if;
  return 'OK';
exception
  when no_data_found then return 'SUBSCRIPTION_NOT_ACTIVE';
end;
$$;

create or replace function public.enforce_billing_resource_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_subscription public.subscriptions%rowtype;
  v_version public.plan_versions%rowtype;
  v_current_count integer := 0;
  v_next_count integer := 0;
  v_approved_additional integer := 0;
  v_code text;
begin
  v_organization_id := new.organization_id;
  if v_organization_id is null then
    raise exception using errcode = 'P0001', message = 'SUBSCRIPTION_NOT_ACTIVE';
  end if;
  v_code := public.billing_order_access_code(v_organization_id, true);
  perform public.billing_raise_if_denied(v_code);
  if public.billing_open_beta_free_access_enabled() then
    return new;
  end if;
  select subscription.* into strict v_subscription
  from public.subscriptions subscription
  where subscription.organization_id = v_organization_id;
  select version.* into strict v_version
  from public.plan_versions version
  where version.id = v_subscription.plan_version_id;

  if tg_table_name = 'stalls' then
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then return new; end if;
    select count(*)::integer into v_current_count
    from public.stalls stall
    where stall.organization_id = v_organization_id and stall.is_active
      and (tg_op = 'INSERT' or stall.id <> new.id);
    v_next_count := v_current_count + 1;
    if v_version.max_stalls is not null and v_next_count > v_version.max_stalls then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
    if not (
      v_version.pricing_mode = 'USAGE_PER_STALL_CAPPED'
      and v_version.usage_scope = 'STALL'
      and v_version.max_stalls is null
    ) then
      select coalesce(sum(approval.quantity), 0)::integer into v_approved_additional
      from public.additional_stall_approvals approval
      where approval.subscription_id = v_subscription.id
        and approval.status = 'APPROVED'
        and approval.effective_at <= now()
        and (approval.expires_at is null or approval.expires_at > now());
      if v_next_count > v_version.included_stalls + v_approved_additional then
        raise exception using errcode = 'P0001', message = 'ADDITIONAL_STALL_APPROVAL_REQUIRED';
      end if;
    end if;
  elsif tg_table_name = 'products' then
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then return new; end if;
    select count(*)::integer into v_current_count
    from public.products product
    where product.organization_id = v_organization_id and product.is_active
      and (tg_op = 'INSERT' or product.id <> new.id);
    if v_version.max_products is not null and v_current_count + 1 > v_version.max_products then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
  elsif tg_table_name = 'qr_codes' then
    select count(*)::integer into v_current_count
    from public.qr_codes qr
    where qr.organization_id = v_organization_id
      and qr.state in ('ACTIVE'::public.qr_code_state, 'PAUSED'::public.qr_code_state);
    if v_version.max_qr_codes is not null and v_current_count + 1 > v_version.max_qr_codes then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
  elsif tg_table_name in ('organization_memberships', 'stall_memberships') then
    if new.role = 'ORGANIZATION_OWNER'::public.user_role then return new; end if;
    if tg_op = 'UPDATE' and (old.is_active or not new.is_active) then return new; end if;
    select count(distinct member.profile_id)::integer into v_current_count
    from (
      select membership.profile_id
      from public.organization_memberships membership
      where membership.organization_id = v_organization_id
        and membership.is_active
        and membership.role <> 'ORGANIZATION_OWNER'::public.user_role
      union
      select membership.profile_id
      from public.stall_memberships membership
      where membership.organization_id = v_organization_id and membership.is_active
    ) member
    where member.profile_id <> new.profile_id;
    if v_version.max_staff is not null and v_current_count + 1 > v_version.max_staff then
      raise exception using errcode = 'P0001', message = 'PLAN_LIMIT_REACHED';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.rebuild_payg_stall_usage_summaries(
  p_organization_id uuid,
  p_billing_period date,
  p_actor_profile_id uuid default null,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_billing_period)::date;
  v_plan_code text;
  v_pricing_mode text;
  v_usage_metric text;
  v_usage_scope text;
  v_unit_price integer;
  v_cap_amount integer;
  v_pricing_effective_at timestamptz;
  v_count integer;
begin
  if p_organization_id is null or p_billing_period is null then
    raise exception using errcode = '22023', message = 'INVALID_USAGE_PERIOD';
  end if;

  select
    plan.code, version.pricing_mode, version.usage_metric,
    version.usage_scope, version.usage_unit_price,
    version.monthly_cap_amount, subscription.pricing_effective_at
  into
    v_plan_code, v_pricing_mode, v_usage_metric,
    v_usage_scope, v_unit_price,
    v_cap_amount, v_pricing_effective_at
  from public.subscriptions subscription
  join public.plan_versions version on version.id = subscription.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where subscription.organization_id = p_organization_id;

  if not found or v_plan_code <> 'PAYG' then
    return 0;
  end if;
  if v_pricing_mode is distinct from 'USAGE_PER_STALL_CAPPED'
    or v_usage_metric is distinct from 'NET_BILLABLE_COMPLETED_ORDER'
    or v_usage_scope is distinct from 'STALL'
    or v_unit_price is null
    or v_cap_amount is null then
    raise exception using errcode = 'P0001', message = 'PAYG_PRICING_NOT_CONFIGURED';
  end if;

  with scoped_stalls as (
    select stall.id
    from public.stalls stall
    where stall.organization_id = p_organization_id
      and (
        stall.is_active
        or exists (
          select 1 from public.usage_events event
          where event.stall_id = stall.id and event.billing_period = v_period
        )
      )
  ), ledger as (
    select
      scoped_stalls.id as stall_id,
      coalesce(sum(event.quantity) filter (
        where event.event_type = 'BILLABLE_ORDER_COMPLETED'
      ), 0)::integer as gross_count,
      coalesce(-sum(event.quantity) filter (
        where event.event_type = 'BILLABLE_ORDER_FULL_REFUND'
      ), 0)::integer as refund_count
    from scoped_stalls
    left join public.usage_events event
      on event.organization_id = p_organization_id
      and event.stall_id = scoped_stalls.id
      and event.billing_period = v_period
      and event.event_type in ('BILLABLE_ORDER_COMPLETED', 'BILLABLE_ORDER_FULL_REFUND')
      and (v_pricing_effective_at is null or event.occurred_at >= v_pricing_effective_at)
    group by scoped_stalls.id
  ), calculated as (
    select
      stall_id,
      greatest(gross_count, 0) as gross_count,
      greatest(refund_count, 0) as refund_count,
      greatest(gross_count - refund_count, 0) as net_count
    from ledger
  )
  insert into public.billing_stall_usage_summaries (
    organization_id, stall_id, billing_period,
    gross_completed_order_count, full_refund_credit_count,
    net_billable_order_count, unit_price, uncapped_amount,
    cap_amount, final_charge, cap_savings, calculated_at, updated_at
  )
  select
    p_organization_id, stall_id, v_period,
    gross_count, refund_count, net_count,
    v_unit_price, net_count * v_unit_price,
    v_cap_amount, least(net_count * v_unit_price, v_cap_amount),
    greatest(net_count * v_unit_price - v_cap_amount, 0), now(), now()
  from calculated
  on conflict (organization_id, stall_id, billing_period) do update set
    gross_completed_order_count = excluded.gross_completed_order_count,
    full_refund_credit_count = excluded.full_refund_credit_count,
    net_billable_order_count = excluded.net_billable_order_count,
    unit_price = excluded.unit_price,
    uncapped_amount = excluded.uncapped_amount,
    cap_amount = excluded.cap_amount,
    final_charge = excluded.final_charge,
    cap_savings = excluded.cap_savings,
    calculated_at = excluded.calculated_at,
    updated_at = excluded.updated_at;

  get diagnostics v_count = row_count;
  if p_actor_profile_id is not null then
    insert into public.audit_logs (
      id, tenant_id, organization_id, actor_profile_id, action, entity_type,
      outcome, request_id, metadata, after_json, created_at
    ) values (
      gen_random_uuid(), p_organization_id, p_organization_id,
      p_actor_profile_id, 'PAYG_USAGE_REBUILT', 'BILLING_STALL_USAGE_SUMMARY',
      'SUCCESS'::public.audit_outcome,
      left(coalesce(nullif(p_request_id, ''), gen_random_uuid()::text), 100),
      'PAYG per-stall usage rebuild',
      jsonb_build_object('billingPeriod', v_period, 'stallCount', v_count),
      now()
    );
  end if;
  return v_count;
end;
$$;

create or replace function public.record_billable_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
  v_timezone text;
begin
  if not new.is_test
    and new.origin not in ('TEST'::public.order_origin, 'SYSTEM_CANARY'::public.order_origin)
    and new.status = 'COMPLETED'::public.order_status
    and (tg_op = 'INSERT' or old.status <> 'COMPLETED'::public.order_status) then
    select stall.timezone into v_timezone from public.stalls stall where stall.id = new.stall_id;
    v_period := date_trunc(
      'month', coalesce(new.completed_at, now()) at time zone coalesce(v_timezone, 'Asia/Taipei')
    )::date;

    insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      new.organization_id, new.stall_id, 'BILLABLE_ORDER_COMPLETED', 1,
      v_period, 'ORDER', new.id::text, coalesce(new.completed_at, now())
    ) on conflict do nothing;

    perform public.rebuild_billing_usage_summary(new.organization_id, v_period);
    perform public.rebuild_payg_stall_usage_summaries(new.organization_id, v_period);
    perform public.reconcile_billing_usage_warnings(new.organization_id, v_period);
  end if;
  return null;
end;
$$;

create or replace function public.record_billable_order_full_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completion public.usage_events%rowtype;
begin
  if new.payment_status = 'REFUNDED'::public.payment_status
    and old.payment_status is distinct from new.payment_status then
    select event.* into v_completion
    from public.usage_events event
    where event.event_type = 'BILLABLE_ORDER_COMPLETED'
      and event.reference_id = new.id::text
      and event.organization_id = new.organization_id
      and event.stall_id = new.stall_id
    limit 1;

    if found then
      insert into public.usage_events (
        organization_id, stall_id, event_type, quantity, billing_period,
        reference_type, reference_id, occurred_at
      ) values (
        new.organization_id, new.stall_id, 'BILLABLE_ORDER_FULL_REFUND', -1,
        v_completion.billing_period, 'ORDER', new.id::text, now()
      ) on conflict do nothing;
      perform public.rebuild_payg_stall_usage_summaries(
        new.organization_id, v_completion.billing_period
      );
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_billable_full_refund_after_update on public.orders;
create trigger orders_billable_full_refund_after_update
after update of payment_status on public.orders
for each row execute function public.record_billable_order_full_refund();

do $$
declare
  row record;
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select
  completion.organization_id, completion.stall_id,
  'BILLABLE_ORDER_FULL_REFUND', -1, completion.billing_period,
  'ORDER', completion.reference_id, coalesce(orders.updated_at, now())
from public.usage_events completion
join public.orders orders on orders.id::text = completion.reference_id
where completion.event_type = 'BILLABLE_ORDER_COMPLETED'
  and orders.payment_status = 'REFUNDED'::public.payment_status
on conflict do nothing;

  for row in
    select distinct organization_id, billing_period
    from public.usage_events
    where event_type in ('BILLABLE_ORDER_COMPLETED', 'BILLABLE_ORDER_FULL_REFUND')
  loop
    perform public.rebuild_payg_stall_usage_summaries(row.organization_id, row.billing_period);
  end loop;
  end if;
end;
$$;

revoke all on function public.billing_open_beta_free_access_enabled()
  from public, anon, authenticated;
revoke all on function public.rebuild_payg_stall_usage_summaries(uuid, date, uuid, text)
  from public, anon, authenticated;
revoke all on function public.enforce_billing_stall_summary_scope()
  from public, anon, authenticated;
revoke all on function public.record_billable_order_full_refund()
  from public, anon, authenticated;
grant execute on function public.rebuild_payg_stall_usage_summaries(uuid, date, uuid, text)
  to service_role;

comment on table public.billing_stall_usage_summaries is
  'Rebuildable PAYG per-stall estimates. usage_events remains the append-only source of truth.';
comment on column public.plan_versions.monthly_cap_amount is
  'Immutable per-scope cap snapshot for this plan version; PAYG uses TWD 1499 per stall per month.';
comment on column public.invoices.pricing_snapshot_json is
  'Immutable explanatory pricing contract captured when an invoice is created.';
