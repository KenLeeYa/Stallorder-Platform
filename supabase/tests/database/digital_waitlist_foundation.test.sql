begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(37);

select has_type('public', 'digital_waitlist_status', 'waitlist status enum exists');
select has_table('public', 'digital_waitlist_entries', 'waitlist entries exist');
select has_table('public', 'digital_waitlist_notifications', 'waitlist mock notifications exist');

select is(
  (
    select default_enabled
    from public.resilience_feature_flags
    where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED'
  ),
  false,
  'digital waitlist feature flag defaults off'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.digital_waitlist_entries'::regclass
  ),
  'waitlist entries force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.digital_waitlist_notifications'::regclass
  ),
  'waitlist notifications force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.digital_waitlist_entries', 'SELECT')
  and not has_table_privilege('authenticated', 'public.digital_waitlist_entries', 'INSERT')
  and has_table_privilege('service_role', 'public.digital_waitlist_entries', 'SELECT,INSERT,UPDATE,DELETE'),
  'waitlist entry writes stay behind the trusted service role'
);
select ok(
  has_column_privilege(
    'authenticated', 'public.digital_waitlist_entries', 'display_name', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.digital_waitlist_entries', 'public_token_hash', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.digital_waitlist_entries', 'duplicate_key_hash', 'SELECT'
  )
  and not has_column_privilege(
    'authenticated', 'public.digital_waitlist_entries', 'seating_exchange_token_hash', 'SELECT'
  ),
  'authenticated staff reads omit all waitlist credential hashes'
);
select ok(
  not has_table_privilege('anon', 'public.digital_waitlist_notifications', 'SELECT')
  and not has_table_privilege('authenticated', 'public.digital_waitlist_notifications', 'INSERT')
  and has_table_privilege('service_role', 'public.digital_waitlist_notifications', 'SELECT,INSERT,DELETE'),
  'mock notification writes stay behind the trusted service role'
);

select ok(
  to_regprocedure('public.join_digital_waitlist(uuid,integer,text,text,text,text,text)') is not null
  and to_regprocedure('public.get_digital_waitlist_status(text)') is not null
  and to_regprocedure('public.transition_digital_waitlist_entry(uuid,uuid,uuid,integer,text,uuid,text,uuid,text,text)') is not null
  and to_regprocedure('public.exchange_digital_waitlist_seating(text,text,text,text,text,text)') is not null
  and to_regprocedure('public.purge_expired_digital_waitlist_entries(timestamp with time zone)') is not null,
  'all trusted waitlist contracts exist'
);

select ok(
  not has_function_privilege('anon', 'public.join_digital_waitlist(uuid,integer,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.join_digital_waitlist(uuid,integer,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.join_digital_waitlist(uuid,integer,text,text,text,text,text)', 'EXECUTE'),
  'only service_role may join the waitlist through the database contract'
);

select ok(
  not has_function_privilege('anon', 'public.exchange_digital_waitlist_seating(text,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.exchange_digital_waitlist_seating(text,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.exchange_digital_waitlist_seating(text,text,text,text,text,text)', 'EXECUTE'),
  'only service_role may exchange a seated waitlist credential'
);

-- Owner-only test fixture: exercise the dormant implementation without
-- weakening the Production role boundary. Both DDL changes roll back here.
alter table public.resilience_feature_flags
  disable trigger resilience_feature_flags_phase_three_lock_guard;
alter table public.resilience_feature_flags
  drop constraint resilience_feature_flags_phase_three_default_off_check;

update public.resilience_feature_flags
set default_enabled = true
where code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED';

delete from public.public_rate_limit_buckets
where stall_id = '22222222-2222-4222-8222-222222222222'
  and dimension_type like 'WAITLIST_%';

create temporary table pg_temp.waitlist_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.waitlist_results values (
  'join_one',
  public.join_digital_waitlist(
    '22222222-2222-4222-8222-222222222222', 2, 'Test party',
    repeat('1', 64), repeat('2', 64), repeat('3', 64), 'waitlist-test-join-1'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'join_one'),
  'WAITLIST_JOINED',
  'a valid request creates a waiting entry'
);
select is(
  (
    select status::text
    from public.digital_waitlist_entries
    where public_token_hash = repeat('1', 64)
  ),
  'WAITING',
  'the new entry starts in WAITING'
);
select is(
  (
    select organization_id
    from public.digital_waitlist_entries
    where public_token_hash = repeat('1', 64)
  ),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the server derives organization scope from the stall'
);
select ok(
  (
    select retention_expires_at between created_at + interval '29 days 23 hours'
      and created_at + interval '30 days 1 hour'
    from public.digital_waitlist_entries
    where public_token_hash = repeat('1', 64)
  ),
  'entry retention is bounded to thirty days'
);

insert into pg_temp.waitlist_results values (
  'duplicate',
  public.join_digital_waitlist(
    '22222222-2222-4222-8222-222222222222', 3, 'Duplicate party',
    repeat('4', 64), repeat('2', 64), repeat('3', 64), 'waitlist-test-duplicate'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'duplicate'),
  'WAITLIST_ALREADY_ACTIVE',
  'one stall cannot create a second active entry for the duplicate key'
);
select is(
  (
    select count(*)::integer
    from public.digital_waitlist_entries
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and duplicate_key_hash = repeat('2', 64)
      and status in ('WAITING', 'NOTIFIED')
  ),
  1,
  'duplicate rejection does not reveal or replace the first token'
);

insert into pg_temp.waitlist_results values (
  'public_token_order_attempt',
  public.issue_idempotent_order_session_with_schedule(
    'waitlist-public-token', repeat('5', 64), repeat('6', 64), repeat('7', 64),
    repeat('8', 64), repeat('9', 64), 'waitlist-token-order-attempt', 'DEFAULT'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'public_token_order_attempt'),
  'QR_NOT_FOUND',
  'a waitlist public token cannot issue an order session'
);

insert into pg_temp.waitlist_results
select 'notify_one', public.transition_digital_waitlist_entry(
  entry.organization_id, entry.stall_id, entry.id, entry.state_version,
  'NOTIFY', null, null, null, repeat('a', 64), 'waitlist-test-notify'
)
from public.digital_waitlist_entries entry
where entry.public_token_hash = repeat('1', 64);

select is(
  (select value->>'status' from pg_temp.waitlist_results where name = 'notify_one'),
  'NOTIFIED',
  'staff notification moves WAITING to NOTIFIED'
);
select ok(
  (
    select hold_expires_at between notified_at + interval '9 minutes 59 seconds'
      and notified_at + interval '10 minutes 1 second'
    from public.digital_waitlist_entries
    where public_token_hash = repeat('1', 64)
  ),
  'notification starts the ten-minute hold'
);
select is(
  (
    select channel || ':' || delivery_state
    from public.digital_waitlist_notifications notification
    join public.digital_waitlist_entries entry on entry.id = notification.entry_id
    where entry.public_token_hash = repeat('1', 64)
  ),
  'IN_APP:MOCK_RECORDED',
  'notification is an IN_APP mock record, not an external send'
);

insert into pg_temp.waitlist_results
select 'early_no_show', public.transition_digital_waitlist_entry(
  entry.organization_id, entry.stall_id, entry.id, entry.state_version,
  'MARK_NO_SHOW', null, null, null, repeat('a', 64), 'waitlist-test-early-no-show'
)
from public.digital_waitlist_entries entry
where entry.public_token_hash = repeat('1', 64);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'early_no_show'),
  'WAITLIST_HOLD_ACTIVE',
  'no-show is rejected before the hold expires'
);

set local session_replication_role = replica;
update public.digital_waitlist_entries
set hold_expires_at = now() - interval '1 second'
where public_token_hash = repeat('1', 64);
set local session_replication_role = origin;

insert into pg_temp.waitlist_results
select 'late_no_show', public.transition_digital_waitlist_entry(
  entry.organization_id, entry.stall_id, entry.id, entry.state_version,
  'MARK_NO_SHOW', null, null, null, repeat('a', 64), 'waitlist-test-late-no-show'
)
from public.digital_waitlist_entries entry
where entry.public_token_hash = repeat('1', 64);

select is(
  (select value->>'status' from pg_temp.waitlist_results where name = 'late_no_show'),
  'NO_SHOW',
  'no-show is allowed only after hold expiry'
);

select throws_ok(
  $$
    update public.digital_waitlist_entries
    set status = 'WAITING', state_version = state_version + 1
    where public_token_hash = repeat('1', 64)
  $$,
  '23514',
  'WAITLIST_STATE_TRANSITION_INVALID',
  'terminal entries cannot return to WAITING'
);

insert into pg_temp.waitlist_results values (
  'join_seating',
  public.join_digital_waitlist(
    '22222222-2222-4222-8222-222222222222', 4, 'Seating party',
    repeat('b', 64), repeat('c', 64), repeat('d', 64), 'waitlist-test-join-seating'
  )
);

insert into pg_temp.waitlist_results
select 'notify_seating', public.transition_digital_waitlist_entry(
  entry.organization_id, entry.stall_id, entry.id, entry.state_version,
  'NOTIFY', null, null, null, repeat('e', 64), 'waitlist-test-notify-seating'
)
from public.digital_waitlist_entries entry
where entry.public_token_hash = repeat('b', 64);

insert into pg_temp.waitlist_results
select 'seat', public.transition_digital_waitlist_entry(
  entry.organization_id, entry.stall_id, entry.id, entry.state_version,
  'SEAT', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', repeat('f', 64),
  null, repeat('e', 64), 'waitlist-test-seat'
)
from public.digital_waitlist_entries entry
where entry.public_token_hash = repeat('b', 64);

select is(
  (select value->>'status' from pg_temp.waitlist_results where name = 'seat'),
  'SEATED',
  'staff seating requires a table and one-time exchange hash'
);

insert into pg_temp.waitlist_results values (
  'bad_exchange',
  public.exchange_digital_waitlist_seating(
    repeat('b', 64), repeat('0', 64), repeat('1a', 32),
    repeat('2a', 32), repeat('3a', 32), 'waitlist-test-bad-exchange'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'bad_exchange'),
  'WAITLIST_SEATING_TOKEN_INVALID',
  'wrong seating token cannot issue a dine-in session'
);

insert into pg_temp.waitlist_results values (
  'exchange',
  public.exchange_digital_waitlist_seating(
    repeat('b', 64), repeat('f', 64), repeat('1a', 32),
    repeat('2a', 32), repeat('3a', 32), 'waitlist-test-exchange'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'exchange'),
  'DINE_IN_SESSION_ISSUED',
  'valid one-time seating exchange issues a fresh session contract'
);
select is(
  (
    select session_record.ordering_mode
    from public.order_sessions session_record
    where session_record.token_hash = repeat('1a', 32)
  ),
  'DEFAULT',
  'seating exchange issues the DEFAULT dine-in ordering mode'
);
select is(
  (
    select qr.dining_table_id
    from public.order_sessions session_record
    join public.qr_codes qr on qr.id = session_record.qr_code_id
    where session_record.token_hash = repeat('1a', 32)
  ),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'fresh session is bound to the assigned dining table QR'
);
select is(
  (
    select count(*)::integer
    from public.order_sessions
    where token_hash in (repeat('b', 64), repeat('f', 64))
  ),
  0,
  'neither waitlist nor seating credential is reused as an order-session token'
);

insert into pg_temp.waitlist_results values (
  'replayed_exchange',
  public.exchange_digital_waitlist_seating(
    repeat('b', 64), repeat('f', 64), repeat('4a', 32),
    repeat('2a', 32), repeat('3a', 32), 'waitlist-test-replayed-exchange'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'replayed_exchange'),
  'WAITLIST_SEATING_TOKEN_USED',
  'the seating exchange token is one-time only'
);

delete from public.public_rate_limit_buckets
where stall_id = '22222222-2222-4222-8222-222222222222'
  and dimension_type like 'WAITLIST_%';

do $$
declare
  i integer;
begin
  for i in 1..10 loop
    perform public.join_digital_waitlist(
      '22222222-2222-4222-8222-222222222222', 1, 'Rate party ' || i,
      encode(extensions.digest('rate-token-' || i, 'sha256'), 'hex'),
      encode(extensions.digest('rate-duplicate-' || i, 'sha256'), 'hex'),
      repeat('9b', 32), 'waitlist-rate-' || i
    );
  end loop;
end;
$$;

insert into pg_temp.waitlist_results values (
  'rate_limited',
  public.join_digital_waitlist(
    '22222222-2222-4222-8222-222222222222', 1, 'Rate party blocked',
    repeat('8b', 32), repeat('7b', 32), repeat('9b', 32), 'waitlist-rate-11'
  )
);

select is(
  (select value->>'code' from pg_temp.waitlist_results where name = 'rate_limited'),
  'WAITLIST_RATE_LIMITED',
  'the eleventh join attempt in ten minutes is rate limited per stall and client hash'
);

select ok(
  exists (
    select 1
    from public.audit_logs
    where action = 'DIGITAL_WAITLIST_STATE_CHANGED'
      and entity_type = 'DIGITAL_WAITLIST_ENTRY'
      and metadata not like '%token%'
  )
  and exists (
    select 1
    from public.audit_logs
    where action = 'DIGITAL_WAITLIST_SEATING_EXCHANGED'
      and entity_type = 'DIGITAL_WAITLIST_ENTRY'
      and metadata not like '%token%'
  ),
  'state and seating changes create metadata-only audit events'
);

set local session_replication_role = replica;
alter table public.digital_waitlist_entries
  drop constraint digital_waitlist_entries_retention_bounded;
update public.digital_waitlist_entries
set retention_expires_at = now() - interval '1 second'
where public_token_hash = repeat('1', 64);
set local session_replication_role = origin;

select is(
  public.purge_expired_digital_waitlist_entries(now()),
  1,
  'retention purge deletes expired waitlist data'
);
select is(
  (
    select count(*)::integer
    from public.digital_waitlist_entries
    where public_token_hash = repeat('1', 64)
  ),
  0,
  'retention purge removes the expired entry and dependent mock notification'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action in (
      'DIGITAL_WAITLIST_JOINED',
      'DIGITAL_WAITLIST_DUPLICATE_REJECTED',
      'DIGITAL_WAITLIST_RATE_LIMITED'
    )
  ) > 0,
  true,
  'join, duplicate, and rate-limit decisions are auditable'
);

select * from finish();
rollback;
