begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name in (
        'requested_fulfillment_at', 'committed_fulfillment_at',
        'pending_fulfillment_at', 'fulfillment_time_state',
        'fulfillment_time_version', 'fulfillment_time_response_expires_at',
        'customer_time_responded_at', 'fulfillment_time_change_reason',
        'fulfillment_time_proposed_by'
      )
  ),
  9,
  'orders stores requested, committed, pending and versioned response state'
);

select ok(
  not has_function_privilege(
    'anon', 'public.respond_to_fulfillment_time(text,text,integer,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'authenticated', 'public.respond_to_fulfillment_time(text,text,integer,text)', 'EXECUTE'
  ),
  'public roles cannot call the fulfillment-time response RPC directly'
);

select ok(
  has_function_privilege(
    'service_role', 'public.respond_to_fulfillment_time(text,text,integer,text)', 'EXECUTE'
  ),
  'only the trusted service role can call the response RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_public_order_with_fulfillment_time(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamptz,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.create_public_order_with_fulfillment_time(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamptz,uuid)',
    'EXECUTE'
  ),
  'public roles cannot call the fulfillment-time order writer directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_public_order_with_fulfillment_time(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamptz,uuid)',
    'EXECUTE'
  ),
  'the trusted service role can call the fulfillment-time order writer'
);

update public.stall_ordering_settings
set takeout_preorder_enabled = true,
    preorder_min_lead_minutes = 15,
    preorder_max_days = 2,
    preorder_slot_minutes = 15
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stall_business_hours
set opens_at = '00:00', closes_at = '23:45', is_closed = false
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stall_capacity_settings
set pause_source = 'NONE',
    auto_pause_enabled = false,
    manual_wait_minutes = null
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stalls
set is_active = true,
    is_sold_out = false,
    ordering_enabled = false,
    business_status = 'CLOSED',
    ordering_state = 'CLOSED'
where id = '22222222-2222-4222-8222-222222222222';

create temporary table pg_temp.fulfillment_writer_values (
  slot timestamptz,
  expired_slot timestamptz,
  initial_result jsonb,
  same_replay_result jsonb,
  expired_replay_result jsonb,
  conflict_result jsonb
) on commit drop;

insert into pg_temp.fulfillment_writer_values (slot)
select value::timestamptz
from jsonb_array_elements_text(
  public.get_takeout_preorder_slots(
    '22222222-2222-4222-8222-222222222222', now()
  )
)
order by value::timestamptz
limit 1;

select ok(
  (select slot > now() from pg_temp.fulfillment_writer_values),
  'the fulfillment writer fixture uses a currently valid future slot'
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('h', 64), repeat('d', 64),
    repeat('q', 64), repeat('c', 64), 'fulfillment-session-1', 'PREORDER'
  )->>'ok',
  'true',
  'a preorder session is issued for the fulfillment writer regression'
);

update pg_temp.fulfillment_writer_values
set initial_result = public.create_public_order_with_fulfillment_time(
  'fa300000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('s', 64), repeat('d', 64), repeat('h', 64),
  repeat('q', 64), repeat('c', 64),
  'fa400000-0000-4000-8000-000000000001', repeat('i', 64),
  'Fulfillment replay customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('t', 64), repeat('p', 64), 'fulfillment-order-initial', false,
  slot, null
);

select ok(
  (
    select initial_result->>'ok' = 'true'
      and initial_result->>'idempotent_replay' = 'false'
      and initial_result #>> '{order,order_id}' = 'fa300000-0000-4000-8000-000000000001'
      and exists (
        select 1
        from public.orders order_record
        where order_record.id = 'fa300000-0000-4000-8000-000000000001'
          and order_record.requested_fulfillment_at = values_record.slot
          and order_record.fulfillment_time_state = 'REQUESTED'
          and order_record.fulfillment_time_version = 1
      )
    from pg_temp.fulfillment_writer_values values_record
  ),
  'the fulfillment writer creates and versions the first requested-time order'
);

update pg_temp.fulfillment_writer_values
set same_replay_result = public.create_public_order_with_fulfillment_time(
  'fa300000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('s', 64), repeat('d', 64), repeat('h', 64),
  repeat('q', 64), repeat('c', 64),
  'fa400000-0000-4000-8000-000000000001', repeat('i', 64),
  'Fulfillment replay customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('t', 64), repeat('p', 64), 'fulfillment-order-replay', false,
  slot, null
);

select ok(
  (
    select same_replay_result->>'ok' = 'true'
      and same_replay_result->>'idempotent_replay' = 'true'
      and same_replay_result #>> '{order,order_id}' = 'fa300000-0000-4000-8000-000000000001'
      and (select count(*) from public.orders) = 1
    from pg_temp.fulfillment_writer_values
  ),
  'an identical fulfillment retry replays the existing order exactly once'
);

update pg_temp.fulfillment_writer_values
set expired_slot = now() - interval '5 minutes';

update public.orders order_record
set requested_fulfillment_at = values_record.expired_slot,
    scheduled_pickup_at = values_record.expired_slot,
    confirmation_expires_at = values_record.expired_slot,
    updated_at = now()
from pg_temp.fulfillment_writer_values values_record
where order_record.id = 'fa300000-0000-4000-8000-000000000001';

update public.order_sessions session_record
set requested_fulfillment_at = values_record.expired_slot
from pg_temp.fulfillment_writer_values values_record
where session_record.token_hash = repeat('s', 64);

update public.stall_ordering_settings
set takeout_preorder_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';

update pg_temp.fulfillment_writer_values
set expired_replay_result = public.create_public_order_with_fulfillment_time(
  'fa300000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('s', 64), repeat('d', 64), repeat('h', 64),
  repeat('q', 64), repeat('c', 64),
  'fa400000-0000-4000-8000-000000000001', repeat('i', 64),
  'Fulfillment replay customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('t', 64), repeat('p', 64), 'fulfillment-order-expired-replay', false,
  expired_slot, null
);

select ok(
  (
    select expired_replay_result->>'ok' = 'true'
      and expired_replay_result->>'idempotent_replay' = 'true'
      and expired_replay_result #>> '{order,order_id}' = 'fa300000-0000-4000-8000-000000000001'
    from pg_temp.fulfillment_writer_values
  ),
  'an identical replay survives an expired time and changed preorder settings'
);

update pg_temp.fulfillment_writer_values
set conflict_result = public.create_public_order_with_fulfillment_time(
  'fa300000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('s', 64), repeat('d', 64), repeat('h', 64),
  repeat('q', 64), repeat('c', 64),
  'fa400000-0000-4000-8000-000000000001', repeat('i', 64),
  'Fulfillment replay customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444444',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('t', 64), repeat('p', 64), 'fulfillment-order-conflict', false,
  expired_slot + interval '5 minutes', null
);

select is(
  (select conflict_result->>'code' from pg_temp.fulfillment_writer_values),
  'IDEMPOTENCY_CONFLICT',
  'an existing idempotency key rejects a different requested time before slot validation'
);

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, customer_name, fulfillment_type, status, payment_status,
  customer_phone, delivery_address,
  subtotal, total, device_hash, confirmation_expires_at,
  requested_fulfillment_at, committed_fulfillment_at, pending_fulfillment_at,
  fulfillment_time_state, fulfillment_time_version,
  fulfillment_time_response_expires_at, fulfillment_time_change_reason,
  created_at, updated_at
) values
  (
    'fa100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'TIME-001', repeat('a', 64), 'fa200000-0000-4000-8000-000000000001',
    'QR_MENU', 'Accept customer', 'DELIVERY', 'WAITING_CONFIRMATION', 'UNPAID',
    '0912345678', '台北市測試路 1 號',
    100, 100, repeat('b', 64), now() + interval '10 minutes',
    now() + interval '60 minutes', null, now() + interval '90 minutes',
    'CUSTOMER_ACTION_REQUIRED', 2, now() + interval '30 minutes',
    '原時段產能已滿', now(), now()
  ),
  (
    'fa100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'TIME-002', repeat('c', 64), 'fa200000-0000-4000-8000-000000000002',
    'QR_MENU', 'Decline customer', 'TAKEOUT', 'CONFIRMED', 'UNPAID',
    null, null,
    100, 100, repeat('d', 64), now() + interval '10 minutes',
    now() + interval '60 minutes', now() + interval '60 minutes', now() + interval '120 minutes',
    'CUSTOMER_ACTION_REQUIRED', 3, now() + interval '30 minutes',
    '需要延後備餐', now(), now()
  ),
  (
    'fa100000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'TIME-003', repeat('e', 64), 'fa200000-0000-4000-8000-000000000003',
    'QR_MENU', 'Expired customer', 'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID',
    null, null,
    100, 100, repeat('f', 64), now() + interval '10 minutes',
    now() + interval '60 minutes', null, now() + interval '90 minutes',
    'CUSTOMER_ACTION_REQUIRED', 1, now() - interval '1 minute',
    '需要重新確認', now(), now()
  );

select is(
  public.respond_to_fulfillment_time(repeat('a', 64), repeat('b', 64), 2, 'ACCEPT')->>'state',
  'CONFIRMED',
  'customer can accept the current proposal version'
);
select is(
  (select committed_fulfillment_at from public.orders where order_no = 'TIME-001'),
  (select requested_fulfillment_at + interval '30 minutes' from public.orders where order_no = 'TIME-001'),
  'accepting moves the pending time into the committed time'
);
select is(
  (select pending_fulfillment_at from public.orders where order_no = 'TIME-001'),
  null::timestamptz,
  'accepting clears the pending proposal'
);
select is(
  public.respond_to_fulfillment_time(repeat('a', 64), repeat('b', 64), 2, 'ACCEPT')->>'code',
  'FULFILLMENT_TIME_PROPOSAL_STALE',
  'a repeated or stale response cannot accept an inactive proposal'
);

select is(
  public.respond_to_fulfillment_time(repeat('c', 64), repeat('d', 64), 3, 'DECLINE')->>'state',
  'DECLINED',
  'customer can decline the current proposal'
);
select is(
  (select committed_fulfillment_at from public.orders where order_no = 'TIME-002'),
  (select requested_fulfillment_at from public.orders where order_no = 'TIME-002'),
  'declining preserves the previously committed time'
);

select is(
  public.respond_to_fulfillment_time(repeat('e', 64), repeat('f', 64), 1, 'ACCEPT')->>'code',
  'FULFILLMENT_TIME_PROPOSAL_EXPIRED',
  'an expired proposal cannot be accepted'
);
select is(
  (select fulfillment_time_state from public.orders where order_no = 'TIME-003'),
  'EXPIRED',
  'an expired response updates the agreement state'
);

select throws_ok(
  $$
    update public.orders
    set fulfillment_time_state = 'CUSTOMER_ACTION_REQUIRED',
        pending_fulfillment_at = null,
        fulfillment_time_response_expires_at = now() + interval '10 minutes'
    where order_no = 'TIME-001'
  $$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_fulfillment_time_consistency_check"',
  'database rejects an action-required state without a pending time'
);

select is(
  (
    select metadata_json->>'response'
    from public.order_events
    where order_id = 'fa100000-0000-4000-8000-000000000001'
      and event_type = 'FULFILLMENT_TIME_ACCEPTED'
  ),
  'ACCEPT',
  'customer response is recorded in the immutable order event history'
);

select * from finish();
rollback;
