begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111119',
  'Lottery mismatch QA',
  'lottery-mismatch-qa',
  'Lottery mismatch QA',
  'ACTIVE',
  'lottery-mismatch@local.test',
  '0900-000-099',
  'Asia/Taipei',
  'TWD',
  now(),
  now()
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222229',
  '11111111-1111-4111-8111-111111111111',
  'Lottery scope QA',
  'lottery-scope-qa',
  'LOTTERY-QA',
  'Local test only',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now(),
  now()
);

alter table public.discount_options
  disable trigger discount_options_scope_before_write;
insert into public.discount_options (
  id, organization_id, stall_id, name, rate_bps,
  is_enabled, sort_order, created_at, updated_at
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
  '11111111-1111-4111-8111-111111111119',
  '22222222-2222-4222-8222-222222222222',
  'Cross organization fixture',
  8500,
  true,
  99,
  now(),
  now()
);
alter table public.discount_options
  enable trigger discount_options_scope_before_write;

delete from public.stall_lottery_discount_chances
where stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.stall_lottery_discount_chances (
  stall_id,
  discount_option_id,
  win_rate_bps
) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  2500
), (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  5000
);

select throws_ok(
  $$
    insert into public.stall_lottery_discount_chances (
      stall_id,
      discount_option_id,
      win_rate_bps
    ) values (
      '22222222-2222-4222-8222-222222222229',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      1000
    )
  $$,
  'P0001',
  'LOTTERY_DISCOUNT_SCOPE_MISMATCH',
  'a discount from another stall cannot be added to the prize pool'
);

select throws_ok(
  $$
    insert into public.stall_lottery_discount_chances (
      stall_id,
      discount_option_id,
      win_rate_bps
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
      1000
    )
  $$,
  'P0001',
  'LOTTERY_DISCOUNT_SCOPE_MISMATCH',
  'an organization-mismatched discount cannot enter a stall prize pool'
);

select is(
  (
    select count(*)::integer
    from public.stall_lottery_discount_chances
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  2,
  'one stall can configure multiple lottery discount chances'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 0
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'the first weighted bucket selects the first enabled discount'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 2499
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'the first discount receives its exact configured probability range'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 2500
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
  'the next bucket selects the second discount'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 7499
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
  'the second discount receives its exact configured probability range'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 7500
  ),
  null::uuid,
  'unallocated probability remains a no-discount recommendation'
);

select throws_ok(
  $$
    update public.stall_lottery_discount_chances
    set win_rate_bps = 5001
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and discount_option_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  'P0001',
  'LOTTERY_DISCOUNT_TOTAL_EXCEEDED',
  'the database rejects a combined probability above 100 percent'
);

update public.discount_options
set is_enabled = false
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 0
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
  'disabled discounts are excluded from the server-authoritative draw'
);

select is(
  app_private.pick_public_lottery_discount(
    '22222222-2222-4222-8222-222222222222', 5000
  ),
  null::uuid,
  'a disabled discount leaves the remainder as a no-discount result'
);

update public.discount_options
set is_enabled = true
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

delete from public.stall_lottery_discount_chances
where stall_id = '22222222-2222-4222-8222-222222222222'
  and discount_option_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
update public.stall_lottery_discount_chances
set win_rate_bps = 10000
where stall_id = '22222222-2222-4222-8222-222222222222'
  and discount_option_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

update public.stall_ordering_settings
set lottery_enabled = true
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

select is(
  public.issue_order_session_with_schedule(
    'demo-aming-chicken-qr-2026-rotate-me',
    repeat('1', 64), repeat('2', 64), repeat('3', 64),
    repeat('4', 64), repeat('5', 64), 'multi-lottery-session', 'DEFAULT'
  )->>'ok',
  'true',
  'a live takeaway session is issued for the weighted draw'
);

create temporary table pg_temp.multi_lottery_result (
  response jsonb
) on commit drop;
insert into pg_temp.multi_lottery_result (response)
values (public.draw_public_lottery(repeat('1', 64), repeat('3', 64)));

select is(
  (
    select draw.discount_option_id::text
    from public.public_lottery_draws draw
    where draw.id = (
      select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
    )
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'the weighted draw returns the selected configured discount'
);

select is(
  (
    select draw.discount_label || '|' || draw.discount_rate_bps::text
    from public.public_lottery_draws draw
    where draw.id = (
      select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
    )
  ),
  '9 折|9000',
  'the draw snapshots the selected discount name and rate'
);

select is(
  (
    select coalesce(draw.best_seller_rank::text, 'NULL')
      || '|' || draw.recommendation_basis
    from public.public_lottery_draws draw
    where draw.id = (
      select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
    )
  ),
  (
    select coalesce(response->>'bestSellerRank', 'NULL')
      || '|' || (response->>'recommendationBasis')
    from pg_temp.multi_lottery_result
  ),
  'a new draw persists the exact recommendation snapshot returned to the client'
);

select is(
  (
    select attnotnull
    from pg_catalog.pg_attribute
    where attrelid = 'public.public_lottery_draws'::regclass
      and attname = 'recommendation_basis'
      and not attisdropped
  ),
  false,
  'the recommendation snapshot remains expand-only without a table-wide NOT NULL scan'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid = 'public.public_lottery_draws'::regclass
      and conname in (
        'public_lottery_draws_best_seller_rank_check',
        'public_lottery_draws_recommendation_snapshot_check'
      )
      and not convalidated
  ),
  2,
  'recommendation snapshot checks avoid validating historical rows during deploy'
);

select throws_ok(
  $$
    update public.public_lottery_draws
    set best_seller_rank = 1,
        recommendation_basis = 'DISCOVERY'
    where id = (
      select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
    )
  $$,
  '23514',
  null,
  'NOT VALID snapshot constraints still reject inconsistent new writes'
);

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'drawId',
  (select response->>'drawId' from pg_temp.multi_lottery_result),
  'repeating the daily draw returns the same draw identifier'
);

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'idempotentReplay',
  'true',
  'repeating the daily draw is explicitly reported as an idempotent replay'
);

update public.public_lottery_draws
set best_seller_rank = 2,
    recommendation_basis = 'BEST_SELLER'
where id = (
  select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
);

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'bestSellerRank',
  '2',
  'a daily replay returns the best-seller rank snapshot from the original draw'
);

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'recommendationBasis',
  'BEST_SELLER',
  'a daily replay returns the recommendation-basis snapshot from the original draw'
);

alter table public.public_lottery_draws
  drop constraint public_lottery_draws_recommendation_snapshot_check;

update public.public_lottery_draws
set best_seller_rank = null,
    recommendation_basis = null
where id = (
  select (response->>'drawId')::uuid from pg_temp.multi_lottery_result
);

alter table public.public_lottery_draws
  add constraint public_lottery_draws_recommendation_snapshot_check
  check (
    recommendation_basis is not null
    and (
      (recommendation_basis = 'BEST_SELLER' and best_seller_rank is not null)
      or (recommendation_basis = 'DISCOVERY' and best_seller_rank is null)
    )
  )
  not valid;

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'recommendationBasis',
  'DISCOVERY',
  'a legacy draw without snapshot metadata replays with the safe discovery fallback'
);

select is(
  public.draw_public_lottery(repeat('1', 64), repeat('3', 64))->>'bestSellerRank',
  null,
  'a legacy discovery replay never reconstructs a historical best-seller rank'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.stall_lottery_discount_chances'::regclass
  ),
  'lottery chance rows have forced row-level security'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.stall_lottery_discount_chances',
    'SELECT'
  ),
  'anonymous clients cannot read merchant lottery configuration'
);

select ok(
  has_table_privilege(
    'authenticated',
    'public.stall_lottery_discount_chances',
    'SELECT'
  ),
  'authenticated merchant access remains governed by the stall RLS policy'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'app_private.pick_public_lottery_discount(uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the internal prize selector'
);

select ok(
  strpos(
    pg_get_functiondef('public.draw_public_lottery(text,text)'::regprocedure),
    'app_private.pick_public_lottery_discount'
  ) > 0
  and strpos(
    pg_get_functiondef('public.draw_public_lottery(text,text)'::regprocedure),
    'lottery_discount_option_id'
  ) > 0,
  'the public draw uses weighted prizes with the legacy single-prize fallback'
);

select * from finish();
rollback;
