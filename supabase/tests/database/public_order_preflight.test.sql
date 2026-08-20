begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select has_function(
  'public',
  'public_order_preflight',
  array[
    'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text',
    'text', 'uuid', 'text', 'timestamp with time zone', 'uuid', 'jsonb', 'boolean', 'text'
  ],
  'the canonical session/order preflight RPC exists'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamp with time zone,uuid,jsonb,boolean,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute canonical preflight'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamp with time zone,uuid,jsonb,boolean,text)',
    'EXECUTE'
  ),
  'authenticated clients cannot execute canonical preflight'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamp with time zone,uuid,jsonb,boolean,text)',
    'EXECUTE'
  ),
  'the trusted service role can execute canonical preflight'
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
update public.stall_ordering_settings
set dine_in_enabled = true,
    delivery_module_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';

create temporary table canonical_preflight_results (
  name text primary key,
  result jsonb not null
) on commit drop;

insert into canonical_preflight_results values (
  'session',
  public.public_order_preflight(
    'SESSION',
    'demo-aming-chicken-qr-2026-rotate-me',
    'DEFAULT',
    repeat('d', 64),
    repeat('i', 64),
    repeat('q', 64),
    repeat('b', 64),
    'canonical-session',
    null,
    null,
    null,
    null,
    null,
    '[]'::jsonb,
    false,
    null
  )
);

select is(
  (select result->>'ok' from canonical_preflight_results where name = 'session'),
  'true',
  'session preflight accepts the active demo QR'
);
select is(
  (select result->>'ordering_mode' from canonical_preflight_results where name = 'session'),
  'DEFAULT',
  'session preflight returns the canonical requested ordering mode'
);
select is(
  (select result #>> '{qr_context,qr_code_id}' from canonical_preflight_results where name = 'session'),
  '33333333-3333-4333-8333-333333333333',
  'session preflight returns the trusted QR context'
);
select is(
  (select result #>> '{schedule_context,ok}' from canonical_preflight_results where name = 'session'),
  'true',
  'session preflight returns the validated schedule context'
);
select ok(
  (select jsonb_typeof(result->'capacity') = 'object' from canonical_preflight_results where name = 'session'),
  'session preflight returns a canonical capacity snapshot'
);
select ok(
  (select result ? 'resumable_order' from canonical_preflight_results where name = 'session'),
  'session preflight always returns the resumable-order field'
);

select is(
  public.public_order_preflight(
    'SESSION', 'missing-qr', 'DEFAULT', repeat('d', 64), repeat('i', 64),
    repeat('q', 64), repeat('b', 64), 'missing-qr-request', null, null, null,
    null, null, '[]'::jsonb, false, null
  )->>'code',
  'QR_NOT_FOUND',
  'missing QR uses the existing public error code'
);
select is(
  public.public_order_preflight(
    'SESSION', 'demo-aming-chicken-qr-2026-rotate-me', 'INVALID', repeat('d', 64),
    repeat('i', 64), repeat('q', 64), repeat('b', 64), 'invalid-mode-request',
    null, null, null, null, null, '[]'::jsonb, false, null
  )->>'code',
  'ORDER_MODE_CONFLICT',
  'invalid ordering mode uses the existing public error code'
);
select is(
  public.public_order_preflight(
    'SESSION', 'demo-aming-chicken-qr-2026-rotate-me', 'DEFAULT', repeat('d', 64),
    repeat('i', 64), repeat('q', 64), repeat('b', 64), 'degraded-request',
    null, null, null, null, null, '[]'::jsonb, false, 'QR_ORDERING_DEGRADED'
  )->>'code',
  'QR_ORDERING_DEGRADED',
  'deployment degraded mode remains authoritative after resume lookup'
);
select is(
  public.public_order_preflight(
    'ORDER', 'demo-aming-chicken-qr-2026-rotate-me', 'DEFAULT', repeat('d', 64),
    repeat('i', 64), repeat('q', 64), repeat('b', 64), 'missing-session-request',
    repeat('s', 64), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('h', 64), null,
    null, '[]'::jsonb, false, null
  )->>'code',
  'SESSION_NOT_FOUND',
  'order preflight uses the existing missing-session code'
);
select is(
  (
    select count(*)::integer
    from public.public_order_attempts
    where request_id in ('missing-qr-request', 'missing-session-request')
      and outcome = 'DENIED'::public.public_attempt_outcome
  ),
  2,
  'canonical denials retain correlated public-order audit records'
);

insert into canonical_preflight_results values (
  'issued-session',
  public.issue_idempotent_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('i', 64), repeat('d', 64), repeat('q', 64),
    repeat('b', 64), 'canonical-issued-session', 'DEFAULT'
  )
);
select is(
  (select result->>'ok' from canonical_preflight_results where name = 'issued-session'),
  'true',
  'the replay fixture creates an authoritative session through the unchanged transaction RPC'
);

insert into canonical_preflight_results values (
  'created-order',
  public.create_public_order_with_fulfillment_time(
    'ac200000-0000-4000-8000-000000000001',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('d', 64), repeat('i', 64), repeat('q', 64),
    repeat('b', 64), 'ac210000-0000-4000-8000-000000000001', repeat('h', 64),
    'Canonical replay customer', null, null, '',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', '[]'::jsonb
    )),
    repeat('t', 64), repeat('p', 64), 'canonical-created-order', true,
    null, null
  )
);
select is(
  (select result->>'ok' from canonical_preflight_results where name = 'created-order'),
  'true',
  'the replay fixture creates an order through the unchanged transaction RPC'
);

insert into canonical_preflight_results values (
  'resumable-session',
  public.public_order_preflight(
    'SESSION', 'demo-aming-chicken-qr-2026-rotate-me', 'DEFAULT', repeat('d', 64),
    repeat('i', 64), repeat('q', 64), repeat('b', 64), 'canonical-resume',
    null, null, null, null, null, '[]'::jsonb, false, null
  )
);
select is(
  (select result #>> '{resumable_order,order_id}' from canonical_preflight_results where name = 'resumable-session'),
  'ac200000-0000-4000-8000-000000000001',
  'canonical session preflight returns the mode-isolated resumable order'
);

insert into canonical_preflight_results values (
  'idempotent-order',
  public.public_order_preflight(
    'ORDER', 'demo-aming-chicken-qr-2026-rotate-me', 'DEFAULT', repeat('d', 64),
    repeat('i', 64), repeat('q', 64), repeat('b', 64), 'canonical-idempotent-order',
    repeat('s', 64), 'ac210000-0000-4000-8000-000000000001', repeat('h', 64),
    null, null, '[]'::jsonb, true, 'QR_ORDERING_DEGRADED'
  )
);
select is(
  (select result #>> '{idempotent_order,order_id}' from canonical_preflight_results where name = 'idempotent-order'),
  'ac200000-0000-4000-8000-000000000001',
  'canonical order preflight returns an idempotent replay before degraded-mode denial'
);

select * from finish();
rollback;
