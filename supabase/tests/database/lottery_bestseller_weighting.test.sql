begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(30);

select ok(
  to_regprocedure('public.get_stall_best_sellers(uuid)') is not null,
  'best-seller ranking RPC exists'
);
select ok(
  to_regprocedure('app_private.get_lottery_product_recommendation_pool(uuid,uuid)') is not null,
  'trusted lottery recommendation pool exists'
);
select ok(
  to_regprocedure('app_private.pick_lottery_recommendation_pool(integer,boolean,boolean)') is not null,
  'exact recommendation pool selector exists'
);
select ok(
  not has_function_privilege('anon', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'anonymous clients cannot call the best-seller RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'authenticated clients cannot call the best-seller RPC'
);
select ok(
  has_function_privilege('service_role', 'public.get_stall_best_sellers(uuid)', 'EXECUTE'),
  'the service role can call the best-seller RPC'
);
select is(
  (
    select prosecdef
    from pg_proc
    where oid = 'public.get_stall_best_sellers(uuid)'::regprocedure
  ),
  false,
  'best-seller reporting does not require SECURITY DEFINER'
);
select ok(
  not has_function_privilege(
    'anon',
    'app_private.get_lottery_product_recommendation_pool(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot inspect recommendation weights'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app_private.get_lottery_product_recommendation_pool(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated clients cannot inspect recommendation weights'
);
select ok(
  has_function_privilege(
    'service_role',
    'app_private.get_lottery_product_recommendation_pool(uuid,uuid)',
    'EXECUTE'
  ),
  'the service role can inspect trusted recommendation weights'
);
select ok(
  not has_function_privilege(
    'anon',
    'app_private.pick_lottery_recommendation_pool(integer,boolean,boolean)',
    'EXECUTE'
  ),
  'anonymous clients cannot choose the internal recommendation pool'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app_private.pick_lottery_recommendation_pool(integer,boolean,boolean)',
    'EXECUTE'
  ),
  'authenticated clients cannot choose the internal recommendation pool'
);
select ok(
  has_function_privilege(
    'service_role',
    'app_private.pick_lottery_recommendation_pool(integer,boolean,boolean)',
    'EXECUTE'
  ),
  'the service role can choose the internal recommendation pool'
);

select is(
  app_private.pick_lottery_recommendation_pool(0, true, true),
  'BEST_SELLER',
  'the first 80 percent starts in the bestseller pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(7999, true, true),
  'BEST_SELLER',
  'bucket 7999 remains in the bestseller pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(8000, true, true),
  'DISCOVERY',
  'bucket 8000 starts the discovery pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(9999, true, true),
  'DISCOVERY',
  'the last valid bucket remains in the discovery pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(5000, true, false),
  'BEST_SELLER',
  'a bestseller-only catalog always uses the available pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(5000, false, true),
  'DISCOVERY',
  'a discovery-only catalog always uses the available pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(5000, false, false),
  null,
  'an empty catalog has no recommendation pool'
);
select is(
  app_private.pick_lottery_recommendation_pool(10000, true, true),
  null,
  'out-of-contract buckets are rejected'
);
select is(
  app_private.pick_lottery_recommendation_pool(null, true, true),
  null,
  'a missing recommendation bucket is rejected'
);

delete from public.orders;

update public.products
set is_active = true,
    is_lottery_eligible = true,
    kind = 'SINGLE'::public.product_kind
where id in (
  '44444444-4444-4444-8444-444444444441',
  '44444444-4444-4444-8444-444444444442',
  '44444444-4444-4444-8444-444444444443',
  '44444444-4444-4444-8444-444444444444'
);

update public.product_categories as category
set is_active = true
where exists (
  select 1
  from public.products as product
  where product.category_id = category.id
    and product.id in (
      '44444444-4444-4444-8444-444444444441',
      '44444444-4444-4444-8444-444444444442',
      '44444444-4444-4444-8444-444444444443',
      '44444444-4444-4444-8444-444444444444'
    )
);

update public.stall_products
set is_enabled = true,
    is_sold_out = false,
    available_from = null,
    available_until = null
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id in (
    '44444444-4444-4444-8444-444444444441',
    '44444444-4444-4444-8444-444444444442',
    '44444444-4444-4444-8444-444444444443',
    '44444444-4444-4444-8444-444444444444'
  );

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'LOT-WEIGHT-P1-' || series_no,
  encode(extensions.digest('LOT-WEIGHT-P1-' || series_no, 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  'ONLINE_STAFF'::public.order_origin,
  false,
  'Popularity QA',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  300,
  300,
  repeat('1', 64),
  now(),
  now() - (series_no || ' hours')::interval,
  null,
  now() - (series_no || ' hours')::interval,
  now()
from generate_series(1, 4) as series_no;

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'LOT-WEIGHT-P2-' || series_no,
  encode(extensions.digest('LOT-WEIGHT-P2-' || series_no, 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  'ONLINE_STAFF'::public.order_origin,
  false,
  'Popularity QA',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  200,
  200,
  repeat('2', 64),
  now(),
  now() - ((series_no + 5) || ' hours')::interval,
  null,
  now() - ((series_no + 5) || ' hours')::interval,
  now()
from generate_series(1, 3) as series_no;

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'LOT-WEIGHT-P3-' || series_no,
  encode(extensions.digest('LOT-WEIGHT-P3-' || series_no, 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  'ONLINE_STAFF'::public.order_origin,
  false,
  'Popularity QA',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  100,
  100,
  repeat('3', 64),
  now(),
  now() - ((series_no + 9) || ' hours')::interval,
  null,
  now() - ((series_no + 9) || ' hours')::interval,
  now()
from generate_series(1, 3) as series_no;

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'LOT-WEIGHT-EXCLUDED-' || excluded_kind || '-' || series_no,
  encode(extensions.digest('LOT-WEIGHT-EXCLUDED-' || excluded_kind || '-' || series_no, 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  case
    when excluded_kind = 'CANARY' then 'SYSTEM_CANARY'::public.order_origin
    when excluded_kind = 'TEST_ORIGIN' then 'TEST'::public.order_origin
    else 'ONLINE_STAFF'::public.order_origin
  end,
  excluded_kind = 'IS_TEST',
  'Excluded Popularity QA',
  'TAKEOUT',
  'COMPLETED',
  case when excluded_kind = 'REFUND'
    then 'REFUNDED'::public.payment_status
    else 'PAID'::public.payment_status
  end,
  10000,
  10000,
  repeat('4', 64),
  now(),
  case
    when excluded_kind = 'OLD' then now() - interval '31 days'
    else now() - ((series_no + 13) || ' hours')::interval
  end,
  case
    when excluded_kind = 'CANCELLED' then now() - interval '1 hour'
    else null
  end,
  case
    when excluded_kind = 'OLD' then now() - interval '31 days'
    else now() - ((series_no + 13) || ' hours')::interval
  end,
  now()
from (values
  ('REFUND'),
  ('CANARY'),
  ('TEST_ORIGIN'),
  ('IS_TEST'),
  ('CANCELLED'),
  ('OLD')
) as excluded(excluded_kind)
cross join generate_series(1, 3) as series_no;

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, completed_at,
  cancelled_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'LOT-WEIGHT-P4-ONE-LARGE',
  encode(extensions.digest('LOT-WEIGHT-P4-ONE-LARGE', 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  'ONLINE_STAFF',
  false,
  'Single Large Order QA',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  10000,
  10000,
  repeat('5', 64),
  now(),
  now() - interval '20 hours',
  null,
  now() - interval '20 hours',
  now()
);

insert into public.order_items (
  id, organization_id, stall_id, order_id, product_id, name,
  base_unit_price, unit_price, quantity
)
select
  gen_random_uuid(),
  order_record.organization_id,
  order_record.stall_id,
  order_record.id,
  case
    when order_record.order_no like 'LOT-WEIGHT-P1-%'
      then '44444444-4444-4444-8444-444444444441'::uuid
    when order_record.order_no like 'LOT-WEIGHT-P2-%'
      then '44444444-4444-4444-8444-444444444442'::uuid
    when order_record.order_no like 'LOT-WEIGHT-P3-%'
      then '44444444-4444-4444-8444-444444444443'::uuid
    else '44444444-4444-4444-8444-444444444444'::uuid
  end,
  order_record.order_no,
  100,
  100,
  case
    when order_record.order_no like 'LOT-WEIGHT-P1-%' then 3
    when order_record.order_no like 'LOT-WEIGHT-P2-1' then 4
    when order_record.order_no like 'LOT-WEIGHT-P2-%' then 2
    when order_record.order_no like 'LOT-WEIGHT-P3-%' then 1
    else 100
  end
from public.orders as order_record
where order_record.order_no like 'LOT-WEIGHT-%';

select results_eq(
  $$select product_id::text, rank
    from public.get_stall_best_sellers('22222222-2222-4222-8222-222222222222')$$,
  $$values
      ('44444444-4444-4444-8444-444444444441'::text, 1),
      ('44444444-4444-4444-8444-444444444442'::text, 2),
      ('44444444-4444-4444-8444-444444444443'::text, 3)$$,
  'ranking uses completed order count and quantity while excluding refunds and synthetic orders'
);

select results_eq(
  $$select product_id::text, best_seller_rank, recommendation_pool, recommendation_weight
    from app_private.get_lottery_product_recommendation_pool(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )$$,
  $$values
      ('44444444-4444-4444-8444-444444444441'::text, 1, 'BEST_SELLER'::text, 5),
      ('44444444-4444-4444-8444-444444444442'::text, 2, 'BEST_SELLER'::text, 3),
      ('44444444-4444-4444-8444-444444444443'::text, 3, 'BEST_SELLER'::text, 2),
      ('44444444-4444-4444-8444-444444444444'::text, null::integer, 'DISCOVERY'::text, 1)$$,
  'the trusted recommendation pool applies bounded 5/3/2 weights and preserves discovery eligibility'
);

update public.products
set is_lottery_eligible = false
where id = '44444444-4444-4444-8444-444444444441';

select results_eq(
  $$select product_id::text, best_seller_rank, recommendation_pool, recommendation_weight
    from app_private.get_lottery_product_recommendation_pool(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )$$,
  $$values
      ('44444444-4444-4444-8444-444444444442'::text, 1, 'BEST_SELLER'::text, 5),
      ('44444444-4444-4444-8444-444444444443'::text, 2, 'BEST_SELLER'::text, 3),
      ('44444444-4444-4444-8444-444444444444'::text, null::integer, 'DISCOVERY'::text, 1)$$,
  'lottery ranking is reassigned after product eligibility filtering'
);

update public.products
set is_lottery_eligible = true
where id = '44444444-4444-4444-8444-444444444441';

update public.stall_products
set is_sold_out = true
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';

select results_eq(
  $$select product_id::text, rank
    from public.get_stall_best_sellers('22222222-2222-4222-8222-222222222222')$$,
  $$values
      ('44444444-4444-4444-8444-444444444442'::text, 1),
      ('44444444-4444-4444-8444-444444444443'::text, 2)$$,
  'a sold-out historical bestseller does not consume a current Top 3 position'
);

select is(
  (
    select count(*)::integer
    from public.get_stall_best_sellers('99999999-9999-4999-8999-999999999999')
  ),
  0,
  'ranking never crosses the requested stall boundary'
);

select ok(
  not has_function_privilege('anon', 'public.draw_public_lottery(text,text)', 'EXECUTE'),
  'anonymous clients still cannot call the trusted lottery draw directly'
);
select ok(
  not has_function_privilege('authenticated', 'public.draw_public_lottery(text,text)', 'EXECUTE'),
  'authenticated clients still cannot call the trusted lottery draw directly'
);
select ok(
  has_function_privilege('service_role', 'public.draw_public_lottery(text,text)', 'EXECUTE'),
  'the service role can still execute lottery draws'
);

select * from finish();
rollback;
