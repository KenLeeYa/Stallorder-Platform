begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

select has_table('public', 'client_devices', 'client device registry exists');
select has_table('public', 'offline_stall_runtime_policy', 'offline Stall policy exists');
select has_table('public', 'menu_snapshots', 'immutable menu snapshots exist');
select has_table('public', 'offline_permits', 'offline permit registry exists');
select has_column('public', 'menu_snapshots', 'public_content_hash', 'menu snapshots track public content hash');
select has_column('public', 'menu_snapshots', 'public_object_path', 'menu snapshots track immutable object path');
select has_column('public', 'storage_object_manifest', 'content_type', 'storage replication preserves object content type');
select ok(
  (
    select public
      and file_size_limit = 6291456
      and allowed_mime_types = array['application/json']::text[]
    from storage.buckets
    where id = 'offline-menu-snapshots'
  ),
  'offline menu snapshot bucket is bounded and public-read'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'offline_menu_snapshots_public_read'
      and cmd <> 'SELECT'
  ),
  0,
  'offline menu snapshot policy never permits anonymous writes'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.client_devices'::regclass),
  'client devices force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.offline_stall_runtime_policy'::regclass),
  'offline Stall policy forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.menu_snapshots'::regclass),
  'menu snapshots force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.offline_permits'::regclass),
  'offline permits force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.client_devices', 'SELECT'),
  'anonymous users cannot enumerate devices'
);
select ok(
  not has_table_privilege('authenticated', 'public.client_devices', 'INSERT'),
  'authenticated users cannot self-approve a device'
);
select ok(
  not has_table_privilege('authenticated', 'public.offline_permits', 'SELECT'),
  'authenticated users cannot read permit hashes directly'
);
select ok(
  has_table_privilege('service_role', 'public.client_devices', 'INSERT'),
  'trusted server may register devices'
);

select has_index(
  'public',
  'client_devices',
  'client_devices_one_offline_leader',
  'database has the one-Leader-per-Stall constraint'
);

insert into public.client_devices (
  id,
  organization_id,
  stall_id,
  profile_id,
  installation_id,
  display_name,
  platform,
  app_version,
  pwa_installed,
  offline_enabled,
  offline_role,
  status
)
values (
  'a1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555552',
  'a2000000-0000-4000-8000-000000000001',
  '測試櫃台平板',
  'iPadOS',
  '1.0.0',
  true,
  true,
  'OFFLINE_LEADER',
  'ACTIVE'
);

select is(
  (select count(*)::integer from public.client_devices where offline_role = 'OFFLINE_LEADER'),
  1,
  'approved offline Leader can be registered'
);

select throws_ok(
  $$
    insert into public.client_devices (
      organization_id,
      stall_id,
      profile_id,
      installation_id,
      display_name,
      platform,
      app_version,
      pwa_installed,
      offline_enabled,
      offline_role,
      status
    )
    values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '55555555-5555-4555-8555-555555555551',
      'a2000000-0000-4000-8000-000000000002',
      '第二台 Leader',
      'Android',
      '1.0.0',
      true,
      true,
      'OFFLINE_LEADER',
      'ACTIVE'
    )
  $$,
  '23505',
  null,
  'a Stall cannot have two active offline Leaders'
);

insert into public.offline_stall_runtime_policy (
  organization_id,
  stall_id,
  offline_enabled,
  offline_write_mode,
  offline_leader_device_id,
  max_offline_duration_minutes,
  max_pending_orders,
  max_total_amount,
  max_single_order_amount
)
values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  true,
  'SINGLE_DEVICE_ONLY',
  'a1000000-0000-4000-8000-000000000001',
  120,
  25,
  10000,
  2000
);

select is(
  (
    select offline_write_mode
    from public.offline_stall_runtime_policy
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  'SINGLE_DEVICE_ONLY',
  'single-device policy is persisted'
);

insert into public.client_devices (
  id,
  organization_id,
  stall_id,
  profile_id,
  installation_id,
  display_name,
  platform,
  app_version,
  offline_enabled,
  offline_role,
  status
)
values (
  'a1000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555552',
  'a2000000-0000-4000-8000-000000000003',
  '唯讀平板',
  'Android',
  '1.0.0',
  true,
  'OFFLINE_READ_ONLY',
  'ACTIVE'
);

select throws_ok(
  $$
    update public.offline_stall_runtime_policy
    set offline_leader_device_id = 'a1000000-0000-4000-8000-000000000002'
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '23514',
  'OFFLINE_POLICY_LEADER_SCOPE_MISMATCH',
  'read-only devices cannot be assigned as offline Leader'
);

insert into public.menu_snapshots (
  id,
  organization_id,
  stall_id,
  version,
  content_hash,
  public_content_hash,
  public_object_path,
  catalog_json,
  currency,
  generated_at,
  expires_at
)
values (
  'a3000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  900001,
  repeat('a', 64),
  repeat('b', 64),
  format(
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/900001-%s.json',
    repeat('b', 64)
  ),
  '{"categories":[],"products":[],"paymentOptions":[{"kind":"CASH"}]}'::jsonb,
  'TWD',
  now(),
  now() + interval '12 hours'
);

select is(
  (select version from public.menu_snapshots where id = 'a3000000-0000-4000-8000-000000000001'),
  900001,
  'bounded menu snapshot is stored'
);

select throws_ok(
  $$
    update public.menu_snapshots
    set catalog_json = '{"categories":[],"products":[]}'::jsonb
    where id = 'a3000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'MENU_SNAPSHOT_IMMUTABLE',
  'published menu snapshots cannot be edited'
);

select throws_ok(
  $$
    insert into public.offline_permits (
      organization_id,
      stall_id,
      device_id,
      profile_id,
      menu_snapshot_id,
      menu_snapshot_version,
      token_hash,
      roles_json,
      allowed_actions_json,
      promotion_epoch,
      issued_at,
      expires_at
    )
    values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'a1000000-0000-4000-8000-000000000001',
      '55555555-5555-4555-8555-555555555552',
      'a3000000-0000-4000-8000-000000000001',
      900001,
      repeat('b', 64),
      '["STAFF"]'::jsonb,
      '["CREATE_OFFLINE_ORDER"]'::jsonb,
      1,
      now(),
      now() + interval '13 hours'
    )
  $$,
  '23514',
  null,
  'permit cannot exceed the approved shift or 12-hour ceiling'
);

insert into public.offline_permits (
  id,
  organization_id,
  stall_id,
  device_id,
  profile_id,
  menu_snapshot_id,
  menu_snapshot_version,
  token_hash,
  roles_json,
  allowed_actions_json,
  promotion_epoch,
  issued_at,
  expires_at
)
values (
  'a4000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'a1000000-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555552',
  'a3000000-0000-4000-8000-000000000001',
  900001,
  repeat('c', 64),
  '["STAFF"]'::jsonb,
  '["CREATE_OFFLINE_ORDER"]'::jsonb,
  1,
  now(),
  now() + interval '90 minutes'
);

select is(
  (select status from public.offline_permits where id = 'a4000000-0000-4000-8000-000000000001'),
  'ACTIVE',
  'valid device-bound Permit is stored'
);

select throws_ok(
  $$
    insert into public.offline_permits (
      organization_id,
      stall_id,
      device_id,
      profile_id,
      menu_snapshot_id,
      menu_snapshot_version,
      token_hash,
      roles_json,
      allowed_actions_json,
      promotion_epoch,
      expires_at
    )
    values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'a1000000-0000-4000-8000-000000000001',
      '55555555-5555-4555-8555-555555555552',
      'a3000000-0000-4000-8000-000000000001',
      900001,
      repeat('d', 64),
      '["STAFF"]'::jsonb,
      '["CREATE_OFFLINE_ORDER"]'::jsonb,
      1,
      now() + interval '60 minutes'
    )
  $$,
  '23505',
  null,
  'only one active Permit exists per device'
);

select throws_ok(
  $$
    update public.offline_permits
    set menu_snapshot_version = 999
    where id = 'a4000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'OFFLINE_PERMIT_SCOPE_IMMUTABLE',
  'Permit cannot be rebound to a different snapshot version'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgname = 'backend_writable_guard'
      and tgrelid in (
        'public.client_devices'::regclass,
        'public.offline_stall_runtime_policy'::regclass,
        'public.menu_snapshots'::regclass,
        'public.offline_permits'::regclass
      )
      and not tgisinternal
  ),
  4,
  'all offline foundation tables use backend fencing'
);

select has_column(
  'public',
  'offline_permits',
  'token_hash',
  'only a token hash is persisted'
);

select hasnt_column(
  'public',
  'offline_permits',
  'token',
  'raw Permit tokens have no database column'
);

select ok(
  not has_table_privilege('service_role', 'public.menu_snapshots', 'UPDATE'),
  'trusted runtime cannot mutate a published menu snapshot'
);

select ok(
  not has_table_privilege('authenticated', 'public.offline_stall_runtime_policy', 'UPDATE'),
  'merchant browser cannot directly tamper with offline limits'
);

select ok(
  not has_table_privilege('authenticated', 'public.menu_snapshots', 'SELECT'),
  'authenticated browser cannot bypass the trusted bootstrap projection'
);

select * from finish();
rollback;
