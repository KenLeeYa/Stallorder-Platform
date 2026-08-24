begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

select ok(not (select default_enabled from public.resilience_feature_flags where code = 'PAYMENTS_ADMIN_UI_ENABLED'), 'payment admin screens default hidden');
select has_column('public', 'auth_sessions', 'device_label', 'auth sessions persist a sanitized device label');
select ok(exists(
  select 1 from pg_constraint
  where conrelid = 'public.auth_sessions'::regclass and conname = 'auth_sessions_device_label_check'
), 'device label length is constrained');

select is((
  select tax_treatment from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PAYG' and version.version = 1
), 'UNCONFIGURED', 'existing PAYG v1 remains legally unconfigured and cannot silently charge');
select is((
  select billing_timezone from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PAYG' and version.version = 1
), 'Asia/Taipei', 'PAYG billing timezone is explicit');
select is((
  select billing_cycle_anchor_day::integer from public.plan_versions version
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PAYG' and version.version = 1
), 1, 'PAYG calendar month anchor is explicit');

select has_table('public', 'billing_credit_adjustments', 'late refund credit table exists');
select has_table('public', 'payg_close_jobs', 'durable automatic close jobs exist');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_credit_adjustments'::regclass), 'late credits enable and force RLS');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payg_close_jobs'::regclass), 'automatic close jobs enable and force RLS');
select ok(not has_table_privilege('anon', 'public.billing_credit_adjustments', 'SELECT'), 'anonymous cannot read billing credits');
select ok(has_table_privilege('authenticated', 'public.billing_credit_adjustments', 'SELECT'), 'authenticated platform admins can be evaluated by RLS');
select ok(has_table_privilege('service_role', 'public.payg_close_jobs', 'INSERT'), 'trusted service can create close jobs');
select matches((
  select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.invoice_line_items'::regclass and conname = 'invoice_line_items_type_check'
), '.*PAYG_USAGE.*', 'invoice line constraint permits PAYG usage lines');

select lives_ok($$
  insert into public.plan_versions (
    plan_id, version, display_name, billing_interval, base_price, annual_price,
    currency, trial_days, included_stalls, max_stalls, additional_stall_price,
    max_staff, max_products, max_qr_codes, included_orders, report_retention_days,
    overage_policy, pricing_mode, usage_unit_price, usage_metric, usage_scope,
    monthly_cap_amount, minimum_charge, emergency_hard_cap_enabled,
    emergency_hard_cap_orders, is_public, requires_quote, effective_from,
    billing_timezone, billing_cycle_anchor_day, billing_period_type,
    invoice_close_delay_hours, tax_treatment, tax_jurisdiction,
    tax_rounding_mode, tax_rounding_scope, tax_document_required
  )
  select
    source.plan_id, 99, 'PAYG contract QA', source.billing_interval,
    source.base_price, source.annual_price, source.currency, source.trial_days,
    source.included_stalls, source.max_stalls, source.additional_stall_price,
    source.max_staff, source.max_products, source.max_qr_codes,
    source.included_orders, source.report_retention_days, source.overage_policy,
    source.pricing_mode, source.usage_unit_price, source.usage_metric,
    source.usage_scope, source.monthly_cap_amount, source.minimum_charge,
    source.emergency_hard_cap_enabled, source.emergency_hard_cap_orders,
    false, source.requires_quote, now(), 'Asia/Taipei', 1, 'CALENDAR_MONTH',
    24, 'EXEMPT', 'TW', 'HALF_UP', 'INVOICE', false
  from public.plan_versions source
  join public.plans plan on plan.id = source.plan_id
  where plan.code = 'PAYG' and source.version = 1
$$, 'a draft PAYG contract version can be composed');

select lives_ok($$
  update public.plan_versions set invoice_close_delay_hours = 48
  where version = 99 and plan_id = (select id from public.plans where code = 'PAYG')
$$, 'draft contract fields remain editable before sealing');

insert into public.plan_entitlements (plan_version_id, feature_code, is_enabled, limit_value, configuration_json)
select target.id, entitlement.feature_code, entitlement.is_enabled, entitlement.limit_value, entitlement.configuration_json
from public.plan_versions target
join public.plans plan on plan.id = target.plan_id and plan.code = 'PAYG'
join public.plan_versions source on source.plan_id = target.plan_id and source.version = 1
join public.plan_entitlements entitlement on entitlement.plan_version_id = source.id
where target.version = 99;

select lives_ok($$
  update public.plan_versions
  set sealed_at = now(),
      sealed_by_profile_id = '55555555-5555-4555-8555-555555555551',
      contract_hash = repeat('a', 64)
  where version = 99 and plan_id = (select id from public.plans where code = 'PAYG')
$$, 'draft contract can be sealed atomically');

select throws_ok($$
  update public.plan_versions set usage_unit_price = 2
  where version = 99 and plan_id = (select id from public.plans where code = 'PAYG')
$$, 'P0001', 'PLAN_VERSION_CONTRACT_IMMUTABLE', 'sealed unit price cannot change');
select throws_ok($$
  update public.plan_versions set tax_treatment = 'OUT_OF_SCOPE'
  where version = 99 and plan_id = (select id from public.plans where code = 'PAYG')
$$, 'P0001', 'PLAN_VERSION_CONTRACT_IMMUTABLE', 'sealed tax treatment cannot change');
select throws_ok($$
  update public.plan_versions set contract_hash = repeat('b', 64)
  where version = 99 and plan_id = (select id from public.plans where code = 'PAYG')
$$, 'P0001', 'PLAN_VERSION_SEAL_IMMUTABLE', 'sealed hash cannot change');
select throws_ok($$
  update public.plan_entitlements set is_enabled = not is_enabled
  where plan_version_id = (
    select version.id from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where plan.code = 'PAYG' and version.version = 99
  )
$$, 'P0001', 'PLAN_ENTITLEMENT_SNAPSHOT_IMMUTABLE', 'sealed entitlement snapshot cannot change');

select * from finish();
rollback;
