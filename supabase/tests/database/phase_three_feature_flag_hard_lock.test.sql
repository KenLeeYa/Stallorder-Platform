begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(26);

select has_function(
  'app_private',
  'enforce_phase_three_feature_flag_lock',
  array[]::text[],
  'Phase 3 hard-lock trigger function exists'
);
select has_trigger(
  'public',
  'resilience_feature_flags',
  'resilience_feature_flags_phase_three_lock_guard',
  'flag catalog has the Phase 3 hard-lock trigger'
);
select has_trigger(
  'public',
  'resilience_feature_flag_overrides',
  'resilience_feature_flag_overrides_phase_three_lock_guard',
  'flag overrides have the Phase 3 hard-lock trigger'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.resilience_feature_flags'::regclass
      and constraint_record.contype = 'c'
      and constraint_record.conname = 'resilience_feature_flags_phase_three_default_off_check'
  ),
  'flag catalog retains a row-local default-off guard'
);

select is(
  (
    select count(*)::integer
    from public.resilience_feature_flags
    where code in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    )
      and not default_enabled
  ),
  5,
  'all five Phase 3 catalog defaults are present and off'
);
select is(
  (
    select count(*)::integer
    from public.resilience_feature_flag_overrides flag_override
    join public.resilience_feature_flags flag on flag.id = flag_override.flag_id
    where flag.code in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    )
      and flag_override.enabled
  ),
  0,
  'the migration clears every pre-existing enabled Phase 3 override'
);

select throws_ok(
  $$ update public.resilience_feature_flags set default_enabled = true where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'digital waitlist default cannot be enabled'
);
select throws_ok(
  $$ update public.resilience_feature_flags set default_enabled = true where code = 'ONLINE_ORDER_PAYMENT_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'online payment default cannot be enabled'
);
select throws_ok(
  $$ update public.resilience_feature_flags set default_enabled = true where code = 'RESERVATION_PREORDER_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'reservation default cannot be enabled'
);
select throws_ok(
  $$ update public.resilience_feature_flags set default_enabled = true where code = 'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'dynamic QR default cannot be enabled'
);
select throws_ok(
  $$ update public.resilience_feature_flags set default_enabled = true where code = 'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'CRM loyalty default cannot be enabled'
);
select throws_ok(
  $$ update public.resilience_feature_flags
     set code = 'DIGITAL_WAITLIST_FOUNDATION_RENAMED'
     where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'a Phase 3 code cannot be renamed out of the hard-lock set'
);
select throws_ok(
  $$ update public.resilience_feature_flags
     set code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED'
     where code = 'OFFLINE_POS_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'another flag cannot be renamed into the Phase 3 hard-lock set'
);

delete from public.resilience_feature_flag_overrides flag_override
using public.resilience_feature_flags flag
where flag_override.flag_id = flag.id
  and flag.code in (
    'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
    'ONLINE_ORDER_PAYMENT_ENABLED',
    'RESERVATION_PREORDER_ENABLED',
    'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
    'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
  );

select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Attempt locked digital waitlist enable'
     from public.resilience_feature_flags where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'digital waitlist override cannot be enabled'
);
select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Attempt locked online payment enable'
     from public.resilience_feature_flags where code = 'ONLINE_ORDER_PAYMENT_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'online payment override cannot be enabled'
);
select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Attempt locked reservation enable'
     from public.resilience_feature_flags where code = 'RESERVATION_PREORDER_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'reservation override cannot be enabled'
);
select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Attempt locked dynamic QR enable'
     from public.resilience_feature_flags where code = 'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'dynamic QR override cannot be enabled'
);
select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Attempt locked CRM loyalty enable'
     from public.resilience_feature_flags where code = 'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'CRM loyalty override cannot be enabled'
);

select lives_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', false, 'Reviewed dormant override remains disabled'
     from public.resilience_feature_flags where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED' $$,
  'a disabled Phase 3 override remains permitted'
);
select is(
  (
    select flag_override.enabled
    from public.resilience_feature_flag_overrides flag_override
    join public.resilience_feature_flags flag on flag.id = flag_override.flag_id
    where flag.code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED'
      and flag_override.scope_type = 'GLOBAL'
  ),
  false,
  'the permitted override is stored disabled'
);
select throws_ok(
  $$ update public.resilience_feature_flag_overrides flag_override
     set enabled = true
     from public.resilience_feature_flags flag
     where flag_override.flag_id = flag.id
       and flag.code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED'
       and flag_override.scope_type = 'GLOBAL' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'a disabled override cannot later be enabled'
);

select ok(
  (
    select bool_and(not app_private.evaluate_resilience_feature_flag(
      code,
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      null,
      'phase-three-hard-lock-test'
    ))
    from public.resilience_feature_flags
    where code in (
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'ONLINE_ORDER_PAYMENT_ENABLED',
      'RESERVATION_PREORDER_ENABLED',
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      'CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED'
    )
  ),
  'the shared SQL evaluator resolves all five Phase 3 flags off'
);
select is(
  app_private.digital_waitlist_enabled(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ),
  false,
  'digital waitlist evaluator fails closed'
);
select is(
  app_private.dynamic_qr_enabled(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ),
  false,
  'dynamic QR evaluator fails closed'
);
select is(
  app_private.crm_loyalty_foundation_enabled(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ),
  false,
  'CRM loyalty evaluator fails closed'
);

set local role service_role;
select throws_ok(
  $$ insert into public.resilience_feature_flag_overrides (flag_id, scope_type, enabled, reason)
     select id, 'GLOBAL', true, 'Service role attempted locked enable'
     from public.resilience_feature_flags where code = 'ONLINE_ORDER_PAYMENT_ENABLED' $$,
  '23514', 'RESILIENCE_PHASE_THREE_FLAG_LOCKED', 'service_role cannot bypass the database hard lock'
);
reset role;

select * from finish();
rollback;
