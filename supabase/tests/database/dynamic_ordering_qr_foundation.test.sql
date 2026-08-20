begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

select is(
  (
    select default_enabled
    from public.resilience_feature_flags
    where code = 'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED'
  ),
  false,
  'dynamic ordering QR feature flag defaults off'
);
select is(
  (
    select is_emergency
    from public.resilience_feature_flags
    where code = 'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED'
  ),
  false,
  'dynamic ordering QR is a rollout flag, not an emergency override'
);
select has_table('public', 'dynamic_qr_service_points', 'dynamic QR service points exist');
select has_table('public', 'dynamic_qr_credentials', 'dynamic QR credentials exist');
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dynamic_qr_credentials'
      and column_name = 'token_hash'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dynamic_qr_credentials'
      and column_name = 'nonce_hash'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dynamic_qr_credentials'
      and column_name in ('token', 'nonce')
  ),
  'only dynamic credential hashes are persisted'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.dynamic_qr_service_points'::regclass
  ),
  'dynamic QR service points force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.dynamic_qr_credentials'::regclass
  ),
  'dynamic QR credentials force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.dynamic_qr_credentials', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dynamic_qr_credentials', 'SELECT')
  and has_table_privilege('service_role', 'public.dynamic_qr_credentials', 'SELECT')
  and not has_table_privilege('service_role', 'public.dynamic_qr_credentials', 'INSERT'),
  'credential rows are read by service_role and mutated only through trusted RPCs'
);
select ok(
  to_regprocedure('public.configure_dynamic_qr_service_point(uuid,uuid,uuid,uuid,integer,integer,uuid,text)') is not null
  and to_regprocedure('public.set_dynamic_qr_service_point_state(uuid,uuid,uuid,text,uuid,text)') is not null
  and to_regprocedure('public.rotate_dynamic_qr_service_point(uuid,uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.issue_dynamic_qr_credential(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)') is not null
  and to_regprocedure('public.redeem_dynamic_qr_credential(text,text,text,text,text,text)') is not null
  and to_regprocedure('public.invalidate_dynamic_qr_checkout(uuid,uuid,uuid,uuid,text)') is not null,
  'all trusted dynamic QR contracts exist'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.issue_dynamic_qr_credential(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.redeem_dynamic_qr_credential(text,text,text,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.issue_dynamic_qr_credential(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.redeem_dynamic_qr_credential(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'only service_role may issue or redeem a dynamic credential'
);

delete from public.dynamic_qr_credentials;
delete from public.dynamic_qr_service_points;
delete from public.public_rate_limit_buckets
where dimension_type like 'DYNAMIC_QR_%';
delete from public.order_sessions;

update public.qr_codes
set state = 'ACTIVE', expires_at = null,
    dining_table_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where id = '33333333-3333-4333-8333-333333333334';
update public.dining_tables
set is_active = true
where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.stall_ordering_settings
set dine_in_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';

create temporary table pg_temp.dynamic_qr_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.dynamic_qr_results values (
  'configured',
  public.configure_dynamic_qr_service_point(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '33333333-3333-4333-8333-333333333334',
    300, 1, null, 'dynamic-qr-configure'
  )
);
select is(
  (select value->>'state' from pg_temp.dynamic_qr_results where name = 'configured'),
  'PAUSED',
  'new service points remain paused until explicitly activated'
);
select is(
  (
    select state::text || ':' || dining_table_id::text
    from public.qr_codes
    where id = '33333333-3333-4333-8333-333333333334'
  ),
  'ACTIVE:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'configuration leaves the printed static QR active and mapped'
);

insert into pg_temp.dynamic_qr_results values (
  'activated',
  public.set_dynamic_qr_service_point_state(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ACTIVE', null, 'dynamic-qr-activate'
  )
);
select is(
  (select value->>'state' from pg_temp.dynamic_qr_results where name = 'activated'),
  'ACTIVE',
  'an explicit trusted action activates the service point'
);

insert into pg_temp.dynamic_qr_results values (
  'session',
  public.issue_idempotent_order_session_with_schedule(
    'demo-aming-chicken-table-a1-qr-2026',
    repeat('s', 64), repeat('i', 64), repeat('d', 64), repeat('q', 64),
    repeat('b', 64), 'dynamic-qr-session', 'DEFAULT'
  )
);
select is(
  (select value->>'ok' from pg_temp.dynamic_qr_results where name = 'session'),
  'true',
  'fixture obtains an existing canonical dine-in order session'
);

insert into pg_temp.dynamic_qr_results
select 'disabled_issue', public.issue_dynamic_qr_credential(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '33333333-3333-4333-8333-333333333334',
  session_record.id,
  repeat('1', 64), repeat('2', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-disabled-issue'
)
from public.order_sessions session_record
where session_record.token_hash = repeat('s', 64);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'disabled_issue'),
  'DYNAMIC_QR_DISABLED',
  'issuance fails closed while the feature flag is off'
);

-- Owner-only test fixture: exercise the dormant implementation without
-- weakening the Production role boundary. Both DDL changes roll back here.
alter table public.resilience_feature_flags
  disable trigger resilience_feature_flags_phase_three_lock_guard;
alter table public.resilience_feature_flags
  drop constraint resilience_feature_flags_phase_three_default_off_check;

update public.resilience_feature_flags
set default_enabled = true
where code = 'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED';

insert into pg_temp.dynamic_qr_results
select 'issued_one', public.issue_dynamic_qr_credential(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '33333333-3333-4333-8333-333333333334',
  session_record.id,
  repeat('1', 64), repeat('2', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-one'
)
from public.order_sessions session_record
where session_record.token_hash = repeat('s', 64);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'issued_one'),
  'DYNAMIC_QR_ISSUED',
  'an enabled active service point issues a bounded credential'
);
select is(
  (
    select token_hash || ':' || nonce_hash
    from public.dynamic_qr_credentials
    where token_hash = repeat('1', 64)
  ),
  repeat('1', 64) || ':' || repeat('2', 64),
  'the database stores only the supplied token and nonce hashes'
);
select ok(
  (
    select expires_at > issued_at + interval '59 seconds'
      and expires_at <= issued_at + interval '5 minutes 1 second'
    from public.dynamic_qr_credentials
    where token_hash = repeat('1', 64)
  ),
  'credential expiry is short and bounded by the configured five minutes'
);
select ok(
  (
    select credential.organization_id = '11111111-1111-4111-8111-111111111111'::uuid
      and credential.stall_id = '22222222-2222-4222-8222-222222222222'::uuid
      and credential.dining_table_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      and credential.static_qr_code_id = '33333333-3333-4333-8333-333333333334'::uuid
      and credential.order_session_id = session_record.id
    from public.dynamic_qr_credentials credential
    join public.order_sessions session_record on session_record.token_hash = repeat('s', 64)
    where credential.token_hash = repeat('1', 64)
  ),
  'the credential is bound to organization, stall, table, static QR, and session'
);

insert into pg_temp.dynamic_qr_results values (
  'shared_device',
  public.redeem_dynamic_qr_credential(
    repeat('1', 64), repeat('2', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('e', 64), repeat('i', 64), 'dynamic-qr-shared-device'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'shared_device'),
  'DYNAMIC_QR_DEVICE_MISMATCH',
  'a screenshot shared to another device fails closed'
);
select is(
  (
    select redemption_count::integer
    from public.dynamic_qr_credentials
    where token_hash = repeat('1', 64)
  ),
  0,
  'a device mismatch does not consume or authorize the credential'
);

insert into pg_temp.dynamic_qr_results values (
  'wrong_nonce',
  public.redeem_dynamic_qr_credential(
    repeat('1', 64), repeat('3', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-wrong-nonce'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'wrong_nonce'),
  'DYNAMIC_QR_INVALID',
  'a mismatched nonce cannot redeem the credential'
);

insert into pg_temp.dynamic_qr_results values (
  'wrong_static',
  public.redeem_dynamic_qr_credential(
    repeat('1', 64), repeat('2', 64), 'demo-aming-chicken-qr-2026-rotate-me',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-wrong-static'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'wrong_static'),
  'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
  'a credential cannot be redeemed through the wrong table QR'
);

insert into pg_temp.dynamic_qr_results values (
  'redeemed_one',
  public.redeem_dynamic_qr_credential(
    repeat('1', 64), repeat('2', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-redeemed-one'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'redeemed_one'),
  'DYNAMIC_QR_REDEEMED',
  'a valid capability redeems once'
);
select is(
  (select value #>> '{canonical_preflight,scope}' from pg_temp.dynamic_qr_results where name = 'redeemed_one'),
  'ORDER',
  'redemption still traverses canonical order preflight'
);
select is(
  (
    select state || ':' || redemption_count::text
    from public.dynamic_qr_credentials
    where token_hash = repeat('1', 64)
  ),
  'CONSUMED:1',
  'a one-use credential becomes consumed atomically'
);

insert into pg_temp.dynamic_qr_results values (
  'replayed_one',
  public.redeem_dynamic_qr_credential(
    repeat('1', 64), repeat('2', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-replayed-one'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'replayed_one'),
  'DYNAMIC_QR_ALREADY_USED',
  'credential replay fails closed'
);
select is(
  (
    select state::text
    from public.qr_codes
    where id = '33333333-3333-4333-8333-333333333334'
  ),
  'ACTIVE',
  'dynamic redemption never invalidates the printed static QR'
);

insert into pg_temp.dynamic_qr_results values (
  'rotate_one',
  public.rotate_dynamic_qr_service_point(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'dynamic-qr-rotate-one'
  )
);
select is(
  (select value->>'credential_version' from pg_temp.dynamic_qr_results where name = 'rotate_one'),
  '2',
  'rotation advances the service-point credential version'
);

insert into pg_temp.dynamic_qr_results
select 'issued_rotating', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('4', 64), repeat('5', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-rotating'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
select public.rotate_dynamic_qr_service_point(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'dynamic-qr-rotate-two'
);
insert into pg_temp.dynamic_qr_results values (
  'rotated_redeem',
  public.redeem_dynamic_qr_credential(
    repeat('4', 64), repeat('5', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-rotated-redeem'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'rotated_redeem'),
  'DYNAMIC_QR_ROTATED',
  'rotation invalidates every earlier active version'
);

insert into pg_temp.dynamic_qr_results
select 'issued_pause', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('6', 64), repeat('7', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-pause'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
select public.set_dynamic_qr_service_point_state(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'PAUSED', null, 'dynamic-qr-pause'
);
insert into pg_temp.dynamic_qr_results values (
  'paused_redeem',
  public.redeem_dynamic_qr_credential(
    repeat('6', 64), repeat('7', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-paused-redeem'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'paused_redeem'),
  'DYNAMIC_QR_PAUSED',
  'emergency pause invalidates active credentials'
);

select public.set_dynamic_qr_service_point_state(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'ACTIVE', null, 'dynamic-qr-resume'
);
insert into pg_temp.dynamic_qr_results
select 'issued_checkout', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('8', 64), repeat('9', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-checkout'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
insert into pg_temp.dynamic_qr_results
select 'checkout_invalidated', public.invalidate_dynamic_qr_checkout(
  session_record.organization_id, session_record.stall_id, session_record.id,
  null, 'dynamic-qr-checkout-invalidate'
)
from public.order_sessions session_record
where session_record.token_hash = repeat('s', 64);
select is(
  (select value->>'invalidated_count' from pg_temp.dynamic_qr_results where name = 'checkout_invalidated'),
  '1',
  'checkout invalidation closes the active session credential'
);
insert into pg_temp.dynamic_qr_results values (
  'checked_out_redeem',
  public.redeem_dynamic_qr_credential(
    repeat('8', 64), repeat('9', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-checked-out-redeem'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'checked_out_redeem'),
  'DYNAMIC_QR_CHECKED_OUT',
  'a checkout-invalidated credential cannot be reused'
);

insert into pg_temp.dynamic_qr_results
select 'issued_expiring', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('a', 64), repeat('b', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-expiring'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
set local session_replication_role = replica;
update public.dynamic_qr_credentials
set issued_at = now() - interval '10 minutes',
    expires_at = now() - interval '1 second'
where token_hash = repeat('a', 64);
set local session_replication_role = origin;
insert into pg_temp.dynamic_qr_results values (
  'expired_redeem',
  public.redeem_dynamic_qr_credential(
    repeat('a', 64), repeat('b', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-expired-redeem'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'expired_redeem'),
  'DYNAMIC_QR_EXPIRED',
  'expired credentials fail closed'
);

delete from public.public_rate_limit_buckets
where dimension_type like 'DYNAMIC_QR_REDEEM_%';
insert into pg_temp.dynamic_qr_results
select 'issued_rate', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('c', 64), repeat('d', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-rate'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
do $$
declare
  i integer;
begin
  for i in 1..6 loop
    perform public.redeem_dynamic_qr_credential(
      repeat('c', 64), repeat('e', 64), 'demo-aming-chicken-table-a1-qr-2026',
      repeat('d', 64), repeat('i', 64), 'dynamic-qr-rate-' || i
    );
  end loop;
end;
$$;
insert into pg_temp.dynamic_qr_results values (
  'rate_limited',
  public.redeem_dynamic_qr_credential(
    repeat('c', 64), repeat('e', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-rate-7'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'rate_limited'),
  'DYNAMIC_QR_RATE_LIMITED',
  'credential and device redemption attempts are rate limited'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action in (
      'DYNAMIC_QR_ISSUED', 'DYNAMIC_QR_REDEEMED', 'DYNAMIC_QR_ROTATED',
      'DYNAMIC_QR_PAUSED', 'DYNAMIC_QR_CHECKOUT_INVALIDATED'
    )
      and organization_id = '11111111-1111-4111-8111-111111111111'
      and metadata not ilike '%token%'
      and metadata not ilike '%nonce%'
  ),
  'tenant audit records state changes without credential material'
);

select public.rotate_dynamic_qr_service_point(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 'dynamic-qr-before-move'
);
insert into pg_temp.dynamic_qr_results
select 'issued_move', public.issue_dynamic_qr_credential(
  service_point.organization_id, service_point.stall_id, service_point.dining_table_id,
  service_point.static_qr_code_id, session_record.id,
  repeat('f', 64), repeat('0', 64), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-issued-move'
)
from public.dynamic_qr_service_points service_point
join public.order_sessions session_record on session_record.token_hash = repeat('s', 64);
insert into public.dining_tables (
  id, organization_id, stall_id, code, label, is_active, sort_order,
  created_at, updated_at
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'A2-DYNAMIC-TEST', 'A2 Dynamic test', true, 999, now(), now()
);
update public.qr_codes
set dining_table_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
where id = '33333333-3333-4333-8333-333333333334';
insert into pg_temp.dynamic_qr_results values (
  'moved_table_redeem',
  public.redeem_dynamic_qr_credential(
    repeat('f', 64), repeat('0', 64), 'demo-aming-chicken-table-a1-qr-2026',
    repeat('d', 64), repeat('i', 64), 'dynamic-qr-moved-table'
  )
);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'moved_table_redeem'),
  'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
  'moving the static QR to another table invalidates the old dynamic scope'
);
update public.qr_codes
set dining_table_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
where id = '33333333-3333-4333-8333-333333333334';

insert into pg_temp.dynamic_qr_results
select 'scope_escalation', public.issue_dynamic_qr_credential(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '33333333-3333-4333-8333-333333333334',
  session_record.id,
  repeat('9a', 32), repeat('9b', 32), repeat('d', 64), repeat('i', 64),
  'dynamic-qr-scope-escalation'
)
from public.order_sessions session_record
where session_record.token_hash = repeat('s', 64);
select is(
  (select value->>'code' from pg_temp.dynamic_qr_results where name = 'scope_escalation'),
  'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
  'a credential request cannot enlarge its configured table scope'
);

select * from finish();
rollback;
