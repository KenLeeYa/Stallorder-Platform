begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

-- The browser and channel API allow live table QR rewards. Exercise the real
-- nested draw functions; mocking only the outer channel policy misses this gap.
update public.stalls set ordering_enabled = true, ordering_state = 'OPEN',
  business_status = 'OPEN', is_sold_out = false, is_active = true
where id = '22222222-2222-4222-8222-222222222222';
update public.stall_ordering_settings set dine_in_enabled = true,
  lottery_enabled = true, lottery_spend_reward_enabled = true,
  lottery_spend_threshold_amount = 100, lottery_festival_reward_enabled = false,
  lottery_product_ids = array['c7090012-0000-4000-8000-000000000001']::uuid[]
where stall_id = '22222222-2222-4222-8222-222222222222';
delete from public.stall_lottery_campaigns
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stall_business_hours set opens_at = '00:00', closes_at = '23:59', is_closed = false
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.stall_capacity_settings set pause_source = 'NONE', auto_pause_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';
update public.qr_codes set state = 'ACTIVE', expires_at = null
where token = 'demo-aming-chicken-table-a1-qr-2026';
insert into public.products (id, organization_id, category_id, name, description, default_price, kind, is_active)
select 'c7090012-0000-4000-8000-000000000001', organization_id, category_id,
  'Table lottery QA', 'Transactional table lottery fixture', 100, 'SINGLE', true from public.products
where id = '44444444-4444-4444-8444-444444444441';
insert into public.stall_products (organization_id, stall_id, product_id, is_enabled, is_sold_out)
values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  'c7090012-0000-4000-8000-000000000001', true, false);

select is(public.issue_order_session_with_schedule(
  'demo-aming-chicken-table-a1-qr-2026', repeat('d1',32), repeat('d2',32),
  repeat('d3',32), repeat('d4',32), repeat('d5',32), 'table-lottery-qa', 'DEFAULT'
)->>'ok', 'true', 'table QR issues a live session');
create temporary table table_draw as select public.draw_public_lottery(
  repeat('d1',32), repeat('d3',32), 100) as result;
select is((select result->>'ok' from table_draw), 'true', 'table QR can draw through both RPC layers');
select is((select result->>'freeProductReward' from table_draw), 'true', 'table QR receives the qualified free meal');
select is((select result->>'productId' from table_draw), 'c7090012-0000-4000-8000-000000000001', 'reward uses the configured product pool');
select is(public.draw_public_lottery(repeat('d1',32), repeat('d3',32), 100)->>'drawId',
  (select result->>'drawId' from table_draw), 'a lost reply retries the same daily draw');
select is((select count(*)::integer from public.public_lottery_draws where device_hash = repeat('d3',32)),
  1, 'retry creates no second reward');
insert into public.qr_codes (id, organization_id, stall_id, token, label, fulfillment_type_context, token_version)
values
  ('c7090012-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'qa-lottery-delivery-20260907-unchanged-token', 'QA delivery', 'DELIVERY', 970912),
  ('c7090012-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'qa-lottery-preorder-20260907-unchanged-token', 'QA preorder', 'TAKEOUT', 970913);
insert into public.order_sessions (id, organization_id, stall_id, qr_code_id, token_hash,
  device_hash, ip_hash, expires_at, fulfillment_type_context, ordering_mode)
values
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'c7090012-0000-4000-8000-000000000002', repeat('e1',32), repeat('d3',32), repeat('e2',32), now()+interval '10 minutes', 'DELIVERY', 'DEFAULT'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
   'c7090012-0000-4000-8000-000000000003', repeat('f1',32), repeat('d3',32), repeat('f2',32), now()+interval '10 minutes', 'TAKEOUT', 'PREORDER');
select is(public.draw_public_lottery(repeat('e1',32), repeat('d3',32), 100)->>'code',
  'LOTTERY_UNAVAILABLE', 'delivery remains excluded before daily replay');
select is(public.draw_public_lottery(repeat('f1',32), repeat('d3',32), 100)->>'code',
  'LOTTERY_UNAVAILABLE', 'preorders remain excluded before daily replay');
create temporary table table_order as select public.create_public_order_with_free_lottery_reward_targeted(
  'c7090012-0000-4000-8000-000000000004', 'demo-aming-chicken-table-a1-qr-2026',
  repeat('d1',32), repeat('d3',32), repeat('d2',32), repeat('d4',32), repeat('d5',32),
  'c7090012-0000-4000-8000-000000000005', repeat('a1',32), '', null, null, '',
  jsonb_build_array(jsonb_build_object('product_id', 'c7090012-0000-4000-8000-000000000001',
    'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb, 'bundle_choice_ids', '[]'::jsonb)),
  repeat('a2',32), repeat('a3',32), 'table-lottery-order', true,
  null, (select (result->>'drawId')::uuid from table_draw)
) as result;
select is((select result->>'ok' from table_order), 'true', 'table order commits its awarded gift');
select is((select subtotal from public.orders where id = 'c7090012-0000-4000-8000-000000000004'),
  100, 'the server charges only the paid item');
select is((select count(*)::integer from public.order_items where order_id = 'c7090012-0000-4000-8000-000000000004'),
  2, 'paid item and gift both reach the order consumers');
select is((select unit_price from public.order_items where order_id = 'c7090012-0000-4000-8000-000000000004' and lottery_draw_id is not null),
  0, 'the audited gift line is free');
select is((select is_order_discount_eligible from public.order_items where order_id = 'c7090012-0000-4000-8000-000000000004' and lottery_draw_id is not null),
  false, 'the discount snapshot trigger preserves gift exclusion');
select is((select is_order_discount_eligible from public.order_items where order_id = 'c7090012-0000-4000-8000-000000000004' and lottery_draw_id is null),
  true, 'paid lines still snapshot product discount eligibility');
select * from finish();
rollback;
