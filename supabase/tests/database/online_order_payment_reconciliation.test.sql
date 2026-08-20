begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(46);

select has_table('public', 'online_order_payment_intents', 'online payment intent ledger exists');
select has_table('public', 'online_order_payment_events', 'online payment event ledger exists');
select ok(
  (select not default_enabled from public.resilience_feature_flags where code = 'ONLINE_ORDER_PAYMENT_ENABLED'),
  'online order payments default off'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.online_order_payment_intents'::regclass,
     'public.online_order_payment_events'::regclass
   )),
  'online payment ledgers force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.online_order_payment_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.online_order_payment_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.online_order_payment_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.online_order_payment_intents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.online_order_payment_events', 'UPDATE')
  and has_table_privilege('service_role', 'public.online_order_payment_events', 'INSERT'),
  'only service_role can mutate payment ledgers'
);
select ok(
  has_function_privilege(
    'service_role',
    'app_private.record_online_order_payment_event(text,text,text,text,timestamp with time zone,timestamp with time zone,text,text,integer,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'app_private.reconcile_online_order_payment(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'online payment commands are service-role only'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, location,
  is_active, is_sold_out, business_status, ordering_enabled, ordering_state,
  currency, timezone
) values (
  'c4100000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Online payment local stall', 'online-payment-local-stall', 'PAY-LOCAL',
  'Local database only', 'Local database only',
  true, false, 'OPEN', true, 'OPEN', 'TWD', 'Asia/Taipei'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, subtotal,
  total, device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values
  (
    'c4200000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001', 'PAY-001', repeat('1', 64),
    'c4200000-0000-4000-8000-000000000011', 'STAFF', 'Local test customer',
    'CONFIRMED', 'UNPAID', 420, 420, repeat('2', 64), repeat('3', 64),
    now() + interval '10 minutes', now(), now()
  ),
  (
    'c4200000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001', 'PAY-002', repeat('4', 64),
    'c4200000-0000-4000-8000-000000000012', 'STAFF', 'Local mismatch customer',
    'CONFIRMED', 'UNPAID', 500, 500, repeat('5', 64), repeat('6', 64),
    now() + interval '10 minutes', now(), now()
  ),
  (
    'c4200000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001', 'PAY-003', repeat('7', 64),
    'c4200000-0000-4000-8000-000000000013', 'STAFF', 'Local failure customer',
    'CONFIRMED', 'UNPAID', 300, 300, repeat('8', 64), repeat('9', 64),
    now() + interval '10 minutes', now(), now()
  );

select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000001', repeat('a', 64), 'disabled-create'
  )->>'code',
  'ONLINE_ORDER_PAYMENT_DISABLED',
  'feature flag blocks new payment intents by default'
);

-- Owner-only test fixture: exercise the dormant implementation without
-- weakening the Production role boundary. This DDL change rolls back here.
alter table public.resilience_feature_flag_overrides
  disable trigger resilience_feature_flag_overrides_phase_three_lock_guard;

insert into public.resilience_feature_flag_overrides (
  flag_id, scope_type, organization_id, stall_id, enabled, reason
)
select id, 'STALL',
  '11111111-1111-4111-8111-111111111111',
  'c4100000-0000-4000-8000-000000000001',
  true, 'Enable local online payment contract test'
from public.resilience_feature_flags
where code = 'ONLINE_ORDER_PAYMENT_ENABLED';

create temporary table pg_temp.online_payment_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.online_payment_results values (
  'intent',
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000001', repeat('a', 64), 'create-intent'
  )
);

select ok(
  (select (value->>'ok')::boolean from pg_temp.online_payment_results where name = 'intent'),
  'enabled scope creates an online payment intent'
);
select is(
  (select value->>'amount' from pg_temp.online_payment_results where name = 'intent'),
  '420',
  'intent amount is derived from the trusted order'
);
select is(
  (select value->>'currency' from pg_temp.online_payment_results where name = 'intent'),
  'TWD',
  'intent currency is derived from the trusted stall'
);
select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000001', repeat('a', 64), 'retry-intent'
  )->>'code',
  'PAYMENT_INTENT_IDEMPOTENT_REPLAY',
  'same intent idempotency key and fingerprint replay safely'
);
select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000001', repeat('b', 64), 'conflict-intent'
  )->>'code',
  'PAYMENT_IDEMPOTENCY_CONFLICT',
  'same intent key cannot change request parameters'
);
select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000008', repeat('f', 64), 'second-intent'
  )->>'code',
  'PAYMENT_ORDER_INTENT_EXISTS',
  'an order cannot acquire a second payment intent under another key'
);
update public.resilience_feature_flag_overrides flag_override
set enabled = false,
  reason = 'Disable new local payment intents during contract test'
from public.resilience_feature_flags flag
where flag_override.flag_id = flag.id
  and flag.code = 'ONLINE_ORDER_PAYMENT_ENABLED'
  and flag_override.stall_id = 'c4100000-0000-4000-8000-000000000001';
select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000001', repeat('a', 64), 'disabled-retry'
  )->>'code',
  'PAYMENT_INTENT_IDEMPOTENT_REPLAY',
  'kill switch blocks new intents without hiding an exact existing retry'
);
insert into public.resilience_feature_flag_overrides (
  flag_id, scope_type, organization_id, stall_id, enabled, reason
)
select id, 'STALL',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  true, 'Enable forged-scope negative contract test'
from public.resilience_feature_flags
where code = 'ONLINE_ORDER_PAYMENT_ENABLED';
select is(
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'c4200000-0000-4000-8000-000000000001',
    'c4300000-0000-4000-8000-000000000009', repeat('c', 64), 'scope-mismatch'
  )->>'code',
  'PAYMENT_ORDER_NOT_FOUND',
  'tenant and stall scope cannot be forged'
);

insert into pg_temp.online_payment_results values (
  'authorize',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_AUTHORIZED', now() - interval '2 minutes', now(), repeat('1', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'event-authorize'
  )
);
select is(
  (select value->>'intentStatus' from pg_temp.online_payment_results where name = 'authorize'),
  'AUTHORIZED',
  'authorize event advances the intent'
);

insert into pg_temp.online_payment_results values (
  'capture',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_CAPTURED', now() - interval '1 minute', now(), repeat('2', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'event-capture'
  )
);
select is(
  (select value->>'intentStatus' from pg_temp.online_payment_results where name = 'capture'),
  'CAPTURED',
  'capture event marks only the intent as captured'
);
select is(
  (select payment_status::text from public.orders where id = 'c4200000-0000-4000-8000-000000000001'),
  'UNPAID',
  'webhook ingestion cannot mark an order paid'
);
select is(
  (select count(*)::integer from public.payments where order_id = 'c4200000-0000-4000-8000-000000000001'),
  0,
  'webhook ingestion cannot create a payment'
);
select is(
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_CAPTURED', now() - interval '1 minute', now(), repeat('2', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'event-capture-retry'
  )->>'code',
  'PAYMENT_EVENT_DUPLICATE',
  'identical webhook replay is duplicate-safe'
);
select is(
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_CAPTURED', now() - interval '1 minute', now(), repeat('9', 64),
    'c4200000-0000-4000-8000-000000000001', 421, 'TWD', 'event-capture-conflict'
  )->>'code',
  'PAYMENT_EVENT_IDEMPOTENCY_CONFLICT',
  'same provider event ID cannot be replayed with altered fields'
);
select is(
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_cccccccccccccccccccccccccccccccc',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_AUTHORIZED', now() - interval '3 minutes', now(), repeat('3', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'late-authorize'
  )->>'processingStatus',
  'IGNORED_OUT_OF_ORDER',
  'late authorize cannot downgrade captured state'
);
select is(
  (select status from public.online_order_payment_intents
   where id = ((select value->>'intentId' from pg_temp.online_payment_results where name = 'intent'))::uuid),
  'CAPTURED',
  'out-of-order event preserves captured authority'
);
select is(
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_dddddddddddddddddddddddddddddddd',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_FAILED', now(), now() - interval '6 minutes', repeat('4', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'stale-event'
  )->>'code',
  'PAYMENT_WEBHOOK_TIMESTAMP_EXPIRED',
  'database rejects an expired signed timestamp in depth'
);

insert into pg_temp.online_payment_results values (
  'reconcile',
  app_private.reconcile_online_order_payment(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    ((select value->>'intentId' from pg_temp.online_payment_results where name = 'intent'))::uuid,
    'reconcile-captured'
  )
);
select is(
  (select value->>'code' from pg_temp.online_payment_results where name = 'reconcile'),
  'PAYMENT_RECONCILED',
  'explicit reconciliation matches a captured event'
);
select is(
  (select payment_status::text from public.orders where id = 'c4200000-0000-4000-8000-000000000001'),
  'PAID',
  'matched reconciliation marks the order paid'
);
select is(
  (select amount::text || ':' || method::text || ':' || status::text
   from public.payments where order_id = 'c4200000-0000-4000-8000-000000000001'),
  '420:OTHER:PAID',
  'matched reconciliation creates one existing non-cash payment record'
);
select is(
  app_private.reconcile_online_order_payment(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    ((select value->>'intentId' from pg_temp.online_payment_results where name = 'intent'))::uuid,
    'reconcile-retry'
  )->>'code',
  'PAYMENT_RECONCILIATION_IDEMPOTENT_REPLAY',
  'reconciliation retry does not create a second payment'
);
select is(
  (select count(*)::integer from public.payments where order_id = 'c4200000-0000-4000-8000-000000000001'),
  1,
  'reconciliation remains exactly once'
);
insert into pg_temp.online_payment_results values (
  'post_reconcile_duplicate',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_33333333333333333333333333333333',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'intent'),
    'PAYMENT_CAPTURED', now(), now(), repeat('a', 64),
    'c4200000-0000-4000-8000-000000000001', 420, 'TWD', 'post-reconcile-duplicate'
  )
);
select is(
  (select value->>'processingStatus' from pg_temp.online_payment_results where name = 'post_reconcile_duplicate'),
  'IGNORED_OUT_OF_ORDER',
  'a second provider event ID after reconciliation cannot reapply capture'
);
select is(
  (select reconciliation_status from public.online_order_payment_intents
   where id = ((select value->>'intentId' from pg_temp.online_payment_results where name = 'intent'))::uuid),
  'MATCHED',
  'post-reconciliation webhook cannot downgrade matched authority'
);
select is(
  (select count(*)::integer from public.payments where order_id = 'c4200000-0000-4000-8000-000000000001'),
  1,
  'a separate duplicate provider event still leaves one payment'
);

update public.resilience_feature_flag_overrides flag_override
set enabled = true,
  reason = 'Re-enable new local payment intents for remaining contract cases'
from public.resilience_feature_flags flag
where flag_override.flag_id = flag.id
  and flag.code = 'ONLINE_ORDER_PAYMENT_ENABLED'
  and flag_override.stall_id = 'c4100000-0000-4000-8000-000000000001';

insert into pg_temp.online_payment_results values (
  'mismatch_intent',
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000002',
    'c4300000-0000-4000-8000-000000000002', repeat('d', 64), 'create-mismatch'
  )
);
insert into pg_temp.online_payment_results values (
  'mismatch_event',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'mismatch_intent'),
    'PAYMENT_CAPTURED', now(), now(), repeat('5', 64),
    'c4200000-0000-4000-8000-000000000002', 499, 'TWD', 'event-mismatch'
  )
);
select is(
  (select value->>'processingStatus' from pg_temp.online_payment_results where name = 'mismatch_event'),
  'MISMATCH',
  'amount mismatch is recorded but not applied'
);
insert into pg_temp.online_payment_results values (
  'order_mismatch_event',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_ffffffffffffffffffffffffffffffff',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'mismatch_intent'),
    'PAYMENT_CAPTURED', now(), now(), repeat('6', 64),
    'c4200000-0000-4000-8000-000000000001', 500, 'TWD', 'event-order-mismatch'
  )
);
select is(
  (select safe_error_code from public.online_order_payment_events
   where provider_event_id = 'local_mock_evt_ffffffffffffffffffffffffffffffff'),
  'ORDER_MISMATCH',
  'order reference mismatch is recorded and rejected'
);
insert into pg_temp.online_payment_results values (
  'currency_mismatch_event',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_00000000000000000000000000000000',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'mismatch_intent'),
    'PAYMENT_CAPTURED', now(), now(), repeat('7', 64),
    'c4200000-0000-4000-8000-000000000002', 500, 'USD', 'event-currency-mismatch'
  )
);
select is(
  (select safe_error_code from public.online_order_payment_events
   where provider_event_id = 'local_mock_evt_00000000000000000000000000000000'),
  'CURRENCY_MISMATCH',
  'currency mismatch is recorded and rejected'
);
select is(
  app_private.reconcile_online_order_payment(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    ((select value->>'intentId' from pg_temp.online_payment_results where name = 'mismatch_intent'))::uuid,
    'reconcile-mismatch'
  )->>'code',
  'PAYMENT_RECONCILIATION_MISMATCH',
  'mismatch cannot produce a payment'
);
select is(
  (select payment_status::text from public.orders where id = 'c4200000-0000-4000-8000-000000000002'),
  'UNPAID',
  'mismatch preserves cash and manual fallback'
);
select is(
  (select count(*)::integer from public.payments where order_id = 'c4200000-0000-4000-8000-000000000002'),
  0,
  'mismatch creates no existing payment row'
);

insert into pg_temp.online_payment_results values (
  'failure_intent',
  app_private.create_online_order_payment_intent(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    'c4200000-0000-4000-8000-000000000003',
    'c4300000-0000-4000-8000-000000000003', repeat('e', 64), 'create-failure'
  )
);
select ok(
  (select (value->>'ok')::boolean from pg_temp.online_payment_results where name = 'failure_intent'),
  'failure-path intent is created without claiming payment success'
);
insert into pg_temp.online_payment_results values (
  'failure_event',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_11111111111111111111111111111111',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'failure_intent'),
    'PAYMENT_FAILED', now() - interval '1 minute', now(), repeat('8', 64),
    'c4200000-0000-4000-8000-000000000003', 300, 'TWD', 'event-failure'
  )
);
select is(
  (select value->>'intentStatus' from pg_temp.online_payment_results where name = 'failure_event'),
  'FAILED',
  'provider failure does not masquerade as capture'
);
insert into pg_temp.online_payment_results values (
  'timeout_event',
  app_private.record_online_order_payment_event(
    'LOCAL_MOCK', 'local_mock_evt_22222222222222222222222222222222',
    (select value->>'providerIntentId' from pg_temp.online_payment_results where name = 'failure_intent'),
    'PAYMENT_TIMED_OUT', now(), now(), repeat('9', 64),
    'c4200000-0000-4000-8000-000000000003', 300, 'TWD', 'event-timeout'
  )
);
select is(
  (select value->>'intentStatus' from pg_temp.online_payment_results where name = 'timeout_event'),
  'TIMED_OUT',
  'provider timeout remains a non-captured terminal observation'
);
select is(
  app_private.reconcile_online_order_payment(
    '11111111-1111-4111-8111-111111111111',
    'c4100000-0000-4000-8000-000000000001',
    ((select value->>'intentId' from pg_temp.online_payment_results where name = 'failure_intent'))::uuid,
    'reconcile-timeout'
  )->>'code',
  'PAYMENT_NOT_CAPTURED',
  'failure and timeout cannot reconcile as paid'
);
select is(
  (select payment_status::text from public.orders where id = 'c4200000-0000-4000-8000-000000000003'),
  'UNPAID',
  'provider failure preserves the unpaid order for fallback collection'
);
select is(
  (select count(*)::integer from public.payments where order_id = 'c4200000-0000-4000-8000-000000000003'),
  0,
  'provider failure creates no payment row'
);
select ok(
  exists(
    select 1 from public.audit_logs
    where action in ('ONLINE_PAYMENT_INTENT_CREATED', 'ONLINE_PAYMENT_EVENT_RECORDED', 'ONLINE_PAYMENT_RECONCILED')
      and organization_id = '11111111-1111-4111-8111-111111111111'
      and stall_id = 'c4100000-0000-4000-8000-000000000001'
      and metadata is null
  ),
  'tenant-scoped audit records contain structured safe metadata only'
);
select ok(
  (select bool_and(request_id ~ '^online-payment:[0-9a-f]{64}$')
   from public.audit_logs
   where action like 'ONLINE_PAYMENT_%'
     and stall_id = 'c4100000-0000-4000-8000-000000000001'),
  'online payment audit correlation IDs are hashed before persistence'
);

select * from finish();
rollback;
