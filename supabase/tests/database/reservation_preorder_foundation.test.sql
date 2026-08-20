begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(45);

select has_table('public', 'reservations', 'reservation authority table exists');
select has_table('public', 'reservation_preorder_sessions', 'reservation preorder session is a separate table');
select has_column('public', 'reservations', 'local_business_date', 'reservation persists its local business date');
select has_column('public', 'reservation_preorder_sessions', 'reservation_version', 'session snapshots the reservation version');

select ok(
  (select not default_enabled from public.resilience_feature_flags where code = 'RESERVATION_PREORDER_ENABLED'),
  'reservation preorder feature defaults off'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.reservations'::regclass),
  'reservations force RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.reservation_preorder_sessions'::regclass),
  'reservation preorder sessions force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.reservations', 'SELECT')
  and not has_table_privilege('anon', 'public.reservation_preorder_sessions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.reservations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.reservation_preorder_sessions', 'INSERT'),
  'untrusted roles cannot read tokens or mutate reservation state'
);
select ok(
  has_column_privilege('authenticated', 'public.reservations', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.reservation_preorder_sessions', 'id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.reservations', 'public_token_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.reservation_preorder_sessions', 'token_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.reservation_preorder_sessions', 'device_hash', 'SELECT'),
  'authenticated staff receive policy-filtered reads without token or device hashes'
);
select ok(
  has_function_privilege(
    'service_role',
    'app_private.issue_reservation_preorder_session(text,text,text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'app_private.issue_reservation_preorder_session(text,text,text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'app_private.issue_reservation_preorder_session(text,text,text,uuid,text)',
    'EXECUTE'
  ),
  'only trusted service role can issue reservation preorder sessions'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, location,
  is_active, is_sold_out, business_status, ordering_enabled, ordering_state,
  currency, timezone
) values
  (
    'b3100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Reservation enabled stall', 'reservation-enabled-stall', 'RESERVE-01',
    'Local database only', 'Local database only',
    true, false, 'OPEN', true, 'OPEN', 'TWD', 'Asia/Taipei'
  ),
  (
    'b3100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Reservation disabled stall', 'reservation-disabled-stall', 'RESERVE-02',
    'Local database only', 'Local database only',
    true, false, 'OPEN', true, 'OPEN', 'TWD', 'Asia/Taipei'
  );

insert into public.dining_tables (
  id, organization_id, stall_id, code, label, is_active
) values
  (
    'b3200000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'R1', 'Reservation table 1', true
  ),
  (
    'b3200000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'R2', 'Reservation table 2', true
  ),
  (
    'b3200000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000002',
    'R3', 'Reservation table 3', true
  );

-- Owner-only test fixture: exercise the dormant implementation without
-- weakening the Production role boundary. This DDL change rolls back here.
alter table public.resilience_feature_flag_overrides
  disable trigger resilience_feature_flag_overrides_phase_three_lock_guard;

insert into public.resilience_feature_flag_overrides (
  flag_id, scope_type, organization_id, stall_id, enabled, reason
)
select
  id, 'STALL',
  '11111111-1111-4111-8111-111111111111',
  'b3100000-0000-4000-8000-000000000001',
  true, 'Enable local reservation contract test'
from public.resilience_feature_flags
where code = 'RESERVATION_PREORDER_ENABLED';

create temporary table pg_temp.reservation_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.reservation_results values (
  'cross_midnight',
  app_private.create_reservation(
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'b3200000-0000-4000-8000-000000000001',
    repeat('a', 64), 4::smallint,
    '2099-01-01 15:30:00+00', '2099-01-01 17:00:00+00',
    'Asia/Taipei', 'reservation-cross-midnight', null
  )
);

select ok(
  (select (value->>'ok')::boolean from pg_temp.reservation_results where name = 'cross_midnight'),
  'creates a confirmed reservation when the feature is enabled'
);
select is(
  (
    select local_business_date
    from public.reservations
    where id = ((select value->>'reservationId' from pg_temp.reservation_results where name = 'cross_midnight'))::uuid
  ),
  '2099-01-01'::date,
  'cross-midnight reservation belongs to its local starting business date'
);
select is(
  (
    select (ends_at at time zone timezone)::date
    from public.reservations
    where id = ((select value->>'reservationId' from pg_temp.reservation_results where name = 'cross_midnight'))::uuid
  ),
  '2099-01-02'::date,
  'cross-midnight end retains the following local date'
);
select is(
  (
    select preorder_cutoff_at
    from public.reservations
    where id = ((select value->>'reservationId' from pg_temp.reservation_results where name = 'cross_midnight'))::uuid
  ),
  '2099-01-01 15:00:00+00'::timestamptz,
  'preorder cutoff is persisted at T-30 minutes'
);
select is(
  (
    select deposit_amount::integer
      || ':' || deposit_status || ':' || refund_status
    from public.reservations
    where id = ((select value->>'reservationId' from pg_temp.reservation_results where name = 'cross_midnight'))::uuid
  ),
  '0:NOT_REQUIRED:NOT_APPLICABLE',
  'foundation cannot claim a deposit or refund'
);

insert into pg_temp.reservation_results values (
  'overlap',
  app_private.create_reservation(
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'b3200000-0000-4000-8000-000000000001',
    repeat('b', 64), 2::smallint,
    '2099-01-01 16:00:00+00', '2099-01-01 17:30:00+00',
    'Asia/Taipei', 'reservation-overlap', null
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'overlap'),
  'RESERVATION_CAPACITY_UNAVAILABLE',
  'overlapping confirmed reservation is rejected'
);
select is(
  (select count(*)::integer from public.reservations where dining_table_id = 'b3200000-0000-4000-8000-000000000001'),
  1,
  'failed overlap creates no reservation row'
);

insert into pg_temp.reservation_results values (
  'adjacent',
  app_private.create_reservation(
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'b3200000-0000-4000-8000-000000000001',
    repeat('c', 64), 2::smallint,
    '2099-01-01 17:00:00+00', '2099-01-01 18:00:00+00',
    'Asia/Taipei', 'reservation-adjacent', null
  )
);
select ok(
  (select (value->>'ok')::boolean from pg_temp.reservation_results where name = 'adjacent'),
  'half-open capacity permits an adjacent reservation'
);

select throws_ok(
  $$
    insert into public.reservations (
      organization_id, stall_id, dining_table_id, public_token_hash,
      party_size, starts_at, ends_at, timezone
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'b3100000-0000-4000-8000-000000000002',
      'b3200000-0000-4000-8000-000000000001',
      repeat('d', 64), 2,
      now() + interval '5 hours', now() + interval '6 hours',
      'Asia/Taipei'
    )
  $$,
  '23503',
  null,
  'composite foreign key rejects cross-stall table scope'
);

select throws_ok(
  $$
    insert into public.reservations (
      organization_id, stall_id, dining_table_id, public_token_hash,
      party_size, starts_at, ends_at, timezone
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'b3100000-0000-4000-8000-000000000001',
      'b3200000-0000-4000-8000-000000000002',
      repeat('4', 64), 2,
      now() + interval '8 hours', now() + interval '9 hours',
      'Mars/Olympus'
    )
  $$,
  '22023',
  'RESERVATION_TIMEZONE_INVALID',
  'unknown timezone is rejected before persistence'
);

insert into public.reservations (
  id, organization_id, stall_id, dining_table_id, public_token_hash,
  party_size, starts_at, ends_at, timezone
) values (
  'b3300000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  'b3100000-0000-4000-8000-000000000002',
  'b3200000-0000-4000-8000-000000000003',
  repeat('e', 64), 2,
  now() + interval '4 hours', now() + interval '5 hours',
  'Asia/Taipei'
);

insert into pg_temp.reservation_results values (
  'flag_off',
  app_private.issue_reservation_preorder_session(
    repeat('e', 64), repeat('1', 64), repeat('2', 64),
    'b3400000-0000-4000-8000-000000000001', 'reservation-flag-off'
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'flag_off'),
  'RESERVATION_FEATURE_DISABLED',
  'default-off flag blocks session issuance'
);

insert into pg_temp.reservation_results values (
  'cancel_while_off',
  app_private.cancel_reservation(
    'b3300000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000002',
    1, 'CUSTOMER_REQUEST', 'reservation-cancel-while-off', null
  )
);
select is(
  (select value->>'status' from pg_temp.reservation_results where name = 'cancel_while_off'),
  'CANCELLED',
  'kill switch does not trap an existing reservation from cancellation'
);

insert into pg_temp.reservation_results values (
  'invalid',
  app_private.issue_reservation_preorder_session(
    repeat('f', 64), repeat('3', 64), repeat('4', 64),
    'b3400000-0000-4000-8000-000000000002', 'reservation-invalid'
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'invalid'),
  'RESERVATION_INVALID',
  'unknown reservation token fails closed'
);

insert into pg_temp.reservation_results values (
  'not_open',
  app_private.issue_reservation_preorder_session(
    repeat('a', 64), repeat('a', 64), repeat('b', 64),
    'b3400000-0000-4000-8000-000000000006', 'reservation-not-open'
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'not_open'),
  'RESERVATION_PREORDER_NOT_OPEN',
  'reservation cannot issue a session before the T-24 hour window'
);

insert into public.reservations (
  id, organization_id, stall_id, dining_table_id, public_token_hash,
  party_size, starts_at, ends_at, timezone
) values (
  'b3300000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111',
  'b3100000-0000-4000-8000-000000000001',
  'b3200000-0000-4000-8000-000000000002',
  repeat('5', 64), 2,
  now() + interval '20 minutes', now() + interval '80 minutes',
  'Asia/Taipei'
);
insert into pg_temp.reservation_results values (
  'preorder_cutoff',
  app_private.issue_reservation_preorder_session(
    repeat('5', 64), repeat('c', 64), repeat('d', 64),
    'b3400000-0000-4000-8000-000000000007', 'reservation-preorder-cutoff'
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'preorder_cutoff'),
  'RESERVATION_PREORDER_CUTOFF_REACHED',
  'reservation cannot issue a session after the T-30 minute cutoff'
);

insert into pg_temp.reservation_results values (
  'modify_cutoff',
  app_private.modify_reservation(
    'b3300000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    1,
    'b3200000-0000-4000-8000-000000000002',
    2::smallint,
    now() + interval '5 hours', now() + interval '6 hours',
    'Asia/Taipei', 'reservation-modify-cutoff', null
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'modify_cutoff'),
  'RESERVATION_MODIFICATION_CUTOFF_REACHED',
  'reservation modification fails after the T-2 hour cutoff'
);

insert into pg_temp.reservation_results values (
  'cancel_cutoff',
  app_private.cancel_reservation(
    'b3300000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    1, 'CUSTOMER_REQUEST', 'reservation-cancel-cutoff', null
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'cancel_cutoff'),
  'RESERVATION_CANCELLATION_CUTOFF_REACHED',
  'reservation cancellation fails after the T-2 hour cutoff'
);
select is(
  (select status from public.reservations where id = 'b3300000-0000-4000-8000-000000000004'),
  'CONFIRMED',
  'cutoff failures leave the reservation state unchanged'
);
select is(
  (select count(*)::integer from public.reservation_preorder_sessions),
  0,
  'invalid and disabled reservations create no session'
);

insert into pg_temp.reservation_results values (
  'session_reservation',
  app_private.create_reservation(
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    'b3200000-0000-4000-8000-000000000002',
    repeat('6', 64), 3::smallint,
    now() + interval '4 hours', now() + interval '5 hours',
    'Asia/Taipei', 'reservation-session-create', null
  )
);
insert into pg_temp.reservation_results values (
  'session_issue',
  app_private.issue_reservation_preorder_session(
    repeat('6', 64), repeat('7', 64), repeat('8', 64),
    'b3400000-0000-4000-8000-000000000003', 'reservation-session-issue'
  )
);
select ok(
  (select (value->>'ok')::boolean from pg_temp.reservation_results where name = 'session_issue'),
  'valid confirmed reservation receives a preorder session'
);
select is(
  (
    select session.reservation_id
    from public.reservation_preorder_sessions session
    where session.id = ((select value->>'sessionId' from pg_temp.reservation_results where name = 'session_issue'))::uuid
  ),
  ((select value->>'reservationId' from pg_temp.reservation_results where name = 'session_reservation'))::uuid,
  'preorder session explicitly links to the reservation'
);

insert into pg_temp.reservation_results values (
  'session_replay',
  app_private.issue_reservation_preorder_session(
    repeat('6', 64), repeat('7', 64), repeat('8', 64),
    'b3400000-0000-4000-8000-000000000003', 'reservation-session-replay'
  )
);
select ok(
  (select (value->>'idempotentReplay')::boolean from pg_temp.reservation_results where name = 'session_replay'),
  'same request and hashes replay the existing session'
);
select is(
  (select count(*)::integer from public.reservation_preorder_sessions),
  1,
  'idempotent replay creates no duplicate session'
);

insert into pg_temp.reservation_results values (
  'modify',
  app_private.modify_reservation(
    ((select value->>'reservationId' from pg_temp.reservation_results where name = 'session_reservation'))::uuid,
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    1,
    'b3200000-0000-4000-8000-000000000002',
    5::smallint,
    now() + interval '5 hours', now() + interval '6 hours',
    'Asia/Taipei', 'reservation-modify', null
  )
);
select is(
  (select (value->>'version')::integer from pg_temp.reservation_results where name = 'modify'),
  2,
  'modification uses optimistic versioning'
);
select is(
  (select status from public.reservation_preorder_sessions limit 1),
  'REVOKED',
  'modification revokes the old reservation-version session'
);

insert into pg_temp.reservation_results values (
  'issue_after_modify',
  app_private.issue_reservation_preorder_session(
    repeat('6', 64), repeat('9', 64), repeat('0', 64),
    'b3400000-0000-4000-8000-000000000004', 'reservation-issue-after-modify'
  )
);
select is(
  (
    select reservation_version
    from public.reservation_preorder_sessions
    where id = ((select value->>'sessionId' from pg_temp.reservation_results where name = 'issue_after_modify'))::uuid
  ),
  2,
  'replacement session snapshots the modified reservation version'
);

insert into pg_temp.reservation_results values (
  'cancel_conflict',
  app_private.cancel_reservation(
    ((select value->>'reservationId' from pg_temp.reservation_results where name = 'session_reservation'))::uuid,
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    1, 'CUSTOMER_REQUEST', 'reservation-cancel-conflict', null
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'cancel_conflict'),
  'RESERVATION_VERSION_CONFLICT',
  'stale cancellation version fails closed'
);

insert into pg_temp.reservation_results values (
  'cancel',
  app_private.cancel_reservation(
    ((select value->>'reservationId' from pg_temp.reservation_results where name = 'session_reservation'))::uuid,
    '11111111-1111-4111-8111-111111111111',
    'b3100000-0000-4000-8000-000000000001',
    2, 'CUSTOMER_REQUEST', 'reservation-cancel', null
  )
);
select is(
  (select value->>'status' from pg_temp.reservation_results where name = 'cancel'),
  'CANCELLED',
  'matching version cancels before cutoff'
);
select is(
  (select count(*)::integer from public.reservation_preorder_sessions where status = 'ACTIVE'),
  0,
  'cancellation revokes every active linked session'
);

insert into pg_temp.reservation_results values (
  'cancelled_issue',
  app_private.issue_reservation_preorder_session(
    repeat('6', 64), repeat('1', 64), repeat('2', 64),
    'b3400000-0000-4000-8000-000000000005', 'reservation-cancelled-issue'
  )
);
select is(
  (select value->>'code' from pg_temp.reservation_results where name = 'cancelled_issue'),
  'RESERVATION_INVALID',
  'cancelled reservation can no longer obtain a session'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action in (
      'RESERVATION_CREATED',
      'RESERVATION_MODIFIED',
      'RESERVATION_CANCELLED',
      'RESERVATION_PREORDER_SESSION_ISSUED'
    )
      and organization_id = '11111111-1111-4111-8111-111111111111'
      and stall_id = 'b3100000-0000-4000-8000-000000000001'
  ),
  7,
  'successful reservation lifecycle writes tenant-scoped audit events'
);
select ok(
  not exists (
    select 1
    from public.audit_logs
    where action like 'RESERVATION_%'
      and (
        coalesce(before_json::text, '') ~ repeat('[a-f0-9]', 64)
        or coalesce(after_json::text, '') like '%' || repeat('7', 64) || '%'
      )
  ),
  'reservation audit payloads do not contain token hashes'
);

insert into auth.users (id, email)
values ('b3500000-0000-4000-8000-000000000001', 'reservation-staff@stallorder.test');
update public.profiles
set auth_user_id = 'b3500000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555552';
insert into public.stall_memberships (
  id, organization_id, profile_id, stall_id, role, is_active, updated_at
) values (
  'b3600000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555552',
  'b3100000-0000-4000-8000-000000000001',
  'STAFF', true, now()
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'b3500000-0000-4000-8000-000000000001',
  true
);
select is(
  (select count(id)::integer from public.reservations),
  4,
  'stall staff can read reservation rows for their authorized stall'
);
select is(
  (
    select count(id)::integer
    from public.reservations
    where stall_id = 'b3100000-0000-4000-8000-000000000002'
  ),
  0,
  'reservation RLS hides another stall in the same organization'
);
select is(
  (select count(id)::integer from public.reservation_preorder_sessions),
  2,
  'reservation preorder session RLS follows the linked stall scope'
);
reset role;

select * from finish();
rollback;
