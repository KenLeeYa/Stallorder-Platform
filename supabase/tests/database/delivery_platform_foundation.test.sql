begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

select is(
  (
    select count(*)::integer
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'delivery_platform_connections',
        'delivery_platform_connection_requests',
        'external_store_mappings',
        'external_menu_mappings',
        'external_orders',
        'delivery_webhook_events',
        'delivery_sync_jobs'
      )
  ),
  7,
  'all provider-neutral delivery tables exist'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where oid in (
      'public.delivery_platform_connections'::regclass,
      'public.delivery_platform_connection_requests'::regclass,
      'public.external_store_mappings'::regclass,
      'public.external_menu_mappings'::regclass,
      'public.external_orders'::regclass,
      'public.delivery_webhook_events'::regclass,
      'public.delivery_sync_jobs'::regclass
    )
      and relrowsecurity
      and relforcerowsecurity
  ),
  7,
  'all exposed delivery tables enable and force RLS'
);

select is(
  (
    select count(*)::integer
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in (
        'delivery_platform_connections',
        'delivery_platform_connection_requests',
        'external_store_mappings',
        'external_menu_mappings',
        'external_orders',
        'delivery_webhook_events',
        'delivery_sync_jobs'
      )
  ),
  0,
  'anonymous Data API role has no delivery table grants'
);

select ok(
  not has_table_privilege('authenticated', 'public.delivery_platform_connections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.external_orders', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.delivery_sync_jobs', 'SELECT'),
  'authenticated Data API users cannot write delivery state or inspect the worker queue'
);

select ok(
  has_table_privilege('service_role', 'public.delivery_platform_connections', 'INSERT')
  and has_table_privilege('service_role', 'public.external_orders', 'UPDATE')
  and has_table_privilege('service_role', 'public.delivery_sync_jobs', 'DELETE'),
  'trusted service role can operate delivery state'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where not tgisinternal
      and tgname like '%_primary_writer_guard'
      and tgrelid in (
        'public.delivery_platform_connections'::regclass,
        'public.delivery_platform_connection_requests'::regclass,
        'public.external_store_mappings'::regclass,
        'public.external_menu_mappings'::regclass,
        'public.external_orders'::regclass,
        'public.delivery_webhook_events'::regclass,
        'public.delivery_sync_jobs'::regclass
      )
  ),
  7,
  'every delivery writer table is protected by the primary-writer guard'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in (
        'external_provider',
        'external_order_id',
        'external_order_number',
        'external_payment_status',
        'merchant_receivable_amount'
      )
  ),
  5,
  'canonical orders retain external source and reconciliation fields'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_delivery_fields_check'
  ) like '%origin = ''IMPORTED''%'
  and (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_delivery_fields_check'
  ) like '%external_provider IS NOT NULL%',
  'provider-imported delivery orders do not require provider-owned address or phone fields'
);

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.operational_alerts'::regclass
      and conname = 'operational_alerts_alert_type_check'
  ) like '%DELIVERY_ORDER_MAPPING_REQUIRED%'
  and (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.operational_alerts'::regclass
      and conname = 'operational_alerts_alert_type_check'
  ) like '%DELIVERY_JOB_DEAD_LETTER%',
  'delivery mapping and dead-letter alerts are allowed operational alert types'
);

insert into auth.users (id, email) values
  ('d1111111-1111-4111-8111-111111111111', 'delivery-owner@stallorder.test'),
  ('d2222222-2222-4222-8222-222222222222', 'delivery-kitchen@stallorder.test'),
  ('d9999999-9999-4999-8999-999999999999', 'delivery-other-owner@stallorder.test');

update public.profiles
set auth_user_id = 'd1111111-1111-4111-8111-111111111111'
where id = '55555555-5555-4555-8555-555555555551';

update public.profiles
set auth_user_id = 'd2222222-2222-4222-8222-222222222222'
where id = '55555555-5555-4555-8555-555555555553';

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  'd9000000-0000-4000-8000-000000000001',
  '外送隔離測試組織',
  'delivery-isolated-organization',
  '外送隔離測試組織',
  'ACTIVE',
  'delivery-other-owner@stallorder.test',
  '0900-000-001',
  now()
);

insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values (
  'd9000000-0000-4000-8000-000000000002',
  'd9999999-9999-4999-8999-999999999999',
  'delivery-other-owner@stallorder.test',
  '外送隔離擁有者',
  true,
  now()
);

insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
)
select
  'd9000000-0000-4000-8000-000000000004',
  'd9000000-0000-4000-8000-000000000001',
  id,
  'ACTIVE',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans
where code = 'STANDARD';

insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  'd9000000-0000-4000-8000-000000000001',
  'd9000000-0000-4000-8000-000000000002',
  'ORGANIZATION_OWNER',
  true,
  true
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'd9000000-0000-4000-8000-000000000003',
  'd9000000-0000-4000-8000-000000000001',
  '外送隔離測試攤位',
  'delivery-isolated-stall',
  'DELIVERY-OTHER',
  '高雄市測試路 1 號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);

insert into public.delivery_platform_connections (
  id, organization_id, stall_id, provider, status
) values
  (
    'd1000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'MOCK',
    'DRAFT'
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'd9000000-0000-4000-8000-000000000001',
    'd9000000-0000-4000-8000-000000000003',
    'MOCK',
    'DRAFT'
  );

select throws_ok(
  $$
    insert into public.delivery_platform_connections (
      organization_id, stall_id, provider, status, credential_reference
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'UBER_EATS',
      'DRAFT',
      'raw-provider-secret'
    )
  $$,
  '23514',
  null,
  'raw provider credentials cannot be persisted'
);

select throws_ok(
  $$
    insert into public.delivery_platform_connections (
      organization_id, stall_id, provider, status, oauth_pkce_verifier_reference
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'FOODPANDA',
      'DRAFT',
      'plain-pkce-verifier'
    )
  $$,
  '23514',
  null,
  'raw OAuth PKCE verifiers cannot be persisted'
);

select throws_ok(
  $$
    insert into public.delivery_platform_connections (
      organization_id, stall_id, provider, status
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'MOCK',
      'DRAFT'
    )
  $$,
  '23505',
  null,
  'one stall cannot have duplicate open connections for one provider'
);

insert into public.delivery_webhook_events (
  id, provider, connection_id, organization_id, stall_id, event_type,
  signature_valid, replay_key, payload_hash
) values (
  'd2000000-0000-4000-8000-000000000001',
  'MOCK',
  'd1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'ORDER_CREATED',
  true,
  repeat('a', 64),
  repeat('b', 64)
);

select lives_ok(
  $$
    insert into public.delivery_webhook_events (
      provider, connection_id, organization_id, stall_id, event_type,
      signature_valid, replay_key, payload_hash
    ) values (
      'MOCK',
      'd1000000-0000-4000-8000-000000000002',
      'd9000000-0000-4000-8000-000000000001',
      'd9000000-0000-4000-8000-000000000003',
      'ORDER_CREATED',
      true,
      repeat('a', 64),
      repeat('c', 64)
    )
  $$,
  'the same provider replay key can be recorded for a different connection'
);

select throws_ok(
  $$
    insert into public.delivery_webhook_events (
      provider, connection_id, organization_id, stall_id, event_type,
      signature_valid, replay_key, payload_hash
    ) values (
      'MOCK',
      'd1000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'ORDER_CREATED',
      true,
      repeat('a', 64),
      repeat('d', 64)
    )
  $$,
  '23505',
  null,
  'a provider webhook replay key can be recorded only once per connection'
);

insert into public.delivery_sync_jobs (
  id, organization_id, stall_id, connection_id, provider, job_type,
  deduplication_key
) values (
  'd3000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'd1000000-0000-4000-8000-000000000001',
  'MOCK',
  'CONNECTION_HEALTH_CHECK',
  'delivery-test-deduplication'
);

select throws_ok(
  $$
    insert into public.delivery_sync_jobs (
      organization_id, stall_id, connection_id, provider, job_type,
      deduplication_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'd1000000-0000-4000-8000-000000000001',
      'MOCK',
      'CONNECTION_HEALTH_CHECK',
      'delivery-test-deduplication'
    )
  $$,
  '23505',
  null,
  'delivery jobs are idempotent by connection, provider and deduplication key'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*)::integer from public.delivery_platform_connections),
  1,
  'organization owner sees only connections in the authorized organization'
);
select is(
  (
    select count(*)::integer
    from public.delivery_platform_connections
    where organization_id = 'd9000000-0000-4000-8000-000000000001'
  ),
  0,
  'forged organization filters do not bypass delivery connection RLS'
);

select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::integer from public.delivery_platform_connections),
  0,
  'kitchen role cannot read provider credentials or connection configuration'
);
select ok(
  not has_table_privilege(current_user, 'public.delivery_webhook_events', 'SELECT'),
  'authenticated users have no privilege to inspect webhook security evidence'
);
select ok(
  not has_table_privilege(current_user, 'public.delivery_sync_jobs', 'SELECT'),
  'authenticated users have no privilege to inspect the delivery worker queue'
);

select set_config('request.jwt.claim.sub', 'd9999999-9999-4999-8999-999999999999', true);
select is(
  (select count(*)::integer from public.delivery_platform_connections),
  1,
  'a second organization owner sees only the second organization connection'
);

select * from finish();
rollback;
