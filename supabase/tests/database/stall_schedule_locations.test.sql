begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

select has_table('public', 'stall_locations', 'stall locations table exists');
select has_table('public', 'market_events', 'market events table exists');
select has_table('public', 'stall_schedules', 'stall schedules table exists');
select has_column('public', 'qr_codes', 'stall_schedule_id', 'QR codes support trusted schedule context');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.stall_locations'::regclass,
     'public.market_events'::regclass,
     'public.stall_schedules'::regclass
   )),
  'all schedule tables enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.stall_locations', 'SELECT')
  and not has_table_privilege('anon', 'public.market_events', 'SELECT')
  and not has_table_privilege('anon', 'public.stall_schedules', 'SELECT'),
  'anonymous users cannot read internal schedule tables'
);
select ok(
  not has_table_privilege('anon', 'public.stall_schedules', 'INSERT')
  and not has_table_privilege('authenticated', 'public.stall_schedules', 'UPDATE'),
  'public and authenticated clients cannot write schedules directly'
);
select ok(
  exists (select 1 from public.plan_entitlements where feature_code = 'STALL_LOCATION' and is_enabled),
  'stall locations are enforced by server-side entitlements'
);
select ok(
  exists (select 1 from public.plan_entitlements where feature_code = 'STALL_SCHEDULE' and is_enabled),
  'stall schedules are enforced by server-side entitlements'
);

select throws_ok(
  $$
    insert into public.stall_schedules (
      organization_id, stall_id, starts_at, ends_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', now(), now() + interval '1 hour'
    )
  $$,
  '23514', null,
  'a schedule requires a location or market event'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, ordering_state, updated_at
) values (
  '8a000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111', '排程隔離攤位',
  'schedule-isolation-stall', 'SCHEDULE-ISO', '台北市隔離路 1 號',
  'TWD', 'Asia/Taipei', true, 'OPEN', true, 'CLOSED', now()
);

insert into public.stall_locations (
  id, organization_id, stall_id, name, address, latitude, longitude
) values
  (
    '8a100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '寧夏夜市入口', '台北市大同區寧夏路', 25.056000, 121.515000
  ),
  (
    '8a100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '8a000000-0000-4000-8000-000000000001',
    '隔離測試地點', '台北市隔離路 1 號', null, null
  );

select throws_ok(
  $$
    insert into public.stall_schedules (
      organization_id, stall_id, location_id, starts_at, ends_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '8a000000-0000-4000-8000-000000000001',
      '8a100000-0000-4000-8000-000000000001', now(), now() + interval '1 hour'
    )
  $$,
  'P0001', 'STALL_SCHEDULE_LOCATION_SCOPE_MISMATCH',
  'a schedule cannot use another stall location'
);

select throws_ok(
  $$
    insert into public.market_events (
      organization_id, name, slug, venue_name, address, starts_at, ends_at
    ) values (
      '11111111-1111-4111-8111-111111111111', '錯誤活動', 'invalid-event',
      '錯誤場地', '台北市', now(), now() - interval '1 hour'
    )
  $$,
  '23514', null,
  'market event end must be later than start'
);

insert into public.market_events (
  id, organization_id, name, slug, venue_name, address,
  starts_at, ends_at, is_public
) values (
  '8a200000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111', '週末市集', 'weekend-market',
  '市民廣場', '台北市信義區', now() - interval '1 hour',
  now() + interval '2 hours', true
);

select throws_ok(
  $$
    update public.market_events
    set organization_id = '8affffff-ffff-4fff-8fff-ffffffffffff'
    where id = '8a200000-0000-4000-8000-000000000001'
  $$,
  'P0001', 'MARKET_EVENT_ORGANIZATION_IMMUTABLE',
  'an event cannot be moved across organization scope'
);

insert into public.stall_schedules (
  id, organization_id, stall_id, location_id, market_event_id,
  starts_at, ends_at, ordering_opens_at, ordering_closes_at,
  status, auto_open_enabled, auto_close_enabled
) values (
  '8a300000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '8a100000-0000-4000-8000-000000000001',
  '8a200000-0000-4000-8000-000000000001',
  now() - interval '5 minutes', now() + interval '1 hour',
  now() - interval '5 minutes', now() + interval '10 minutes',
  'SCHEDULED', true, true
);

update public.stalls
set ordering_enabled = true, ordering_state = 'CLOSED', business_status = 'OPEN',
    is_active = true, is_sold_out = false
where id = '22222222-2222-4222-8222-222222222222';
update public.stall_capacity_settings
set pause_source = 'NONE', auto_pause_enabled = false, auto_resume_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.qr_codes
set state = 'ACTIVE', expires_at = null,
    location_id = '8a100000-0000-4000-8000-000000000001',
    market_event_id = '8a200000-0000-4000-8000-000000000001',
    stall_schedule_id = '8a300000-0000-4000-8000-000000000001',
    fulfillment_type_context = 'TAKEOUT'
where id = '33333333-3333-4333-8333-333333333333';

select is(
  (app_private.process_stall_schedules(now())->>'opened')::integer,
  1,
  'scheduled opening runs once'
);
select is(
  (select status::text from public.stall_schedules where id = '8a300000-0000-4000-8000-000000000001'),
  'OPEN',
  'automatic opening changes schedule status to OPEN'
);
select is(
  (select ordering_state::text from public.stalls where id = '22222222-2222-4222-8222-222222222222'),
  'OPEN',
  'automatic opening enables public ordering state'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where entity_id = '8a300000-0000-4000-8000-000000000001'
      and action = 'STALL_SCHEDULE_AUTOMATIC_OPENED'
  ),
  'automatic opening is audited'
);
select is(
  (app_private.process_stall_schedules(now())->>'opened')::integer,
  0,
  'automatic opening is idempotent'
);

create temporary table schedule_session_results (name text primary key, value jsonb);
insert into schedule_session_results values (
  'first',
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me', repeat('1', 64), repeat('2', 64),
    repeat('3', 64), repeat('4', 64), repeat('5', 64), 'schedule-session-1', 'DEFAULT'
  )
);
select is(
  (select value->>'ok' from schedule_session_results where name = 'first'),
  'true',
  'active schedule permits a new QR order session'
);
select ok(
  exists (
    select 1 from public.order_sessions
    where token_hash = repeat('1', 64)
      and location_id = '8a100000-0000-4000-8000-000000000001'
      and market_event_id = '8a200000-0000-4000-8000-000000000001'
      and stall_schedule_id = '8a300000-0000-4000-8000-000000000001'
      and fulfillment_type_context = 'TAKEOUT'
  ),
  'order session stores the trusted QR schedule context'
);
insert into schedule_session_results values (
  'second',
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me', repeat('6', 64), repeat('7', 64),
    repeat('8', 64), repeat('9', 64), repeat('a', 64), 'schedule-session-2', 'DEFAULT'
  )
);
select is(
  (select value->>'ok' from schedule_session_results where name = 'second'),
  'true',
  'multiple short sessions can be issued while the schedule remains open'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, pickup_code_hash,
  pickup_code_display, confirmation_expires_at, created_at, updated_at
) values (
  '8a400000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', 'SCHEDULE-CONFIRMED', repeat('b', 64),
  '8a410000-0000-4000-8000-000000000001', 'STAFF_POS', '既有確認訂單',
  'TAKEOUT', 'CONFIRMED', 'UNPAID', 100, 100, repeat('c', 64), repeat('d', 64),
  '321', now() + interval '10 minutes', now(), now()
);
select is(
  (select status::text from public.orders where id = '8a400000-0000-4000-8000-000000000001'),
  'CONFIRMED',
  'confirmed order exists before scheduled closing'
);

select is(
  (app_private.process_stall_schedules(now() + interval '20 minutes')->>'closed')::integer,
  1,
  'scheduled closing runs once'
);
select is(
  (select status::text from public.stall_schedules where id = '8a300000-0000-4000-8000-000000000001'),
  'COMPLETED',
  'automatic closing completes the schedule'
);
select is(
  (select ordering_state::text from public.stalls where id = '22222222-2222-4222-8222-222222222222'),
  'CLOSED',
  'automatic closing stops new public ordering'
);
select is(
  (select status::text from public.order_sessions where token_hash = repeat('6', 64)),
  'REVOKED',
  'automatic closing revokes active order sessions'
);
select is(
  (select status::text from public.orders where id = '8a400000-0000-4000-8000-000000000001'),
  'CONFIRMED',
  'scheduled closing does not cancel existing confirmed orders'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where entity_id = '8a300000-0000-4000-8000-000000000001'
      and action = 'STALL_SCHEDULE_AUTOMATIC_CLOSED'
  ),
  'automatic closing is audited'
);
select is(
  (app_private.process_stall_schedules(now() + interval '20 minutes')->>'closed')::integer,
  0,
  'automatic closing is idempotent'
);

insert into public.market_events (
  id, organization_id, name, slug, venue_name, address, starts_at, ends_at
) values (
  '8a200000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111', '已結束活動', 'expired-market',
  '舊場地', '台北市', now() - interval '2 hours', now() - interval '1 hour'
);
update public.qr_codes
set stall_schedule_id = null,
    market_event_id = '8a200000-0000-4000-8000-000000000002',
    location_id = '8a100000-0000-4000-8000-000000000001'
where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me', repeat('e', 64), repeat('f', 64),
    repeat('0', 64), repeat('g', 64), repeat('h', 64), 'expired-event', 'DEFAULT'
  )->>'code',
  'EVENT_EXPIRED',
  'expired event QR cannot create an order session'
);

insert into public.stall_schedules (
  id, organization_id, stall_id, location_id, starts_at, ends_at,
  status, auto_open_enabled, auto_close_enabled
) values (
  '8a300000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '8a100000-0000-4000-8000-000000000001',
  now() - interval '1 hour', now() + interval '1 hour', 'CANCELLED', false, false
);
update public.qr_codes
set stall_schedule_id = '8a300000-0000-4000-8000-000000000002',
    market_event_id = null,
    location_id = '8a100000-0000-4000-8000-000000000001'
where id = '33333333-3333-4333-8333-333333333333';
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me', repeat('i', 64), repeat('j', 64),
    repeat('k', 64), repeat('l', 64), repeat('m', 64), 'cancelled-schedule', 'DEFAULT'
  )->>'code',
  'SCHEDULE_CLOSED',
  'cancelled schedule QR cannot create an order session'
);

insert into public.stall_schedules (
  id, organization_id, stall_id, location_id, starts_at, ends_at, status
) values (
  '8a300000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '8a100000-0000-4000-8000-000000000001',
  now() - interval '10 minutes', now() + interval '1 hour', 'DELAYED'
);
select app_private.process_stall_schedules(now());
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'SCHEDULE_START_DELAYED' and status = 'ACTIVE'
  ),
  'a delayed schedule creates an operational alert'
);
update public.stall_schedules set status = 'CANCELLED'
where id = '8a300000-0000-4000-8000-000000000003';
select app_private.process_stall_schedules(now());
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'SCHEDULE_START_DELAYED' and status = 'RESOLVED'
  ),
  'schedule delay alert resolves after the delayed state ends'
);

insert into auth.users (id, email) values
  ('8a500000-0000-4000-8000-000000000001', 'schedule-staff@stallorder.test'),
  ('8a500000-0000-4000-8000-000000000002', 'schedule-kitchen@stallorder.test');
update public.profiles set auth_user_id = '8a500000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555552';
update public.profiles set auth_user_id = '8a500000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', '8a500000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.stall_locations),
  1,
  'staff sees locations for the assigned stall only'
);
select set_config('request.jwt.claim.sub', '8a500000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.stall_locations),
  0,
  'kitchen role cannot read stall location management data'
);
select ok(
  not has_table_privilege(current_user, 'public.stall_schedules', 'UPDATE'),
  'authenticated roles cannot bypass APIs to mutate schedules'
);

select * from finish();
rollback;
