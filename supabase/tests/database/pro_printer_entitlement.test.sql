begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);

select ok(
  exists (
    select 1
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where plan.code in ('PRO', 'ENTERPRISE')
  ),
  'Pro or Enterprise plan versions exist'
);

select is(
  (
    select count(*)::integer
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where plan.code in ('PRO', 'ENTERPRISE')
  ),
  (
    select count(*)::integer
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    join public.plan_entitlements entitlement
      on entitlement.plan_version_id = version.id
     and entitlement.feature_code = 'PRINTER_INTEGRATION'
     and entitlement.is_enabled
    where plan.code in ('PRO', 'ENTERPRISE')
  ),
  'every existing Pro and Enterprise version includes printer integration'
);

select is(
  (
    select count(*)::integer
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    join public.plan_entitlements entitlement
      on entitlement.plan_version_id = version.id
     and entitlement.feature_code = 'PRINTER_INTEGRATION'
    where plan.code in ('PRO', 'ENTERPRISE')
      and entitlement.configuration_json @> '{"merchantModuleOptIn": true}'::jsonb
  ),
  (
    select count(*)::integer
    from public.plan_versions version
    join public.plans plan on plan.id = version.plan_id
    where plan.code in ('PRO', 'ENTERPRISE')
  ),
  'every existing Pro and Enterprise version allows stall-level printer opt-in'
);

select is(
  (
    select count(*)::integer
    from public.plan_entitlements entitlement
    join public.plan_versions version on version.id = entitlement.plan_version_id
    join public.plans plan on plan.id = version.plan_id
    where entitlement.feature_code = 'PRINTER_INTEGRATION'
      and entitlement.is_enabled
      and plan.code in ('TRIAL', 'LITE', 'STANDARD')
  ),
  0,
  'printer integration is not granted to any lower-plan version'
);

select matches(
  (
    select pg_get_expr(attribute.adbin, attribute.adrelid)
    from pg_attrdef attribute
    join pg_attribute column_definition
      on column_definition.attrelid = attribute.adrelid
     and column_definition.attnum = attribute.adnum
    where attribute.adrelid = 'public.stall_ordering_settings'::regclass
      and column_definition.attname = 'print_module_enabled'
  ),
  '^false(::boolean)?$',
  'printer module remains opt-in for each stall'
);

select * from finish();
rollback;
