begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

select has_table('public', 'backend_runtime_state', 'backend runtime state exists');
select has_table('public', 'backend_failover_events', 'backend failover events exist');
select has_table('public', 'replication_health_snapshots', 'replication health snapshots exist');
select has_table('public', 'profile_auth_identities', 'project-specific auth identity mapping exists');
select has_table('public', 'storage_object_manifest', 'storage object manifest exists');
select has_table('public', 'storage_replication_jobs', 'storage replication jobs exist');

select is(
  (select count(*)::integer from public.backend_runtime_state where is_current),
  1,
  'one backend is current'
);
select is(
  (select backend_code from public.backend_runtime_state where is_current),
  'PRIMARY',
  'Primary is the initial current backend'
);
select is(
  (select enforcement_enabled from public.backend_runtime_state where is_current),
  false,
  'migration is backward-compatible and does not activate fencing'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.profile_auth_identities'::regclass
  ),
  'auth identities force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.storage_object_manifest'::regclass
  ),
  'storage manifests force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.profile_auth_identities', 'SELECT'),
  'anonymous cannot read auth identity mappings'
);
select ok(
  not has_table_privilege('authenticated', 'public.storage_object_manifest', 'SELECT'),
  'authenticated users cannot read storage replication metadata'
);
select ok(
  has_table_privilege('service_role', 'public.replication_health_snapshots', 'INSERT'),
  'service role may write sanitized replication observations'
);

select is(
  app_private.assert_backend_writable(),
  0::bigint,
  'guard remains compatible while project fencing setting is off'
);

insert into public.profiles (
  id,
  email,
  display_name,
  is_active,
  platform_role
)
values
  (
    'da100000-0000-4000-8000-000000000001',
    'dr-admin@example.test',
    'DR Admin',
    true,
    'PLATFORM_ADMIN'
  ),
  (
    'da100000-0000-4000-8000-000000000002',
    'dr-collision@example.test',
    'DR Collision',
    true,
    'STAFF'
  );

insert into public.profile_auth_identities (
  profile_id,
  auth_project_code,
  auth_user_id,
  provider,
  verified_email
)
values (
  'da100000-0000-4000-8000-000000000001',
  'DR',
  'da200000-0000-4000-8000-000000000001',
  'GOOGLE',
  'dr-admin@example.test'
);

select set_config(
  'request.jwt.claim.sub',
  'da200000-0000-4000-8000-000000000001',
  true
);

select is(
  app_private.current_profile_id(),
  'da100000-0000-4000-8000-000000000001'::uuid,
  'DR Auth identity resolves the existing profile'
);
select ok(
  app_private.is_current_profile(
    'da100000-0000-4000-8000-000000000001'::uuid
  ),
  'DR Auth identity passes current-profile authorization'
);
select ok(
  app_private.is_platform_admin(),
  'DR Auth identity preserves platform-admin authorization'
);

insert into public.profile_auth_identities (
  profile_id,
  auth_project_code,
  auth_user_id,
  provider,
  verified_email
)
values (
  'da100000-0000-4000-8000-000000000002',
  'DR_COLLISION',
  'da200000-0000-4000-8000-000000000001',
  'GOOGLE',
  'dr-collision@example.test'
);

select is(
  app_private.current_profile_id(),
  null::uuid,
  'ambiguous cross-project Auth identity fails closed'
);
select is(
  app_private.is_platform_admin(),
  false,
  'ambiguous Auth identity cannot inherit platform-admin authorization'
);

update public.backend_runtime_state
set enforcement_enabled = true
where backend_code = 'PRIMARY';
select set_config('app.backend_fencing_enabled', 'on', true);

select is(
  app_private.assert_backend_writable(1),
  1::bigint,
  'active Primary accepts the expected promotion epoch'
);

select throws_ok(
  $$ select app_private.assert_backend_writable(2) $$,
  '40001',
  'BACKEND_PROMOTION_EPOCH_MISMATCH',
  'stale promotion epoch is rejected'
);

update public.backend_runtime_state
set backend_role = 'SEALED',
    writes_enabled = false
where backend_code = 'PRIMARY';

select throws_ok(
  $$ select app_private.assert_backend_writable() $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'sealed backend rejects trusted writes'
);

select throws_ok(
  $$
    insert into public.resilience_feature_flags (
      code, description, default_enabled, is_emergency
    )
    values ('FENCING_TEST_FLAG', 'must be rejected by statement guard', false, false)
  $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'guarded business tables reject writes on a sealed backend'
);

select lives_ok(
  $$
    insert into public.backend_failover_events (
      state,
      source_backend_code,
      target_backend_code,
      reason,
      split_brain_acknowledged
    )
    values (
      'FAILOVER_ASSESSMENT',
      'PRIMARY',
      'DR',
      'pgTAP verifies environment-local incident recording remains available',
      false
    )
  $$,
  'environment-local failover evidence remains writable while sealed'
);

select * from finish();
rollback;
