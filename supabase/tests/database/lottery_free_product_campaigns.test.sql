begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select has_column(
  'public', 'stall_ordering_settings', 'lottery_spend_reward_enabled',
  'stall settings include spend-threshold rewards'
);
select has_column(
  'public', 'public_lottery_draws', 'reward_kind',
  'draws snapshot recommendation versus free-product rewards'
);
select has_column(
  'public', 'order_items', 'promotion_source',
  'order items preserve free-reward provenance'
);
select has_function(
  'public', 'draw_public_lottery', array['text', 'text', 'integer'],
  'campaign-aware lottery draw overload exists'
);
select ok(
  not has_function_privilege(
    'anon', 'public.draw_public_lottery(text,text,integer)', 'EXECUTE'
  ),
  'anonymous clients cannot call the trusted campaign draw directly'
);
select ok(
  has_function_privilege(
    'service_role', 'public.draw_public_lottery(text,text,integer)', 'EXECUTE'
  ),
  'the server role can call the campaign draw'
);

select throws_ok(
  $$
    update public.stall_ordering_settings
    set lottery_birthday_reward_enabled = true
    where stall_id = '22222222-2222-4222-8222-222222222222'
  $$,
  '23514',
  null,
  'birthday rewards stay disabled until verified member birthday support exists'
);

update public.stall_ordering_settings
set lottery_enabled = true,
    lottery_discount_option_id = null,
    lottery_discount_win_rate_bps = 0,
    lottery_spend_reward_enabled = true,
    lottery_spend_threshold_amount = 666,
    lottery_festival_reward_enabled = false,
    lottery_festival_starts_on = null,
    lottery_festival_ends_on = null,
    lottery_birthday_reward_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';

delete from public.stall_lottery_discount_chances
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stalls
set is_active = true,
    is_sold_out = false,
    ordering_enabled = true,
    business_status = 'OPEN',
    ordering_state = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';

update public.qr_codes
set state = 'ACTIVE', expires_at = null
where token = 'demo-aming-chicken-qr-2026-rotate-me';

update public.stall_business_hours
set opens_at = '00:00', closes_at = '23:59', is_closed = false
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stall_capacity_settings
set pause_source = 'NONE', auto_pause_enabled = false,
    manual_wait_minutes = null, acknowledgment_threshold_minutes = 120
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.products product
set is_lottery_eligible = false
where exists (
  select 1 from public.stall_products assignment
  where assignment.stall_id = '22222222-2222-4222-8222-222222222222'
    and assignment.product_id = product.id
);

insert into public.product_categories (
  id, organization_id, name, sort_order, is_active, updated_at
) values (
  'c6000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Free reward QA', 990, true, now()
);

insert into public.products (
  id, organization_id, category_id, name, description,
  default_price, kind, is_active, is_lottery_eligible, sort_order
) values (
  'c7000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'c6000000-0000-4000-8000-000000000001',
  'Free reward meal', 'Free reward transaction fixture',
  700, 'SINGLE', true, true, 990
);

insert into public.stall_products (
  organization_id, stall_id, product_id, price_override,
  is_enabled, is_sold_out, sort_order
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'c7000000-0000-4000-8000-000000000001',
  null, true, false, 990
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('6', 64), repeat('8', 64), repeat('7', 64),
    repeat('9', 64), repeat('a', 64), 'free-reward-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a live session is issued for a qualifying takeaway order'
);

select is(
  public.draw_public_lottery(repeat('6', 64), repeat('7', 64), 500)->>'code',
  'LOTTERY_NOT_ELIGIBLE',
  'a client total below the configured threshold does not receive a draw'
);
select is(
  (
    select count(*)::integer from public.public_lottery_draws draw
    where draw.device_hash = repeat('7', 64)
      and draw.stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  0,
  'an ineligible request does not consume the daily draw'
);

create temporary table pg_temp.free_reward_result (
  draw_response jsonb,
  order_response jsonb
) on commit drop;
insert into pg_temp.free_reward_result (draw_response)
values (public.draw_public_lottery(repeat('6', 64), repeat('7', 64), 700));

select is(
  (select draw_response->>'ok' from pg_temp.free_reward_result),
  'true',
  'a server-eligible spend request receives a draw'
);
select is(
  (select draw_response->>'freeProductReward' from pg_temp.free_reward_result),
  'true',
  'the qualifying draw is marked as a free-product reward'
);
select is(
  (select draw_response->>'qualificationType' from pg_temp.free_reward_result),
  'SPEND',
  'the draw reports its spend qualification source'
);
select is(
  (
    select draw.reward_kind || '|' || draw.qualification_type || '|'
      || draw.qualification_threshold_amount::text
    from public.public_lottery_draws draw
    where draw.id = (
      select (draw_response->>'drawId')::uuid from pg_temp.free_reward_result
    )
  ),
  'FREE_PRODUCT|SPEND|666',
  'the trusted draw stores immutable reward qualification metadata'
);

update pg_temp.free_reward_result
set order_response = public.create_public_order_with_fulfillment_time_targeted(
  'c4000000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('6', 64), repeat('7', 64), repeat('8', 64),
  repeat('9', 64), repeat('a', 64),
  'c5000000-0000-4000-8000-000000000001', repeat('b', 64),
  'Free reward customer', null, null, '',
  jsonb_build_array(jsonb_build_object(
    'product_id', 'c7000000-0000-4000-8000-000000000001',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', '[]'::jsonb
  )),
  repeat('c', 64), repeat('d', 64), 'free-reward-order', false,
  null, (select (draw_response->>'drawId')::uuid from pg_temp.free_reward_result)
);

select is(
  (select order_response->>'ok' from pg_temp.free_reward_result),
  'true',
  'the qualifying order and free reward commit together'
);
select is(
  (
    select subtotal from public.orders
    where id = 'c4000000-0000-4000-8000-000000000001'
  ),
  700,
  'the zero-price gift does not change the server-priced order subtotal'
);
select is(
  (
    select count(*)::integer from public.order_items
    where order_id = 'c4000000-0000-4000-8000-000000000001'
  ),
  2,
  'the ordered product and the free gift are both visible to downstream order consumers'
);
select is(
  (
    select promotion_source || '|' || unit_price::text || '|'
      || base_unit_price::text || '|' || quantity::text
    from public.order_items
    where order_id = 'c4000000-0000-4000-8000-000000000001'
      and lottery_draw_id is not null
  ),
  'LOTTERY_FREE_PRODUCT|0|700|1',
  'the reward line preserves its real price and trusted zero-price provenance'
);
select is(
  (select order_response #>> '{order,lottery_reward,product_id}'
   from pg_temp.free_reward_result),
  'c7000000-0000-4000-8000-000000000001',
  'the order response confirms the exact free product granted'
);
select is(
  (
    select redeemed_order_id from public.public_lottery_draws
    where id = (
      select (draw_response->>'drawId')::uuid from pg_temp.free_reward_result
    )
  ),
  'c4000000-0000-4000-8000-000000000001'::uuid,
  'the draw can only be redeemed by the committed order'
);

select * from finish();
rollback;
