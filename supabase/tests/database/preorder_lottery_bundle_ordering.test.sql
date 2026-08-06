begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(67);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;
delete from public.stall_lottery_discount_chances
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stall_ordering_settings
set takeout_preorder_enabled = true,
    preorder_min_lead_minutes = 15,
    preorder_max_days = 2,
    preorder_slot_minutes = 15,
    lottery_enabled = true,
    lottery_discount_option_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    lottery_discount_win_rate_bps = 10000
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
    ordering_enabled = true,
    business_status = 'OPEN',
    ordering_state = 'OPEN'
where id = '22222222-2222-4222-8222-222222222222';

update public.products product
set is_lottery_eligible = false
from public.stall_products assignment
where assignment.product_id = product.id
  and assignment.stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.products (
  id, organization_id, category_id, group_id, name, description,
  default_price, kind, is_active, sort_order
) values (
  'b1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '77777777-7777-4777-8777-777777777771',
  '88888888-8888-4888-8888-888888888881',
  'QA Bundle', 'Server-priced bundle fixture', 100, 'BUNDLE', true, 99
);

insert into public.product_bundle_choice_groups (
  id, organization_id, bundle_product_id, name,
  min_selections, max_selections, sort_order
) values (
  'b2000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'b1000000-0000-4000-8000-000000000001',
  'Main', 1, 1, 1
);

insert into public.product_bundle_choices (
  id, organization_id, choice_group_id, component_product_id,
  quantity, price_delta, is_enabled, sort_order
) values (
  'b3000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'b2000000-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444441',
  2, 20, true, 1
), (
  'b3000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'b2000000-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444442',
  1, 30, true, 2
);

insert into public.product_categories (
  id, organization_id, name, sort_order, is_active, updated_at
) values (
  'b6000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'Inactive component QA', 100, true, now()
);

insert into public.products (
  id, organization_id, category_id, group_id, name, description,
  default_price, kind, is_active, sort_order
) values (
  'b7000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'b6000000-0000-4000-8000-000000000001',
  null,
  'Hidden component', 'Previously visible component fixture',
  20, 'SINGLE', true, 100
);

select is(
  (
    select is_lottery_eligible
    from public.products
    where id = 'b7000000-0000-4000-8000-000000000001'
  ),
  true,
  'new products participate in lottery recommendations by default'
);

insert into public.product_bundle_choices (
  id, organization_id, choice_group_id, component_product_id,
  quantity, price_delta, is_enabled, sort_order
) values (
  'b8000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'b2000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  1, -80, true, 2
);

insert into public.stall_products (
  organization_id, stall_id, product_id, price_override,
  is_enabled, is_sold_out, sort_order
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'b1000000-0000-4000-8000-000000000001',
  null, true, false, 99
), (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'b7000000-0000-4000-8000-000000000001',
  null, true, false, 100
);

create temporary table pg_temp.experience_values (
  slot timestamptz,
  draw_id uuid,
  default_order_result jsonb,
  preorder_order_result jsonb
) on commit drop;

insert into pg_temp.experience_values default values;

-- Lottery remains available only for a live DEFAULT takeaway session.
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('a', 64), repeat('i', 64), repeat('d', 64),
    repeat('q', 64), repeat('b', 64), 'default-session-1', 'DEFAULT'
  )->>'ok',
  'true',
  'a live DEFAULT takeaway session can be issued'
);
select is(
  (select ordering_mode from public.order_sessions where token_hash = repeat('a', 64)),
  'DEFAULT',
  'the live session persists the DEFAULT mode'
);

update pg_temp.experience_values
set draw_id = (
  public.draw_public_lottery(repeat('a', 64), repeat('d', 64))->>'drawId'
)::uuid;

select ok(
  (select draw_id is not null from pg_temp.experience_values),
  'the server issues a lottery draw for a live DEFAULT takeaway session'
);
select is(
  (
    select product.kind::text
    from public.public_lottery_draws draw
    join public.products product on product.id = draw.selected_product_id
    where draw.id = (select draw_id from pg_temp.experience_values)
  ),
  'SINGLE',
  'lottery recommendations only draw directly orderable single products'
);
select is(
  (
    select selected_product_id
    from public.public_lottery_draws
    where id = (select draw_id from pg_temp.experience_values)
  ),
  'b7000000-0000-4000-8000-000000000001'::uuid,
  'lottery recommendations exclude products whose eligibility is disabled'
);
select ok(
  strpos(
    pg_get_functiondef('public.draw_public_lottery(text,text)'::regprocedure),
    'exit when v_random_value < 60000'
  ) > 0
  and strpos(
    pg_get_functiondef('public.draw_public_lottery(text,text)'::regprocedure),
    'v_bucket := v_random_value % 10000'
  ) > 0,
  'lottery odds retain rejection sampling before the modulo bucket'
);
select is(
  (
    select discount_rate_bps
    from public.public_lottery_draws
    where id = (select draw_id from pg_temp.experience_values)
  ),
  9000,
  'a 100 percent win-rate draw snapshots the configured existing discount'
);
select is(
  (
    select business_date
    from public.public_lottery_draws
    where id = (select draw_id from pg_temp.experience_values)
  ),
  app_private.stall_business_date(
    '22222222-2222-4222-8222-222222222222', now()
  ),
  'lottery daily uniqueness follows the stall business-day cutoff'
);
select is(
  public.draw_public_lottery(repeat('a', 64), repeat('d', 64))->>'drawId',
  (select draw_id::text from pg_temp.experience_values),
  'repeating a DEFAULT draw returns the same daily result'
);
select ok(
  exists (
    select 1 from public.public_rate_limit_buckets
    where dimension_type = 'LOTTERY_IP'
  ),
  'new draws consume a trusted session-IP lottery rate-limit bucket'
);

update public.product_categories
set is_active = false
where id = 'b6000000-0000-4000-8000-000000000001'
  and organization_id = '11111111-1111-4111-8111-111111111111';

select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000005',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('a', 64), repeat('d', 64), repeat('i', 64),
    repeat('q', 64), repeat('b', 64),
    'b5000000-0000-4000-8000-000000000005', repeat('g', 64),
    'Hidden component customer', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'b8000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('8', 64), repeat('9', 64), 'inactive-component-category', false,
    null, null
  )->>'code',
  'INVALID_PRODUCT_BUNDLE',
  'a stale choice UUID cannot order a component from an inactive category'
);
select is(
  (select status::text from public.order_sessions where token_hash = repeat('a', 64)),
  'ACTIVE',
  'rejecting an inactive component category leaves the session reusable'
);

update pg_temp.experience_values
set default_order_result = public.create_public_order_with_experience(
  'b4000000-0000-4000-8000-000000000001',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('a', 64), repeat('d', 64), repeat('i', 64),
  repeat('q', 64), repeat('b', 64),
  'b5000000-0000-4000-8000-000000000001', repeat('e', 64),
  'Default bundle customer', '',
  jsonb_build_array(jsonb_build_object(
    'product_id', 'b1000000-0000-4000-8000-000000000001',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', jsonb_build_array(
      'b3000000-0000-4000-8000-000000000001'
    )
  )),
  repeat('t', 64), repeat('p', 64), 'default-order-1', false,
  null, (select draw_id from pg_temp.experience_values)
);

select is(
  (select default_order_result->>'ok' from pg_temp.experience_values),
  'true',
  'a valid configured bundle can be submitted in live DEFAULT mode'
);
select is(
  (select (default_order_result #>> '{order,total_amount}')::integer from pg_temp.experience_values),
  108,
  'the DEFAULT response applies the trusted bundle delta and 90 percent lottery discount'
);
select is(
  (select subtotal from public.orders where id = 'b4000000-0000-4000-8000-000000000001'),
  120,
  'the DEFAULT order stores the trusted parent price plus bundle choice delta'
);
select is(
  (select discount_amount from public.orders where id = 'b4000000-0000-4000-8000-000000000001'),
  12,
  'the lottery discount is calculated from the server-priced bundle subtotal'
);
select is(
  (
    select (metadata::jsonb->>'total')::integer
    from public.audit_logs
    where entity_type = 'ORDER'
      and entity_id = 'b4000000-0000-4000-8000-000000000001'
      and action = 'PUBLIC_ORDER_CREATED'
  ),
  108,
  'the creation audit stores the final bundle and lottery-adjusted total'
);
select is(
  (select unit_price from public.order_items where order_id = 'b4000000-0000-4000-8000-000000000001'),
  120,
  'the DEFAULT order item stores the server-priced bundle unit price'
);
select ok(
  exists (
    select 1
    from public.order_item_note_options option_snapshot
    join public.order_items item on item.id = option_snapshot.order_item_id
    where item.order_id = 'b4000000-0000-4000-8000-000000000001'
      and option_snapshot.note_group_id is null
      and option_snapshot.price_delta = 20
  ),
  'the selected bundle component is snapshotted for order and KDS display'
);
select is(
  (select status::text from public.order_sessions where token_hash = repeat('a', 64)),
  'CONSUMED',
  'a successful DEFAULT order consumes its security session'
);
select throws_ok(
  $$
    update public.orders
    set device_hash = repeat('z', 64)
    where id = 'b4000000-0000-4000-8000-000000000001'
  $$,
  'P0001',
  'LOTTERY_ORDER_SCOPE_MISMATCH',
  'an order cannot be reassigned across the lottery draw device scope'
);

-- One product may appear as independent lines when its trusted configuration
-- differs. Line ordinals keep each price and KDS snapshot attached correctly.
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ab', 32), repeat('ac', 32), repeat('ad', 32),
    repeat('ae', 32), repeat('af', 32), 'variant-session-1', 'DEFAULT'
  )->>'ok',
  'true',
  'a session is issued for a two-variant bundle order'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000010',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ab', 32), repeat('ad', 32), repeat('ac', 32),
    repeat('ae', 32), repeat('af', 32),
    'b5000000-0000-4000-8000-000000000010', repeat('ag', 32),
    'Variant bundle customer', '',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', 'b1000000-0000-4000-8000-000000000001',
        'quantity', 1,
        'note', '',
        'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array(
          'b3000000-0000-4000-8000-000000000001'
        )
      ),
      jsonb_build_object(
        'product_id', 'b1000000-0000-4000-8000-000000000001',
        'quantity', 1,
        'note', '',
        'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array(
          'b3000000-0000-4000-8000-000000000002'
        )
      )
    ),
    repeat('ah', 32), repeat('ai', 32), 'variant-order-1', false,
    null, null
  )->>'ok',
  'true',
  'the same product with two bundle configurations creates one order'
);
select is(
  (select count(*)::integer from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000010'),
  2,
  'the two variants persist as two order items'
);
select is(
  (select subtotal from public.orders
   where id = 'b4000000-0000-4000-8000-000000000010'),
  250,
  'the order subtotal sums each independently priced variant'
);
select is(
  (select unit_price from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000010'
     and source_line_index = 1),
  120,
  'the first source line stores its own bundle price'
);
select is(
  (select unit_price from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000010'
     and source_line_index = 2),
  130,
  'the second source line stores its own bundle price'
);
select is(
  (
    select sum(snapshot.price_delta)::integer
    from public.order_item_note_options snapshot
    join public.order_items item on item.id = snapshot.order_item_id
    where item.order_id = 'b4000000-0000-4000-8000-000000000010'
      and item.source_line_index = 1
  ),
  20,
  'the first source line keeps only its own bundle snapshot'
);
select is(
  (
    select sum(snapshot.price_delta)::integer
    from public.order_item_note_options snapshot
    join public.order_items item on item.id = snapshot.order_item_id
    where item.order_id = 'b4000000-0000-4000-8000-000000000010'
      and item.source_line_index = 2
  ),
  30,
  'the second source line keeps only its own bundle snapshot'
);

update public.stall_ordering_settings
set max_item_quantity = 3
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ba', 32), repeat('bc', 32), repeat('bd', 32),
    repeat('be', 32), repeat('bf', 32), 'variant-limits-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a session is issued for duplicate and aggregate limit checks'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000011',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ba', 32), repeat('bd', 32), repeat('bc', 32),
    repeat('be', 32), repeat('bf', 32),
    'b5000000-0000-4000-8000-000000000011', repeat('bg', 32),
    'Duplicate lines', '',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', 'b1000000-0000-4000-8000-000000000001',
        'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array('b3000000-0000-4000-8000-000000000001')
      ),
      jsonb_build_object(
        'product_id', 'B1000000-0000-4000-8000-000000000001',
        'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array('B3000000-0000-4000-8000-000000000001')
      )
    ),
    repeat('bh', 32), repeat('bi', 32), 'duplicate-lines', false,
    null, null
  )->>'code',
  'TOO_MANY_OR_DUPLICATE_PRODUCTS',
  'canonical duplicate lines are rejected instead of expanding line count'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000014',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ba', 32), repeat('bd', 32), repeat('bc', 32),
    repeat('be', 32), repeat('bf', 32),
    'b5000000-0000-4000-8000-000000000014', repeat('bm', 32),
    'Mixed-case note duplicate', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441',
      'quantity', 1, 'note', '',
      'modifier_option_ids', jsonb_build_array(
        'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
        'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDD5'
      ),
      'bundle_choice_ids', '[]'::jsonb
    )),
    repeat('bn', 32), repeat('bo', 32), 'mixed-case-note-duplicate', false,
    null, null
  )->>'code',
  'INVALID_PRODUCT_NOTES',
  'mixed-case duplicate note UUIDs are rejected before trusted pricing'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000016',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ba', 32), repeat('bd', 32), repeat('bc', 32),
    repeat('be', 32), repeat('bf', 32),
    'b5000000-0000-4000-8000-000000000016', repeat('bp', 32),
    'Mixed-case bundle duplicate', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'b3000000-0000-4000-8000-000000000001',
        'B3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('bq', 32), repeat('br', 32), 'mixed-case-bundle-duplicate', false,
    null, null
  )->>'code',
  'INVALID_PRODUCT_BUNDLE',
  'mixed-case duplicate bundle UUIDs are rejected before trusted pricing'
);
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('da', 32), repeat('db', 32), repeat('dc', 32),
    repeat('dd', 32), repeat('de', 32), 'uppercase-bundle-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a session is issued for a legitimate uppercase UUID bundle order'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000017',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('da', 32), repeat('dc', 32), repeat('db', 32),
    repeat('dd', 32), repeat('de', 32),
    'b5000000-0000-4000-8000-000000000017', repeat('df', 32),
    'Uppercase bundle UUID', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'B1000000-0000-4000-8000-000000000001',
      'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'B3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('dg', 32), repeat('dh', 32), 'uppercase-bundle-order', false,
    null, null
  )->>'ok',
  'true',
  'a legitimate uppercase UUID bundle is resolved by UUID identity'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000012',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ba', 32), repeat('bd', 32), repeat('bc', 32),
    repeat('be', 32), repeat('bf', 32),
    'b5000000-0000-4000-8000-000000000012', repeat('bj', 32),
    'Aggregate product limit', '',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', 'b1000000-0000-4000-8000-000000000001',
        'quantity', 2, 'note', '', 'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array('b3000000-0000-4000-8000-000000000001')
      ),
      jsonb_build_object(
        'product_id', 'b1000000-0000-4000-8000-000000000001',
        'quantity', 2, 'note', '', 'modifier_option_ids', '[]'::jsonb,
        'bundle_choice_ids', jsonb_build_array('b3000000-0000-4000-8000-000000000002')
      )
    ),
    repeat('bk', 32), repeat('bl', 32), 'aggregate-product-limit', false,
    null, null
  )->>'code',
  'EXCESSIVE_ITEM_QUANTITY',
  'splitting variants cannot bypass the aggregate per-product quantity limit'
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ca', 32), repeat('cc', 32), repeat('cd', 32),
    repeat('ce', 32), repeat('cf', 32), 'note-variant-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a session is issued for two note variants of one product'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000013',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('ca', 32), repeat('cd', 32), repeat('cc', 32),
    repeat('ce', 32), repeat('cf', 32),
    'b5000000-0000-4000-8000-000000000013', repeat('cg', 32),
    'Note variant customer', '',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', '44444444-4444-4444-8444-444444444441',
        'quantity', 1, 'note', '',
        'modifier_option_ids', jsonb_build_array('dddddddd-dddd-4ddd-8ddd-ddddddddddd5'),
        'bundle_choice_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'product_id', '44444444-4444-4444-8444-444444444441',
        'quantity', 1, 'note', '',
        'modifier_option_ids', jsonb_build_array('dddddddd-dddd-4ddd-8ddd-ddddddddddd6'),
        'bundle_choice_ids', '[]'::jsonb
      )
    ),
    repeat('ch', 32), repeat('ci', 32), 'note-variant-order', false,
    null, null
  )->>'ok',
  'true',
  'the same product with two note selections creates one order'
);
select is(
  (select count(*)::integer from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000013'),
  2,
  'the two note variants persist as two order items'
);
select is(
  (select unit_price from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000013'
     and source_line_index = 1),
  110,
  'the first note variant keeps its own trusted price'
);
select is(
  (select unit_price from public.order_items
   where order_id = 'b4000000-0000-4000-8000-000000000013'
     and source_line_index = 2),
  115,
  'the second note variant keeps its own trusted price'
);
select is(
  (
    select snapshot.note_option_id
    from public.order_item_note_options snapshot
    join public.order_items item on item.id = snapshot.order_item_id
    where item.order_id = 'b4000000-0000-4000-8000-000000000013'
      and item.source_line_index = 1
  ),
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd5'::uuid,
  'the first source line snapshots only its selected note option'
);
select is(
  (
    select snapshot.note_option_id
    from public.order_item_note_options snapshot
    join public.order_items item on item.id = snapshot.order_item_id
    where item.order_id = 'b4000000-0000-4000-8000-000000000013'
      and item.source_line_index = 2
  ),
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd6'::uuid,
  'the second source line snapshots only its selected note option'
);

-- PREORDER is independent from lottery and continues to use scheduled pricing.
update public.stall_products
set available_from = now() + interval '5 minutes'
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = 'b1000000-0000-4000-8000-000000000001';
select ok(
  (
    select available_from > now()
    from public.stall_products
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and product_id = 'b1000000-0000-4000-8000-000000000001'
  ),
  'the preorder bundle fixture is not yet available at submission time'
);

update public.stalls
set ordering_enabled = false,
    business_status = 'CLOSED',
    ordering_state = 'CLOSED'
where id = '22222222-2222-4222-8222-222222222222';

update pg_temp.experience_values
set slot = (
  select value::timestamptz
  from jsonb_array_elements_text(
    public.get_takeout_preorder_slots(
      '22222222-2222-4222-8222-222222222222', now()
    )
  )
  order by value::timestamptz
  limit 1
);

select is(
  public.resolve_public_ordering_mode(
    'demo-aming-chicken-qr-2026-rotate-me', 'DEFAULT'
  ),
  'PREORDER',
  'a closed static takeaway QR resolves DEFAULT to PREORDER'
);
select ok(
  (select slot > now() from pg_temp.experience_values),
  'preorder slots are generated in the future'
);
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('h', 64), repeat('d', 64),
    repeat('q', 64), repeat('c', 64), 'preorder-session-1', 'PREORDER'
  )->>'ok',
  'true',
  'a preorder session can be issued while live ordering is closed'
);
select is(
  (select ordering_mode from public.order_sessions where token_hash = repeat('s', 64)),
  'PREORDER',
  'the issued preorder session persists the PREORDER mode'
);
select is(
  public.validate_takeout_preorder_slot(
    '22222222-2222-4222-8222-222222222222',
    (select slot from pg_temp.experience_values),
    (select created_at from public.order_sessions where token_hash = repeat('s', 64))
  ),
  null::text,
  'slot validation uses the session reference time and accepts the offered slot'
);
select is(
  public.draw_public_lottery(repeat('s', 64), repeat('d', 64))->>'code',
  'LOTTERY_UNAVAILABLE',
  'the lottery RPC rejects a PREORDER session before daily replay lookup'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000002',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('d', 64), repeat('h', 64),
    repeat('q', 64), repeat('c', 64),
    'b5000000-0000-4000-8000-000000000002', repeat('f', 64),
    'Preorder bundle customer', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'b3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('u', 64), repeat('v', 64), 'preorder-lottery-rejected', false,
    (select slot from pg_temp.experience_values),
    (select draw_id from pg_temp.experience_values)
  )->>'code',
  'LOTTERY_UNAVAILABLE',
  'the order experience RPC rejects a lottery draw for PREORDER service-role callers'
);
select is(
  (select status::text from public.order_sessions where token_hash = repeat('s', 64)),
  'ACTIVE',
  'a rejected PREORDER lottery attempt does not consume its security session'
);

update pg_temp.experience_values
set preorder_order_result = public.create_public_order_with_experience(
  'b4000000-0000-4000-8000-000000000002',
  'demo-aming-chicken-qr-2026-rotate-me',
  repeat('s', 64), repeat('d', 64), repeat('h', 64),
  repeat('q', 64), repeat('c', 64),
  'b5000000-0000-4000-8000-000000000002', repeat('f', 64),
  'Preorder bundle customer', '',
  jsonb_build_array(jsonb_build_object(
    'product_id', 'b1000000-0000-4000-8000-000000000001',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', '[]'::jsonb,
    'bundle_choice_ids', jsonb_build_array(
      'b3000000-0000-4000-8000-000000000001'
    )
  )),
  repeat('u', 64), repeat('v', 64), 'preorder-order-1', false,
  (select slot from pg_temp.experience_values), null
);

select is(
  (select preorder_order_result->>'ok' from pg_temp.experience_values),
  'true',
  'the same PREORDER session can submit a valid bundle without lottery'
);
select is(
  (select (preorder_order_result #>> '{order,total_amount}')::integer from pg_temp.experience_values),
  120,
  'the PREORDER response keeps the trusted bundle price without lottery discount'
);
select is(
  (select subtotal from public.orders where id = 'b4000000-0000-4000-8000-000000000002'),
  120,
  'the PREORDER order stores the trusted scheduled bundle subtotal'
);
select is(
  (select discount_amount from public.orders where id = 'b4000000-0000-4000-8000-000000000002'),
  0,
  'the PREORDER order stores no lottery discount'
);
select is(
  (select status::text from public.order_sessions where token_hash = repeat('s', 64)),
  'CONSUMED',
  'a successful preorder consumes its security session'
);
select is(
  (
    select confirmation_expires_at
    from public.orders
    where id = 'b4000000-0000-4000-8000-000000000002'
  ),
  (select slot::timestamp without time zone from pg_temp.experience_values),
  'an off-hours preorder stays pending for staff confirmation until pickup time'
);
select is(
  public.expire_unconfirmed_orders(),
  0,
  'the regular expiry job does not cancel a future preorder after ten minutes'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000099',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('d', 64), repeat('h', 64),
    repeat('q', 64), repeat('c', 64),
    'b5000000-0000-4000-8000-000000000002', repeat('f', 64),
    'Preorder bundle customer', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'b3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('u', 64), repeat('v', 64), 'preorder-replay', false,
    (select slot from pg_temp.experience_values), null
  )->>'idempotent_replay',
  'true',
  'an identical PREORDER retry replays the existing order'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000098',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('s', 64), repeat('d', 64), repeat('h', 64),
    repeat('q', 64), repeat('c', 64),
    'b5000000-0000-4000-8000-000000000002', repeat('f', 64),
    'Preorder bundle customer', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'modifier_option_ids', '[]'::jsonb,
      'bundle_choice_ids', jsonb_build_array(
        'b3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('u', 64), repeat('v', 64), 'preorder-replay-conflict', false,
    (select slot + interval '15 minutes' from pg_temp.experience_values), null
  )->>'code',
  'IDEMPOTENCY_CONFLICT',
  'an idempotency replay cannot change its preorder slot'
);

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('x', 64), repeat('j', 64), repeat('k', 64),
    repeat('l', 64), repeat('m', 64), 'preorder-session-2', 'PREORDER'
  )->>'ok',
  'true',
  'a second independent preorder session can be issued'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000003',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('x', 64), repeat('k', 64), repeat('j', 64),
    repeat('l', 64), repeat('m', 64),
    'b5000000-0000-4000-8000-000000000003', repeat('n', 64),
    'Invalid preorder bundle', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'bundle_choice_ids', '[]'::jsonb
    )),
    repeat('w', 64), repeat('r', 64), 'preorder-order-2', false,
    (select slot from pg_temp.experience_values), null
  )->>'code',
  'INVALID_PRODUCT_BUNDLE',
  'the database rejects a preorder bundle that does not satisfy its required group'
);

update public.stall_products
set available_until = now() + interval '5 minutes'
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';
select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('y', 64), repeat('1', 64), repeat('2', 64),
    repeat('3', 64), repeat('4', 64), 'preorder-session-3', 'PREORDER'
  )->>'ok',
  'true',
  'a third preorder session is available for component-window validation'
);
select is(
  public.create_public_order_with_experience(
    'b4000000-0000-4000-8000-000000000004',
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('y', 64), repeat('2', 64), repeat('1', 64),
    repeat('3', 64), repeat('4', 64),
    'b5000000-0000-4000-8000-000000000004', repeat('5', 64),
    'Component window preorder', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', 'b1000000-0000-4000-8000-000000000001',
      'quantity', 1,
      'note', '',
      'bundle_choice_ids', jsonb_build_array(
        'b3000000-0000-4000-8000-000000000001'
      )
    )),
    repeat('6', 64), repeat('7', 64), 'preorder-order-3', false,
    (select slot from pg_temp.experience_values), null
  )->>'code',
  'INVALID_PRODUCT_BUNDLE',
  'a bundle component unavailable at pickup time is rejected server-side'
);
select ok(
  not has_function_privilege(
    'anon', 'public.draw_public_lottery(text,text)', 'EXECUTE'
  ),
  'anonymous clients cannot call the lottery RPC directly'
);

select * from finish();
rollback;
