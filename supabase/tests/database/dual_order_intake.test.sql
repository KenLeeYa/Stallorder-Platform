begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select has_function(
  'public',
  'issue_idempotent_order_session_with_schedule',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'cross-circuit idempotent session RPC exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.issue_idempotent_order_session_with_schedule(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot call the session RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.issue_idempotent_order_session_with_schedule(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the session RPC directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.issue_idempotent_order_session_with_schedule(text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'trusted service role can call the session RPC'
);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;

update public.qr_codes
set state = 'ACTIVE', expires_at = null
where id = '33333333-3333-4333-8333-333333333333';
update public.stalls
set is_active = true,
    ordering_enabled = true,
    business_status = 'OPEN',
    ordering_state = 'OPEN',
    is_sold_out = false
where id = '22222222-2222-4222-8222-222222222222';

create temporary table dual_session_results (
  attempt integer primary key,
  result jsonb not null
) on commit drop;

insert into dual_session_results (attempt, result)
values (
  1,
  public.issue_idempotent_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('a', 64),
    repeat('b', 64),
    repeat('c', 64),
    repeat('d', 64),
    repeat('e', 64),
    'circuit-a-request',
    'DEFAULT'
  )
);
insert into dual_session_results (attempt, result)
values (
  2,
  public.issue_idempotent_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('a', 64),
    repeat('b', 64),
    repeat('c', 64),
    repeat('d', 64),
    repeat('e', 64),
    'circuit-b-request',
    'DEFAULT'
  )
);

select is(
  (select result->>'ok' from dual_session_results where attempt = 1),
  'true',
  'first circuit creates an active session'
);
select is(
  (select result->>'idempotent_replay' from dual_session_results where attempt = 2),
  'true',
  'second circuit reuses the same active session'
);
select is(
  (select result->>'order_session_id' from dual_session_results where attempt = 1),
  (select result->>'order_session_id' from dual_session_results where attempt = 2),
  'both circuits receive the same order session id'
);
select is(
  (
    select count(*)::integer
    from public.order_sessions
    where token_hash = repeat('a', 64)
  ),
  1,
  'cross-circuit retry creates exactly one stored session'
);
select is(
  (
    select ordering_mode
    from public.order_sessions
    where token_hash = repeat('a', 64)
  ),
  'DEFAULT',
  'the authoritative session stores the requested ordering mode'
);

select * from finish();
rollback;
