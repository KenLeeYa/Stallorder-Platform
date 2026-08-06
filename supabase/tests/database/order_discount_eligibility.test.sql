begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

select is(
  (select is_order_discount_eligible from public.products
   where id = '44444444-4444-4444-8444-444444444441'),
  true,
  'existing products remain eligible by default'
);

insert into public.products (
  id, organization_id, category_id, name, description,
  default_price, is_order_discount_eligible, is_active, sort_order
) values
  (
    'd1100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777771',
    'Discount excluded product', '', 100, false, true, 900
  ),
  (
    'd1100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '77777777-7777-4777-8777-777777777771',
    'Discount eligible product', '', 50, true, true, 901
  );

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, created_at, updated_at
) values (
  'd1200000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'DISCOUNT-001', repeat('1', 64),
  'd1300000-0000-4000-8000-000000000001',
  'STAFF_POS', 'Discount snapshot customer', 'TAKEOUT',
  'WAITING_CONFIRMATION', 'UNPAID', 150, 150, repeat('2', 64),
  now() + interval '10 minutes', now(), now()
);

insert into public.order_items (
  id, organization_id, stall_id, order_id, product_id,
  name, base_unit_price, unit_price, quantity
) values
  (
    'd1400000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000001',
    'Discount excluded product', 100, 100, 1
  ),
  (
    'd1400000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'd1200000-0000-4000-8000-000000000001',
    'd1100000-0000-4000-8000-000000000002',
    'Discount eligible product', 50, 50, 1
  );

select is(
  (select is_order_discount_eligible from public.order_items
   where id = 'd1400000-0000-4000-8000-000000000001'),
  false,
  'an excluded product is snapshotted as ineligible'
);
select is(
  (select is_order_discount_eligible from public.order_items
   where id = 'd1400000-0000-4000-8000-000000000002'),
  true,
  'an eligible product is snapshotted as eligible'
);

update public.products
set is_order_discount_eligible = true
where id = 'd1100000-0000-4000-8000-000000000001';
select is(
  (select is_order_discount_eligible from public.order_items
   where id = 'd1400000-0000-4000-8000-000000000001'),
  false,
  'later product changes do not rewrite the order-item snapshot'
);

delete from public.products
where id = 'd1100000-0000-4000-8000-000000000001';
select is(
  (select product_id from public.order_items
   where id = 'd1400000-0000-4000-8000-000000000001'),
  null::uuid,
  'deleting a product clears only the historical product reference'
);
select is(
  (select is_order_discount_eligible from public.order_items
   where id = 'd1400000-0000-4000-8000-000000000001'),
  false,
  'deleting a product preserves the historical eligibility snapshot'
);

update public.orders
set discount_source = 'LOTTERY',
    discount_rate_bps = 9000,
    discount_amount = 15,
    total = 135
where id = 'd1200000-0000-4000-8000-000000000001';
select is(
  (select discount_amount from public.orders
   where id = 'd1200000-0000-4000-8000-000000000001'),
  5,
  'lottery discounts only the eligible item subtotal'
);
select is(
  (select total from public.orders
   where id = 'd1200000-0000-4000-8000-000000000001'),
  145,
  'lottery preserves the full price of excluded items'
);

select ok(
  not has_function_privilege(
    'anon', 'public.snapshot_order_item_discount_eligibility()', 'EXECUTE'
  ),
  'anonymous clients cannot execute the snapshot trigger function'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.enforce_lottery_order_discount_eligibility()', 'EXECUTE'
  ),
  'authenticated clients cannot execute the lottery discount trigger function'
);

select * from finish();
rollback;
