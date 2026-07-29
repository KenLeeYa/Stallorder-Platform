begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select is(
  app_private.assert_backend_writable(),
  0::bigint,
  'backward-compatible runtime remains unfenced until an approved transition'
);

select lives_ok(
  $$
    select *
    from app_private.transition_backend_runtime(
      'PRIMARY',
      1,
      'PRIMARY',
      'ACTIVE_WRITER',
      1,
      'Enable Primary fencing for the isolated database test.',
      null
    )
  $$,
  'Primary fencing can be enabled without changing the promotion epoch'
);

select is(
  app_private.assert_backend_writable(1),
  1::bigint,
  'fenced active writer accepts the current promotion epoch'
);

select lives_ok(
  $$
    select *
    from app_private.transition_backend_runtime(
      'PRIMARY',
      1,
      'PRIMARY',
      'SEALED',
      1,
      'Freeze Primary writes during the isolated failover test.',
      null
    )
  $$,
  'active writer can be sealed'
);

select throws_ok(
  $$ select app_private.assert_backend_writable(1) $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'sealed Primary rejects writes'
);

select lives_ok(
  $$
    select *
    from app_private.transition_backend_runtime(
      'PRIMARY',
      1,
      'PRIMARY',
      'ACTIVE_WRITER',
      1,
      'Rollback the isolated write freeze before any DR promotion.',
      null
    )
  $$,
  'pre-promotion rollback can restore Primary at the same epoch'
);

select throws_ok(
  $$
    select *
    from app_private.transition_backend_runtime(
      'PRIMARY',
      1,
      'DR',
      'READ_ONLY_STANDBY',
      1,
      'Attempt an unsafe local backend identity replacement.',
      null
    )
  $$,
  '55000',
  'BACKEND_LOCAL_IDENTITY_ALREADY_FENCED',
  'a fenced project cannot silently change its local backend identity'
);

update public.backend_runtime_state
set
  enforcement_enabled = false,
  reason = 'Prepare the isolated DR identity initialization test.'
where backend_code = 'PRIMARY';

select lives_ok(
  $$
    select *
    from app_private.transition_backend_runtime(
      'PRIMARY',
      1,
      'DR',
      'READ_ONLY_STANDBY',
      1,
      'Initialize the isolated project as the fenced DR standby.',
      null
    )
  $$,
  'an unfenced migration default can be initialized as the DR standby'
);

select is(
  (select backend_code from public.backend_runtime_state where is_current),
  'DR',
  'DR becomes the environment-local current identity'
);

select throws_ok(
  $$ select app_private.assert_backend_writable(1) $$,
  '55000',
  'BACKEND_NOT_WRITABLE',
  'read-only standby rejects trusted writes'
);

select ok(
  not has_function_privilege(
    'service_role',
    'app_private.transition_backend_runtime(text,bigint,text,text,bigint,text,uuid)',
    'EXECUTE'
  ),
  'service role cannot promote or demote a backend'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.backend_runtime_state'::regclass
  ),
  'backend runtime state keeps forced RLS'
);

select * from finish();
rollback;
