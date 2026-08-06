begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

select ok(
  to_regclass('public.orders_bestseller_completed_idx') is not null,
  'best-seller lookup has a selective completed-order index'
);
select ok(
  not has_function_privilege('anon', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'anonymous clients cannot call the best-seller RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'authenticated clients cannot call the best-seller RPC directly'
);
select ok(
  has_function_privilege('service_role', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'the trusted service role can call the best-seller RPC'
);

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
) values
  (
    'a8100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-001', repeat('1', 64),
    'a8200000-0000-4000-8000-000000000001', 'STAFF_POS', false, 'Best Seller QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 1200, 1200, 'bestseller-device', now(),
    now() - interval '1 day', null, now() - interval '1 day', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-002', repeat('2', 64),
    'a8200000-0000-4000-8000-000000000002', 'STAFF_POS', false, 'Best Seller QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 800, 800, 'bestseller-device', now(),
    now() - interval '2 days', null, now() - interval '2 days', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-003', repeat('3', 64),
    'a8200000-0000-4000-8000-000000000003', 'STAFF_POS', false, 'Best Seller QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 300, 300, 'bestseller-device', now(),
    now() - interval '3 days', null, now() - interval '3 days', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-004', repeat('4', 64),
    'a8200000-0000-4000-8000-000000000004', 'STAFF_POS', false, 'Below Threshold QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 200, 200, 'bestseller-device', now(),
    now() - interval '4 days', null, now() - interval '4 days', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-005', repeat('5', 64),
    'a8200000-0000-4000-8000-000000000005', 'MERCHANT_SETUP_TEST', true, 'Test Order QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 10000, 10000, 'bestseller-device', now(),
    now() - interval '1 day', null, now() - interval '1 day', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-006', repeat('6', 64),
    'a8200000-0000-4000-8000-000000000006', 'STAFF_POS', false, 'Old Order QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 10000, 10000, 'bestseller-device', now(),
    now() - interval '31 days', null, now() - interval '31 days', now()
  ),
  (
    'a8100000-0000-4000-8000-000000000007',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'BEST-007', repeat('7', 64),
    'a8200000-0000-4000-8000-000000000007', 'STAFF_POS', false, 'Cancelled Order QA',
    'TAKEOUT', 'COMPLETED', 'PAID', 10000, 10000, 'bestseller-device', now(),
    now() - interval '1 day', now() - interval '1 day', now() - interval '1 day', now()
  );

insert into public.order_items (
  id, organization_id, stall_id, order_id, product_id, name,
  base_unit_price, unit_price, quantity
) values
  (
    'a8300000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444441',
    'Rank One', 100, 100, 12
  ),
  (
    'a8300000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444442',
    'Rank Two', 100, 100, 8
  ),
  (
    'a8300000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444443',
    'Rank Three', 100, 100, 3
  ),
  (
    'a8300000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444',
    'Below Threshold', 100, 100, 2
  ),
  (
    'a8300000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444',
    'Test Order', 100, 100, 100
  ),
  (
    'a8300000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444',
    'Old Order', 100, 100, 100
  ),
  (
    'a8300000-0000-4000-8000-000000000007',
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'a8100000-0000-4000-8000-000000000007', '44444444-4444-4444-8444-444444444444',
    'Cancelled Order', 100, 100, 100
  );

-- A bestseller must represent repeated customer demand, not one unusually
-- large order. Give each ranked product at least three distinct completed
-- orders while preserving the original quantity order.
insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
)
select
  ('a8100000-0000-4000-8000-' || lpad(series_no::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'BEST-' || lpad(series_no::text, 3, '0'),
  encode(extensions.digest('BEST-' || series_no, 'sha256'), 'hex'),
  ('a8200000-0000-4000-8000-' || lpad(series_no::text, 12, '0'))::uuid,
  'STAFF_POS',
  false,
  'Repeated Demand QA',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  100,
  100,
  repeat('8', 64),
  now(),
  now() - (series_no || ' hours')::interval,
  null,
  now() - (series_no || ' hours')::interval,
  now()
from generate_series(8, 13) as series_no;

insert into public.order_items (
  id, organization_id, stall_id, order_id, product_id, name,
  base_unit_price, unit_price, quantity
)
select
  ('a8300000-0000-4000-8000-' || lpad(series_no::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  ('a8100000-0000-4000-8000-' || lpad(series_no::text, 12, '0'))::uuid,
  case
    when series_no between 8 and 9 then '44444444-4444-4444-8444-444444444441'::uuid
    when series_no between 10 and 11 then '44444444-4444-4444-8444-444444444442'::uuid
    else '44444444-4444-4444-8444-444444444443'::uuid
  end,
  'Repeated Demand',
  100,
  100,
  1
from generate_series(8, 13) as series_no;

select is(
  (select count(*)::integer from public.get_stall_best_sellers('22222222-2222-4222-8222-222222222222')),
  3,
  'only three qualifying products are returned'
);
select results_eq(
  $$select product_id::text, rank from public.get_stall_best_sellers('22222222-2222-4222-8222-222222222222')$$,
  $$values
      ('44444444-4444-4444-8444-444444444441'::text, 1),
      ('44444444-4444-4444-8444-444444444442'::text, 2),
      ('44444444-4444-4444-8444-444444444443'::text, 3)$$,
  'ranking uses product ids and completed unit quantity'
);
select ok(
  not exists (
    select 1
    from public.get_stall_best_sellers('22222222-2222-4222-8222-222222222222')
    where product_id = '44444444-4444-4444-8444-444444444444'
  ),
  'test, old, cancelled, and single-order sales are excluded'
);
select is(
  (select count(*)::integer from public.get_stall_best_sellers('99999999-9999-4999-8999-999999999999')),
  0,
  'ranking never leaks products from a different stall scope'
);
select is(
  (
    select proretset
    from pg_proc
    where oid = 'public.get_stall_best_sellers(uuid)'::regprocedure
  ),
  true,
  'the ranking contract remains a set-returning function'
);

select * from finish();
rollback;
