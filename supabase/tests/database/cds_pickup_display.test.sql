begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'existing stalls receive one pickup display setting row'
);
select is(
  (select is_active from public.pickup_display_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  false,
  'pickup display is opt-in after migration'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  'cd510000-0000-4000-8000-000000000001', 'Other CDS org', 'other-cds-org',
  'Other CDS org', 'ACTIVE', 'other-cds@stallorder.test', '0900000088', now()
);
insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  'cd515000-0000-4000-8000-000000000001',
  'cd510000-0000-4000-8000-000000000001', id, 'ACTIVE',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'cd520000-0000-4000-8000-000000000001',
  'cd510000-0000-4000-8000-000000000001', 'Other CDS stall', 'other-cds-stall',
  'OTHER-CDS', 'Other address', 'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = 'cd520000-0000-4000-8000-000000000001'),
  1,
  'new stalls automatically receive pickup display settings'
);

select throws_ok(
  $$
    update public.pickup_display_settings
    set organization_id = 'cd510000-0000-4000-8000-000000000001'
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  'P0001',
  'PICKUP_DISPLAY_STALL_SCOPE_MISMATCH',
  'organization and stall scope cannot be reassigned across tenants'
);
select throws_ok(
  $$
    update public.pickup_display_settings
    set display_token_hash = 'raw-token-must-not-be-stored'
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '23514',
  null,
  'display tokens must be stored as SHA-256 hashes'
);

update public.pickup_display_settings
set display_token_hash = repeat('a', 64)
where stall_id = '22222222-2222-4222-8222-222222222222';
select throws_ok(
  $$
    update public.pickup_display_settings
    set display_token_hash = repeat('a', 64)
    where stall_id = 'cd520000-0000-4000-8000-000000000001'
  $$,
  '23505',
  null,
  'display token hashes are unique and cannot cross stalls'
);

select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.pickup_display_settings'::regclass),
  'pickup display settings enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.pickup_display_settings', 'SELECT'),
  'anonymous users cannot read pickup display settings directly'
);
select ok(
  not has_table_privilege('anon', 'public.pickup_display_settings', 'INSERT')
  and not has_table_privilege('anon', 'public.pickup_display_settings', 'UPDATE'),
  'anonymous users cannot write pickup display settings directly'
);
select ok(
  has_table_privilege('authenticated', 'public.pickup_display_settings', 'SELECT')
  and not has_table_privilege('authenticated', 'public.pickup_display_settings', 'UPDATE'),
  'authenticated clients have read-only table grants behind manager RLS'
);

select ok(
  exists (
    select 1 from public.plan_entitlements
    where feature_code = 'CDS' and is_enabled
  ),
  'CDS is enforced by server-side plan entitlements'
);
select is(
  (select (entitlement.configuration_json ->> 'voiceAnnouncements')::boolean
   from public.plan_entitlements entitlement
   join public.plan_versions version on version.id = entitlement.plan_version_id
   join public.plans plan on plan.id = version.plan_id
   where plan.code = 'LITE'
     and version.effective_from <= now()
     and (version.effective_until is null or version.effective_until > now())
     and entitlement.feature_code = 'CDS'),
  false,
  'Lite includes basic CDS without voice announcements'
);
select is(
  (select (entitlement.configuration_json ->> 'voiceAnnouncements')::boolean
   from public.plan_entitlements entitlement
   join public.plan_versions version on version.id = entitlement.plan_version_id
   join public.plans plan on plan.id = version.plan_id
   where plan.code = 'STANDARD'
     and version.effective_from <= now()
     and (version.effective_until is null or version.effective_until > now())
     and entitlement.feature_code = 'CDS'),
  true,
  'Standard includes CDS voice announcements'
);
select lives_ok(
  $$
    insert into public.operational_alerts (
      organization_id, stall_id, alert_type, severity, message
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'CDS_DISCONNECTED', 'WARNING', 'CDS heartbeat missing'
    )
  $$,
  'CDS disconnected is a supported operational alert type'
);

insert into auth.users (id, email) values
  ('cd530000-0000-4000-8000-000000000001', 'cds-owner-auth@stallorder.test'),
  ('cd530000-0000-4000-8000-000000000002', 'cds-staff-auth@stallorder.test'),
  ('cd530000-0000-4000-8000-000000000003', 'cds-kitchen-auth@stallorder.test');
update public.profiles set auth_user_id = 'cd530000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'cd530000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555552';
update public.profiles set auth_user_id = 'cd530000-0000-4000-8000-000000000003'
where id = '55555555-5555-4555-8555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'cd530000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'organization owner can read CDS settings for an authorized stall'
);
select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = 'cd520000-0000-4000-8000-000000000001'),
  0,
  'organization owner cannot read another organization CDS settings'
);

select set_config('request.jwt.claim.sub', 'cd530000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'staff cannot read CDS management settings'
);

select set_config('request.jwt.claim.sub', 'cd530000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.pickup_display_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'kitchen cannot read CDS management settings'
);

reset role;
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'pickup_display_settings'
      and grantee = 'anon'
  ),
  'pickup display settings have no anonymous Data API grants'
);

select * from finish();
rollback;
