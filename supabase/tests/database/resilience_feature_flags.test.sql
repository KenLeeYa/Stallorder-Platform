begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

select has_table('public', 'resilience_feature_flags', 'resilience feature flag catalog exists');
select has_table('public', 'resilience_feature_flag_overrides', 'resilience feature flag overrides exist');

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.resilience_feature_flags'::regclass
  ),
  'resilience feature flags force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.resilience_feature_flag_overrides'::regclass
  ),
  'resilience feature flag overrides force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.resilience_feature_flags', 'SELECT'),
  'anonymous cannot read resilience feature flags directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.resilience_feature_flags', 'SELECT'),
  'authenticated users cannot read resilience feature flags directly'
);
select ok(
  not has_table_privilege('anon', 'public.resilience_feature_flag_overrides', 'INSERT'),
  'anonymous cannot create resilience overrides'
);
select ok(
  not has_table_privilege('authenticated', 'public.resilience_feature_flag_overrides', 'UPDATE'),
  'authenticated users cannot update resilience overrides'
);
select ok(
  has_table_privilege('service_role', 'public.resilience_feature_flags', 'SELECT'),
  'service role can read the flag catalog'
);
select ok(
  has_table_privilege('service_role', 'public.resilience_feature_flag_overrides', 'INSERT'),
  'service role can create reviewed overrides'
);

select is(
  (select count(*)::integer from public.resilience_feature_flags),
  53,
  'all resilience, OAuth, delivery and Phase 3 foundation flags are seeded'
);
select is(
  (
    select default_enabled
    from public.resilience_feature_flags
    where code = 'OFFLINE_SINGLE_DEVICE_ONLY'
  ),
  true,
  'single offline leader policy defaults to enabled'
);

select throws_ok(
  $$
    insert into public.resilience_feature_flag_overrides (
      flag_id, scope_type, enabled, rollout_percentage, reason
    )
    select id, 'GLOBAL', true, 10, 'invalid global rollout'
    from public.resilience_feature_flags
    where code = 'ROLLING_RELEASE_ENABLED'
  $$,
  '23514',
  null,
  'database rejects scope field mismatch'
);

insert into public.resilience_feature_flag_overrides (
  flag_id, scope_type, enabled, reason
)
select id, 'GLOBAL', false, 'first reviewed global override'
from public.resilience_feature_flags
where code = 'DUAL_ORDER_INTAKE_ENABLED';

select throws_ok(
  $$
    insert into public.resilience_feature_flag_overrides (
      flag_id, scope_type, enabled, reason
    )
    select id, 'GLOBAL', true, 'duplicate global override'
    from public.resilience_feature_flags
    where code = 'DUAL_ORDER_INTAKE_ENABLED'
  $$,
  '23505',
  null,
  'database permits only one override for the same scope target'
);

select * from finish();
rollback;
