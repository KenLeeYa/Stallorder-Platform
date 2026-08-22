begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

select is(
  (select pricing_mode || ':' || usage_unit_price || ':' || usage_scope || ':' || monthly_cap_amount || ':' || minimum_charge
   from public.plans where code = 'PAYG'),
  'USAGE_PER_STALL_CAPPED:1:STALL:1499:0',
  'PAYG catalog stores the exact per-stall capped contract'
);
select is(
  (select version.currency || ':' || version.base_price || ':' || plan.usage_metric
   from public.plan_versions version
   join public.plans plan on plan.id = version.plan_id
   where plan.code = 'PAYG' and version.version = 1),
  'TWD:0:NET_BILLABLE_COMPLETED_ORDER',
  'PAYG version stores immutable TWD zero-base pricing'
);
select is(
  (select count(*)::integer
   from public.plan_versions version
   join public.plans plan on plan.id = version.plan_id
   where plan.code in ('LITE', 'STANDARD', 'PRO') and version.is_public),
  0,
  'legacy monthly versions remain historical but are not offered to new merchants'
);
select ok(
  (select version.is_public
   from public.plan_versions version
   join public.plans plan on plan.id = version.plan_id
   where plan.code = 'PAYG' and version.version = 1),
  'PAYG is available as the normal public contract'
);
select is(
  (select array_agg(entitlement.feature_code order by entitlement.feature_code)
   from public.plan_entitlements entitlement
   join public.plan_versions version on version.id = entitlement.plan_version_id
   join public.plans plan on plan.id = version.plan_id
   where plan.code = 'PAYG' and version.version = 1 and entitlement.is_enabled),
  array[
    'AUDIT_VIEWER', 'BASIC_REPORTS', 'BULK_PRODUCT_ASSIGNMENT',
    'BULK_STALL_CONTROL', 'BUSINESS_HOURS', 'CAPACITY_CONTROL',
    'CASH_RECONCILIATION', 'CASH_SHIFT', 'CDS', 'CSV_EXPORT', 'KDS',
    'KITCHEN_VIEW', 'MANUAL_CHECKOUT', 'MODIFIERS', 'MULTI_STALL_BASIC',
    'MULTI_STALL_DASHBOARD', 'MULTIPLE_QR_CODES', 'OPERATIONAL_ALERTS',
    'PAYMENT_REPORT', 'PRINTER_INTEGRATION', 'PRODUCT_MANAGEMENT',
    'PRODUCT_SALES_REPORT', 'QR_ORDERING', 'SCHEDULED_REPORTS',
    'SOLD_OUT_CONTROL', 'STAFF_ROLES', 'STALL_LOCATION', 'STALL_SCHEDULE',
    'WAIT_TIME_QUOTE'
  ]::text[],
  'PAYG v1 enables the complete normal merchant operating core'
);
select ok(not exists(
  select 1 from public.plan_entitlements entitlement
  join public.plan_versions version on version.id = entitlement.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PAYG' and entitlement.feature_code in (
    'ADVANCED_REPORTS',
    'LINE_NOTIFICATIONS', 'LINE_ORDER_LINKING', 'LINE_REPEAT_ORDER',
    'API_ACCESS', 'WEBHOOK_ACCESS', 'WEBHOOKS', 'SSO',
    'WHITE_LABEL', 'CUSTOM_BRANDING', 'CUSTOM_DOMAIN',
    'ENTERPRISE_SLA', 'PRIORITY_SUPPORT'
  ) and entitlement.is_enabled
), 'PAYG does not default-enable advanced, integration, or enterprise entitlements');
select ok(exists(
  select 1 from public.plan_entitlements entitlement
  join public.plan_versions version on version.id = entitlement.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PAYG' and version.version = 1
    and entitlement.feature_code = 'DELIVERY_PLATFORM_INTEGRATIONS'
    and not entitlement.is_enabled
), 'PAYG retains a disabled delivery integration entitlement for explicit administration');
select is((
  select count(*)::integer
  from public.add_on_catalog
  where code in (
    'ADDITIONAL_STALL_STANDARD', 'ADDITIONAL_STALL_PRO',
    'ORDER_PACKAGE_LITE_100', 'ORDER_PACKAGE_STANDARD_500',
    'ORDER_PACKAGE_PRO_1000'
  )
), 5, 'legacy additional-stall and order-package catalog rows are preserved');
select is((
  select count(*)::integer
  from public.add_on_catalog
  where code in (
    'ADDITIONAL_STALL_STANDARD', 'ADDITIONAL_STALL_PRO',
    'ORDER_PACKAGE_LITE_100', 'ORDER_PACKAGE_STANDARD_500',
    'ORDER_PACKAGE_PRO_1000'
  ) and is_public
), 0, 'legacy additional-stall and order-package catalog rows are no longer public');

select ok((select is_enabled from public.billing_feature_flags where code = 'OPEN_BETA_FREE_ACCESS_ENABLED'), 'open beta free access defaults on');
select ok(not (select is_enabled from public.billing_feature_flags where code = 'MERCHANT_BILLING_VISIBLE'), 'merchant billing remains hidden by default');
select is((
  select count(*)::integer from public.billing_feature_flags
  where code like 'PAYG_%' and is_enabled
), 0, 'every PAYG charging and rollout flag defaults off');
select is(
  public.billing_order_access_code('11111111-1111-4111-8111-111111111111', false),
  'OK',
  'open beta allows an eligible merchant to order without charging activation'
);
select is(
  public.billing_order_access_code('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false),
  'SUBSCRIPTION_NOT_ACTIVE',
  'open beta does not bypass a missing subscription'
);
update public.subscriptions
set status = 'SUSPENDED'
where organization_id = '11111111-1111-4111-8111-111111111111';
select is(
  public.billing_order_access_code('11111111-1111-4111-8111-111111111111', false),
  'SUBSCRIPTION_SUSPENDED',
  'open beta preserves administrative suspension'
);
update public.subscriptions
set status = 'ACTIVE'
where organization_id = '11111111-1111-4111-8111-111111111111';

select is((
  select plan.code || ':' || version.version || ':' || version.pricing_mode
  from public.subscriptions subscription
  join public.plan_versions version on version.id = subscription.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
), 'PAYG:1:USAGE_PER_STALL_CAPPED', 'primary demo subscription is explicitly pinned to PAYG v1');

update public.subscriptions
set pricing_effective_at = '2026-07-01 00:00:00+08'::timestamptz
where organization_id = '11111111-1111-4111-8111-111111111111';

select ok((
  select relation.relrowsecurity and relation.relforcerowsecurity
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = 'billing_stall_usage_summaries'
), 'per-stall usage summary enables and forces RLS');
select ok(not has_table_privilege('anon', 'public.billing_stall_usage_summaries', 'SELECT'), 'anonymous cannot read PAYG usage');
select ok(has_table_privilege('service_role', 'public.billing_stall_usage_summaries', 'INSERT'), 'trusted service can rebuild PAYG usage');

select throws_ok(
  $$insert into public.billing_stall_usage_summaries (
      organization_id, stall_id, billing_period
    ) values (
      '99999999-9999-4999-8999-999999999999',
      '22222222-2222-4222-8222-222222222222', '2026-07-01'
    )$$,
  'P0001', 'BILLING_ORGANIZATION_SCOPE_MISMATCH',
  'a stall summary cannot cross organization scope'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, location,
  is_active, created_at, updated_at
) values
  (
    'cb000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111112', 'Legacy Stall 1',
    'legacy-billing-stall-1', 'LEGACY-BILLING-1', 'Taipei', 'Taipei', true, now(), now()
  ),
  (
    'cb000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111112', 'Legacy Stall 2',
    'legacy-billing-stall-2', 'LEGACY-BILLING-2', 'Taipei', 'Taipei', true, now(), now()
  ),
  (
    'cb000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111112', 'Legacy Stall 3',
    'legacy-billing-stall-3', 'LEGACY-BILLING-3', 'Taipei', 'Taipei', true, now(), now()
  );

select is(
  public.rebuild_payg_stall_usage_summaries(
    '11111111-1111-4111-8111-111111111112', '2026-07-01'
  ),
  0,
  'a non-PAYG subscription is ignored by the PAYG summary rebuild'
);
select is((
  select count(*)::integer
  from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111112'
), 0, 'a non-PAYG subscription does not produce PAYG summaries');

insert into public.plan_versions (
  plan_id, version, display_name, billing_interval, base_price, annual_price,
  currency, trial_days, included_stalls, max_stalls, additional_stall_price,
  max_staff, max_products, max_qr_codes, included_orders, report_retention_days,
  overage_policy, pricing_mode, usage_unit_price, usage_metric, usage_scope,
  monthly_cap_amount, minimum_charge, emergency_hard_cap_enabled,
  emergency_hard_cap_orders, is_public, requires_quote,
  effective_from, effective_until
)
select
  version.plan_id, 2, 'Stallorder v2', version.billing_interval,
  version.base_price, version.annual_price, version.currency, version.trial_days,
  version.included_stalls, version.max_stalls, version.additional_stall_price,
  version.max_staff, version.max_products, version.max_qr_codes,
  version.included_orders, version.report_retention_days, version.overage_policy,
  version.pricing_mode, 3, version.usage_metric, version.usage_scope,
  777, version.minimum_charge, version.emergency_hard_cap_enabled,
  version.emergency_hard_cap_orders, false, version.requires_quote,
  now() - interval '1 minute', null
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
where plan.code = 'PAYG' and version.version = 1;

update public.billing_feature_flags
set is_enabled = false
where code = 'OPEN_BETA_FREE_ACCESS_ENABLED';

select throws_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, location,
      is_active, created_at, updated_at
    ) values (
      'cb000000-0000-4000-8000-000000000004',
      '11111111-1111-4111-8111-111111111112', 'Legacy Stall 4',
      'legacy-billing-stall-4', 'LEGACY-BILLING-4', 'Taipei', 'Taipei', true, now(), now()
    )$$,
  'P0001', 'ADDITIONAL_STALL_APPROVAL_REQUIRED',
  'legacy fixed-price plans still require an approved additional stall'
);

select lives_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, location,
      is_active, created_at, updated_at
    ) values (
      'ca000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111', 'PAYG B Stall',
      'payg-b-stall', 'PAYG-B', 'Taipei', 'Taipei', true, now(), now()
    )$$,
  'uncapped per-stall PAYG permits a second stall without an approval'
);

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'BILLABLE_ORDER_COMPLETED', 1, '2026-07-01', 'ORDER',
  'payg-a-' || series_no, '2026-07-15 12:00:00+08'::timestamptz
from generate_series(1, 2000) series_no;

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select
  '11111111-1111-4111-8111-111111111111',
  'ca000000-0000-4000-8000-000000000001',
  'BILLABLE_ORDER_COMPLETED', 1, '2026-07-01', 'ORDER',
  'payg-b-' || series_no, '2026-07-15 12:00:00+08'::timestamptz
from generate_series(1, 500) series_no;

insert into public.usage_events (
  organization_id, stall_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'BILLABLE_ORDER_FULL_REFUND', -1, '2026-07-01', 'ORDER',
  'payg-a-' || series_no, '2026-07-20 12:00:00+08'::timestamptz
from generate_series(1, 50) series_no;

select lives_ok(
  $$select public.rebuild_payg_stall_usage_summaries(
      '11111111-1111-4111-8111-111111111111', '2026-07-01'
    )$$,
  'trusted per-stall PAYG summary can be rebuilt'
);
select is(
  (select unit_price || ':' || cap_amount || ':' || gross_completed_order_count || ':' || full_refund_credit_count || ':' || net_billable_order_count || ':' || uncapped_amount || ':' || final_charge || ':' || cap_savings
   from public.billing_stall_usage_summaries
   where stall_id = '22222222-2222-4222-8222-222222222222' and billing_period = '2026-07-01'),
  '1:1499:2000:50:1950:1950:1499:451',
  'stall A uses its subscription-pinned PAYG v1 price instead of the newer v2 catalog'
);
select is(
  (select net_billable_order_count || ':' || final_charge
   from public.billing_stall_usage_summaries
   where stall_id = 'ca000000-0000-4000-8000-000000000001' and billing_period = '2026-07-01'),
  '500:500',
  'stall B remains independently below the cap'
);
select is(
  (select sum(final_charge)::integer
   from public.billing_stall_usage_summaries
   where organization_id = '11111111-1111-4111-8111-111111111111' and billing_period = '2026-07-01'),
  1999,
  'organization total sums independently capped stalls instead of applying one organization cap'
);

select lives_ok(
  $$select public.rebuild_payg_stall_usage_summaries(
      '11111111-1111-4111-8111-111111111111', '2026-07-01'
    )$$,
  'rebuilding the same period is idempotent'
);
select is((
  select count(*)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111' and billing_period = '2026-07-01'
), 2, 'idempotent rebuild keeps one row per stall and period');
select is((
  select sum(final_charge)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111' and billing_period = '2026-07-01'
), 1999, 'idempotent rebuild preserves the same total');

insert into auth.users (id, email) values
  ('eb000000-0000-4000-8000-000000000001', 'payg-owner-rls@stallorder.test'),
  ('eb000000-0000-4000-8000-000000000002', 'payg-admin-rls@stallorder.test'),
  ('eb000000-0000-4000-8000-000000000003', 'payg-finance-rls@stallorder.test'),
  ('eb000000-0000-4000-8000-000000000004', 'payg-other-owner-rls@stallorder.test');
update public.profiles
set auth_user_id = 'eb000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
insert into public.profiles (id, auth_user_id, email, display_name, is_active) values
  ('ec000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000002', 'payg-admin-rls@stallorder.test', 'PAYG 組織管理員', true),
  ('ec000000-0000-4000-8000-000000000003', 'eb000000-0000-4000-8000-000000000003', 'payg-finance-rls@stallorder.test', 'PAYG 財務檢視者', true),
  ('ec000000-0000-4000-8000-000000000004', 'eb000000-0000-4000-8000-000000000004', 'payg-other-owner-rls@stallorder.test', '其他組織擁有者', true);
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_primary_owner, is_active
) values
  ('11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000002', 'ORGANIZATION_ADMIN', true, false, true),
  ('11111111-1111-4111-8111-111111111111', 'ec000000-0000-4000-8000-000000000003', 'FINANCE_VIEWER', true, false, true),
  ('11111111-1111-4111-8111-111111111112', 'ec000000-0000-4000-8000-000000000004', 'ORGANIZATION_OWNER', true, false, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000001', true);
select is((
  select count(*)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and billing_period = '2026-07-01'
), 2, 'organization owner can read own PAYG financial summaries');
select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000002', true);
select is((
  select count(*)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and billing_period = '2026-07-01'
), 0, 'organization admin cannot bypass the PAYG financial role boundary');
select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000003', true);
select is((
  select count(*)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and billing_period = '2026-07-01'
), 2, 'finance viewer can read own PAYG financial summaries');
select set_config('request.jwt.claim.sub', 'eb000000-0000-4000-8000-000000000004', true);
select is((
  select count(*)::integer from public.billing_stall_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and billing_period = '2026-07-01'
), 0, 'organization owner cannot read another organization PAYG financial summaries');
reset role;

select throws_ok(
  $$insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'BILLABLE_ORDER_COMPLETED', 1, '2026-07-01', 'ORDER',
      'payg-a-1', '2026-07-15 12:00:00+08'
    )$$,
  '23505', null,
  'duplicate completion cannot double charge'
);
select throws_ok(
  $$insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period,
      reference_type, reference_id, occurred_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'BILLABLE_ORDER_FULL_REFUND', -1, '2026-07-01', 'ORDER',
      'payg-a-1', '2026-07-20 12:00:00+08'
    )$$,
  '23505', null,
  'duplicate full refund cannot create a second credit'
);
select is((
  select count(*)::integer from public.usage_events
  where event_type = 'BILLABLE_ORDER_FULL_REFUND' and reference_id like 'payg-a-%'
), 50, 'refund ledger preserves exactly one append-only negative event per full refund');

select ok(not exists(
  select 1 from public.invoices invoice
  where invoice.organization_id = '11111111-1111-4111-8111-111111111111'
    and invoice.billing_period_start = '2026-07-01'
), 'summary rebuild does not silently create or mutate a financial invoice');

select * from finish();
rollback;
