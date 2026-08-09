begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.capacity_events;
delete from public.product_capacity_rules;

create function pg_temp.add_capacity_session(p_token text)
returns void
language sql
as $$
  insert into public.order_sessions (
    id, tenant_id, stall_id, qr_code_id, token_hash, device_hash,
    ip_hash, status, expires_at, created_at
  ) values (
    gen_random_uuid(),
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    encode(extensions.digest('capacity-device', 'sha256'), 'hex'),
    encode(extensions.digest('capacity-ip', 'sha256'), 'hex'),
    'ACTIVE', now() + interval '10 minutes', now()
  );
$$;

create function pg_temp.submit_capacity_order(
  p_session text,
  p_order_id uuid,
  p_idempotency_key uuid,
  p_wait_acknowledged boolean,
  p_product_id uuid default '44444444-4444-4444-8444-444444444441',
  p_quantity integer default 1
)
returns jsonb
language sql
as $$
  select public.create_public_order_with_capacity(
    p_order_id,
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest(p_session, 'sha256'), 'hex'),
    encode(extensions.digest('capacity-device', 'sha256'), 'hex'),
    encode(extensions.digest('capacity-ip', 'sha256'), 'hex'),
    encode(extensions.digest('capacity-qr', 'sha256'), 'hex'),
    encode(extensions.digest('capacity-behavior', 'sha256'), 'hex'),
    p_idempotency_key,
    encode(extensions.digest(p_idempotency_key::text, 'sha256'), 'hex'),
    '容量測試顧客',
    '',
    jsonb_build_array(jsonb_build_object(
      'product_id', p_product_id,
      'quantity', p_quantity,
      'note', '',
      'modifier_option_ids', '[]'::jsonb
    )),
    encode(extensions.digest('tracking-' || p_order_id::text, 'sha256'), 'hex'),
    encode(extensions.digest('pickup-' || p_order_id::text, 'sha256'), 'hex'),
    'capacity-' || p_order_id::text,
    p_wait_acknowledged
  );
$$;

select ok(
  exists (
    select 1 from public.stall_capacity_settings
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  'existing stalls receive default capacity settings'
);
select has_column(
  'public',
  'capacity_events',
  'updated_at',
  'capacity events retain the required tenant-scoped timestamps'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.stall_capacity_settings'::regclass,
     'public.product_capacity_rules'::regclass,
     'public.capacity_events'::regclass
   )),
  'all capacity tables enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.stall_capacity_settings', 'SELECT'),
  'anonymous users cannot read capacity settings'
);
select ok(
  not has_table_privilege('anon', 'public.stall_capacity_settings', 'INSERT')
  and not has_table_privilege('authenticated', 'public.stall_capacity_settings', 'UPDATE'),
  'capacity settings cannot be written directly through the Data API'
);
select ok(
  not has_function_privilege(
    'anon', 'public.calculate_stall_capacity(uuid,jsonb)', 'EXECUTE'
  ),
  'anonymous users cannot execute the trusted capacity calculator'
);
select ok(
  not has_function_privilege(
    'anon', 'public.refresh_stall_capacity(uuid,boolean,text)', 'EXECUTE'
  ),
  'anonymous users cannot execute the trusted capacity refresh'
);
select ok(
  has_function_privilege(
    'service_role', 'public.refresh_stall_capacity(uuid,boolean,text)', 'EXECUTE'
  ),
  'the service role retains access to the trusted capacity refresh'
);
select ok(
  exists (
    select 1 from public.plan_entitlements
    where feature_code = 'WAIT_TIME_QUOTE' and is_enabled
  ),
  'wait-time quotes are backed by server-side entitlements'
);
select ok(
  exists (
    select 1 from public.plan_entitlements
    where feature_code = 'CAPACITY_CONTROL' and is_enabled
  ),
  'capacity controls are backed by server-side entitlements'
);

update public.stall_capacity_settings
set window_minutes = 15,
    max_orders_per_window = 20,
    max_items_per_window = 10,
    warning_utilization_percent = 75,
    pause_utilization_percent = 100,
    default_prep_minutes = 5,
    minimum_quote_minutes = 0,
    maximum_quote_minutes = 120,
    quote_buffer_minutes = 0,
    acknowledgment_threshold_minutes = 60,
    manual_wait_minutes = null,
    auto_pause_enabled = false,
    auto_resume_enabled = false,
    pause_source = 'NONE'
where stall_id = '22222222-2222-4222-8222-222222222222';

create temporary table capacity_refresh_results (
  name text primary key,
  snapshot jsonb not null
);
insert into capacity_refresh_results values (
  'no_action_expected',
  public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    '[]'::jsonb
  )
), (
  'no_action_actual',
  public.refresh_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    false,
    'NO_ACTION_SNAPSHOT_TEST'
  )
);
select is(
  (select (snapshot - 'window_start') - 'window_end'
   from capacity_refresh_results where name = 'no_action_actual'),
  (select (snapshot - 'window_start') - 'window_end'
   from capacity_refresh_results where name = 'no_action_expected'),
  'a refresh without state changes returns the authoritative first snapshot'
);

create temporary table capacity_test_values (
  name text primary key,
  value integer not null
);
insert into capacity_test_values values (
  'empty_quote',
  (public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444444',
      'quantity', 1
    ))
  )->>'quote_max_minutes')::integer
);
select ok(
  (select value >= 5 from capacity_test_values where name = 'empty_quote'),
  'the deterministic quote respects configured preparation time'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, pickup_code_hash,
  pickup_code_display, confirmation_expires_at, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'CAP-LOAD-1', repeat('a', 64),
  'c1000000-0000-4000-8000-000000000011', 'STAFF_POS', '容量負載',
  'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 175, 175, repeat('b', 64),
  repeat('c', 64), '101', now() + interval '10 minutes', now(), now()
);
insert into public.order_items (
  id, tenant_id, organization_id, stall_id, order_id, product_id,
  name, base_unit_price, unit_price, quantity, status
) values (
  'c2000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'c1000000-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444442', '地瓜薯條', 55, 55, 5, 'PENDING'
);
update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = 'c1000000-0000-4000-8000-000000000001';
select ok(
  (public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444444',
      'quantity', 1
    ))
  )->>'quote_max_minutes')::integer
  > (select value from capacity_test_values where name = 'empty_quote'),
  'the quoted wait increases when confirmed workload increases'
);

update public.stall_capacity_settings
set warning_utilization_percent = 50
where stall_id = '22222222-2222-4222-8222-222222222222';
insert into capacity_refresh_results values (
  'warning_only',
  public.refresh_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    false,
    'WARNING_WITHOUT_STATE_CHANGE_TEST'
  )
);
select is(
  (select jsonb_build_object(
     'pause_source', snapshot->>'pause_source',
     'accepting_public_orders', (snapshot->>'accepting_public_orders')::boolean
   ) from capacity_refresh_results where name = 'warning_only'),
  jsonb_build_object(
    'pause_source', 'NONE',
    'accepting_public_orders', true
  ),
  'a warning-only refresh returns an open snapshot without changing ordering state'
);
select is(
  (select count(*)::integer from public.capacity_events
   where event_type = 'CAPACITY_WARNING'),
  1,
  'a warning-only refresh emits one capacity warning event'
);
update public.stall_capacity_settings
set warning_utilization_percent = 75
where stall_id = '22222222-2222-4222-8222-222222222222';

delete from public.orders where id = 'c1000000-0000-4000-8000-000000000001';
insert into public.product_capacity_rules (
  organization_id, stall_id, product_id, capacity_weight, prep_minutes
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444441', 5, 20
);
select ok(
  (public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441', 'quantity', 1
    ))
  )->>'quote_max_minutes')::integer
  >
  (public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444444', 'quantity', 1
    ))
  )->>'quote_max_minutes')::integer,
  'product preparation weight and time affect the quote'
);

insert into public.product_capacity_rules (
  organization_id, stall_id, product_id, capacity_weight, prep_minutes,
  max_quantity_per_window
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444444', 1, 5, 1
);
select is(
  public.calculate_stall_capacity(
    '22222222-2222-4222-8222-222222222222',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444444', 'quantity', 2
    ))
  )->>'product_limit_exceeded',
  'true',
  'a product quantity beyond its configured window limit is detected'
);
select pg_temp.add_capacity_session('capacity-limit-session');
select is(
  pg_temp.submit_capacity_order(
    'capacity-limit-session',
    'c3000000-0000-4000-8000-000000000001',
    'c3000000-0000-4000-8000-000000000011',
    true,
    '44444444-4444-4444-8444-444444444444',
    2
  )->>'code',
  'PRODUCT_CAPACITY_EXCEEDED',
  'public ordering rejects a product above its capacity rule'
);
select is(
  (select count(*)::integer from public.public_order_attempts
   where reason_code = 'PRODUCT_CAPACITY_EXCEEDED'),
  1,
  'product capacity denial is recorded in the public security log'
);

delete from public.order_sessions;
delete from public.product_capacity_rules;
update public.stall_capacity_settings
set max_items_per_window = 2,
    warning_utilization_percent = 50,
    pause_utilization_percent = 100,
    auto_pause_enabled = true,
    auto_resume_enabled = true,
    pause_source = 'NONE'
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls
set business_status = 'OPEN', ordering_state = 'OPEN', ordering_enabled = true,
    is_active = true, is_sold_out = false
where id = '22222222-2222-4222-8222-222222222222';
update public.qr_codes
set state = 'ACTIVE', expires_at = null
where id = '33333333-3333-4333-8333-333333333333';

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, pickup_code_hash,
  pickup_code_display, confirmation_expires_at, created_at, updated_at
) values (
  'c1000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'CAP-LOAD-2', repeat('d', 64),
  'c1000000-0000-4000-8000-000000000012', 'STAFF_POS', '自動暫停負載',
  'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 165, 165, repeat('e', 64),
  repeat('f', 64), '102', now() + interval '10 minutes', now(), now()
);
insert into public.order_items (
  id, tenant_id, organization_id, stall_id, order_id, product_id,
  name, base_unit_price, unit_price, quantity, status
) values (
  'c2000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'c1000000-0000-4000-8000-000000000002',
  '44444444-4444-4444-8444-444444444442', '地瓜薯條', 55, 55, 3, 'PENDING'
);
update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = 'c1000000-0000-4000-8000-000000000002';

select is(
  (select pause_source from public.stall_capacity_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  'AUTO',
  'capacity pressure automatically pauses public ordering'
);
select is(
  (select ordering_state::text from public.stalls
   where id = '22222222-2222-4222-8222-222222222222'),
  'PAUSED',
  'auto-pause updates the authoritative stall ordering state'
);
select is(
  (select state::text from public.qr_codes
   where id = '33333333-3333-4333-8333-333333333333'),
  'PAUSED',
  'auto-pause also pauses active QR codes'
);
select is(
  (select count(*)::integer from public.capacity_events
   where event_type = 'AUTO_PAUSED'),
  1,
  'auto-pause emits one capacity event'
);
select public.refresh_stall_capacity(
  '22222222-2222-4222-8222-222222222222', true, 'REPEATED_TEST_REFRESH'
);
select is(
  (select count(*)::integer from public.capacity_events
   where event_type = 'AUTO_PAUSED'),
  1,
  'repeated refresh does not duplicate the auto-pause event'
);

update public.orders
set status = 'CANCELLED', cancelled_at = now()
where id = 'c1000000-0000-4000-8000-000000000002';
select is(
  (select pause_source from public.stall_capacity_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  'NONE',
  'capacity recovery automatically clears an automatic pause'
);
select is(
  (select ordering_state::text from public.stalls
   where id = '22222222-2222-4222-8222-222222222222'),
  'OPEN',
  'automatic resume reopens public ordering'
);
select is(
  (select count(*)::integer from public.capacity_events
   where event_type = 'AUTO_RESUMED'),
  1,
  'automatic resume emits one capacity event'
);

update public.stall_capacity_settings
set pause_source = 'MANUAL'
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls set ordering_state = 'PAUSED'
where id = '22222222-2222-4222-8222-222222222222';
select public.refresh_stall_capacity(
  '22222222-2222-4222-8222-222222222222', true, 'MANUAL_OVERRIDE_TEST'
);
select is(
  (select pause_source from public.stall_capacity_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  'MANUAL',
  'manual pause remains authoritative over automatic resume'
);
select is(
  (select ordering_state::text from public.stalls
   where id = '22222222-2222-4222-8222-222222222222'),
  'PAUSED',
  'automatic capacity control cannot reopen a manually paused stall'
);
select lives_ok(
  $$
    insert into public.orders (
      id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
      idempotency_key, source, customer_name, fulfillment_type, status,
      payment_status, subtotal, total, device_hash, pickup_code_hash,
      pickup_code_display, confirmation_expires_at, created_at, updated_at
    ) values (
      'c1000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'CAP-STAFF', repeat('1', 64),
      'c1000000-0000-4000-8000-000000000013', 'STAFF_POS', '現場人工點餐',
      'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 0, 0, repeat('2', 64),
      repeat('3', 64), '103', now() + interval '10 minutes', now(), now()
    )
  $$,
  'staff-origin orders remain available while public QR ordering is paused'
);
delete from public.orders where id = 'c1000000-0000-4000-8000-000000000003';

update public.stall_capacity_settings
set auto_pause_enabled = false, auto_resume_enabled = false, pause_source = 'NONE'
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stalls set business_status = 'CLOSED', ordering_state = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';
update public.qr_codes set state = 'ACTIVE'
where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session_with_capacity(
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest('closed-session', 'sha256'), 'hex'),
    encode(extensions.digest('closed-ip', 'sha256'), 'hex'),
    encode(extensions.digest('closed-device', 'sha256'), 'hex'),
    encode(extensions.digest('closed-qr', 'sha256'), 'hex'),
    encode(extensions.digest('closed-behavior', 'sha256'), 'hex'),
    'capacity-closed-session'
  )->>'code',
  'STALL_CLOSED',
  'a closed stall keeps the established public rejection code'
);

update public.stalls set business_status = 'OPEN', ordering_state = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';
update public.stall_capacity_settings
set max_items_per_window = 60,
    manual_wait_minutes = 30,
    acknowledgment_threshold_minutes = 20,
    pause_source = 'NONE'
where stall_id = '22222222-2222-4222-8222-222222222222';
select pg_temp.add_capacity_session('capacity-quote-session');
select is(
  pg_temp.submit_capacity_order(
    'capacity-quote-session',
    'c3000000-0000-4000-8000-000000000002',
    'c3000000-0000-4000-8000-000000000012',
    false
  )->>'code',
  'WAIT_ACKNOWLEDGMENT_REQUIRED',
  'long waits require explicit customer acknowledgment'
);
select is(
  (select count(*)::integer from public.public_order_attempts
   where reason_code = 'WAIT_ACKNOWLEDGMENT_REQUIRED'),
  1,
  'missing wait acknowledgment is recorded in the security log'
);
select is(
  pg_temp.submit_capacity_order(
    'capacity-quote-session',
    'c3000000-0000-4000-8000-000000000002',
    'c3000000-0000-4000-8000-000000000012',
    true
  )->'order'->>'order_status',
  'WAITING_CONFIRMATION',
  'an acknowledged public order is created in the existing initial status'
);
select is(
  (select quoted_wait_minutes from public.orders
   where id = 'c3000000-0000-4000-8000-000000000002'),
  30,
  'the original quoted wait is stored on order creation'
);
select ok(
  (select quoted_ready_at between created_at + interval '29 minutes 59 seconds'
      and created_at + interval '30 minutes 1 second'
   from public.orders where id = 'c3000000-0000-4000-8000-000000000002'),
  'the quoted ready timestamp is derived on the server'
);
update public.stall_capacity_settings
set manual_wait_minutes = 5
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  pg_temp.submit_capacity_order(
    'capacity-quote-session',
    'c3000000-0000-4000-8000-000000000004',
    'c3000000-0000-4000-8000-000000000012',
    true
  )->>'idempotent_replay',
  'true',
  'duplicate idempotency keys return the existing capacity-aware order'
);
select is(
  pg_temp.submit_capacity_order(
    'capacity-quote-session',
    'c3000000-0000-4000-8000-000000000005',
    'c3000000-0000-4000-8000-000000000012',
    true
  )->'order'->>'quoted_wait_minutes',
  '30',
  'idempotent replay cannot rewrite the original wait quote'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'c4000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '容量隔離攤位', 'capacity-isolation-stall', 'CAP-ISO', '測試地址',
  'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);
select ok(
  exists (
    select 1 from public.stall_capacity_settings
    where stall_id = 'c4000000-0000-4000-8000-000000000001'
  ),
  'new stalls automatically receive isolated capacity settings'
);

insert into auth.users (id, email) values (
  'c5000000-0000-4000-8000-000000000001', 'capacity-staff@stallorder.test'
);
update public.profiles
set auth_user_id = 'c5000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555552';
insert into auth.users (id, email) values (
  'c5000000-0000-4000-8000-000000000002', 'capacity-kitchen@stallorder.test'
);
update public.profiles
set auth_user_id = 'c5000000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.stall_capacity_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'staff can read capacity state for the assigned stall'
);
select is(
  (select count(*)::integer from public.stall_capacity_settings
   where stall_id = 'c4000000-0000-4000-8000-000000000001'),
  0,
  'staff cannot read capacity state for another stall'
);
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.stall_capacity_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'kitchen users cannot read capacity configuration'
);
reset role;

select * from finish();
rollback;
