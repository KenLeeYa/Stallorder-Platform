begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select has_function(
  'app_private',
  'evaluate_resilience_feature_flag',
  array['text', 'uuid', 'uuid', 'uuid', 'text'],
  'server-side resilience flag evaluator exists'
);
select has_function(
  'public',
  'check_public_order_intake_availability',
  array['text', 'uuid'],
  'trusted public order intake preflight exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.check_public_order_intake_availability(text,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the trusted intake preflight'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.check_public_order_intake_availability(text,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the trusted intake preflight'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.check_public_order_intake_availability(text,uuid)',
    'EXECUTE'
  ),
  'service role can call the trusted intake preflight'
);

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": true}'::jsonb,
  'QR order intake is available by default'
);
select is(
  public.check_public_order_intake_availability(
    'unknown-qr-token',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": true}'::jsonb,
  'unknown QR tokens continue to the authoritative QR validation'
);

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  enabled,
  expires_at,
  reason
)
select
  id,
  'GLOBAL',
  true,
  now() + interval '1 hour',
  'Exercise global QR degraded mode in the isolated database test.'
from public.resilience_feature_flags
where code = 'EMERGENCY_QR_DEGRADED_MODE';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_DEGRADED"}'::jsonb,
  'global emergency flag blocks new QR writes'
);

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  expires_at,
  reason
)
select
  id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  false,
  now() + interval '1 hour',
  'Allow the seeded organization during the isolated precedence test.'
from public.resilience_feature_flags
where code = 'EMERGENCY_QR_DEGRADED_MODE';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": true}'::jsonb,
  'organization override takes precedence over the global override'
);

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  stall_id,
  enabled,
  expires_at,
  reason
)
select
  id,
  'STALL',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  true,
  now() + interval '1 hour',
  'Block the seeded Stall during the isolated precedence test.'
from public.resilience_feature_flags
where code = 'EMERGENCY_QR_DEGRADED_MODE';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_DEGRADED"}'::jsonb,
  'Stall override takes precedence over the Organization override'
);

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  stall_id,
  device_id,
  enabled,
  expires_at,
  reason
)
select
  id,
  'DEVICE',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'de710000-0000-4000-8000-000000000001',
  false,
  now() + interval '1 hour',
  'Allow one device during the isolated precedence test.'
from public.resilience_feature_flags
where code = 'EMERGENCY_QR_DEGRADED_MODE';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": true}'::jsonb,
  'Device override takes precedence over the Stall override'
);

update public.resilience_feature_flag_overrides
set expires_at = now() - interval '1 second'
where scope_type = 'DEVICE'
  and device_id = 'de710000-0000-4000-8000-000000000001';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_DEGRADED"}'::jsonb,
  'expired Device override is ignored'
);

delete from public.resilience_feature_flag_overrides
where flag_id = (
  select id
  from public.resilience_feature_flags
  where code = 'EMERGENCY_QR_DEGRADED_MODE'
);

insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  enabled,
  rollout_percentage,
  expires_at,
  reason
)
select
  id,
  'PERCENTAGE',
  true,
  100,
  now() + interval '1 hour',
  'Exercise deterministic percentage rollout in the isolated database test.'
from public.resilience_feature_flags
where code = 'EMERGENCY_QR_DEGRADED_MODE';

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_DEGRADED"}'::jsonb,
  '100 percent rollout blocks the selected device'
);

update public.resilience_feature_flag_overrides
set rollout_percentage = 0
where scope_type = 'PERCENTAGE'
  and flag_id = (
    select id
    from public.resilience_feature_flags
    where code = 'EMERGENCY_QR_DEGRADED_MODE'
  );

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": true}'::jsonb,
  'zero percent rollout retains the default'
);

update public.backend_runtime_state
set
  backend_role = 'SEALED',
  writes_enabled = false,
  enforcement_enabled = true,
  reason = 'Seal the isolated backend for the QR availability test.'
where is_current;

select is(
  public.check_public_order_intake_availability(
    'demo-aming-chicken-qr-2026-rotate-me',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_UNAVAILABLE"}'::jsonb,
  'a fenced sealed backend blocks new QR writes'
);
select is(
  public.check_public_order_intake_availability(
    'unknown-qr-token',
    'de710000-0000-4000-8000-000000000001'
  ),
  '{"ok": false, "code": "QR_ORDERING_UNAVAILABLE"}'::jsonb,
  'backend fencing fails closed before QR details are resolved'
);

select * from finish();
rollback;
