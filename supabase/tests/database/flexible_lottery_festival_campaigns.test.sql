begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select has_table(
  'public', 'stall_lottery_campaigns',
  'festival lottery campaigns are stored as first-class records'
);
select has_column(
  'public', 'stall_lottery_campaigns', 'product_ids',
  'each festival campaign owns an independent product pool'
);
select has_column(
  'public', 'public_lottery_draws', 'campaign_id',
  'lottery draws snapshot the selected campaign'
);
select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.public_lottery_draws'::regclass
      and conname = 'public_lottery_draws_campaign_snapshot_check'
  ) like '%campaign_id IS NULL%'
  and (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.public_lottery_draws'::regclass
      and conname = 'public_lottery_draws_campaign_snapshot_check'
  ) not like '%campaign_name IS NULL%',
  'deleting campaign configuration may clear its id while preserving the historical campaign name'
);
select has_function(
  'app_private', 'get_festival_lottery_product_pool', array['uuid', 'uuid', 'uuid'],
  'the trusted campaign-specific product pool exists'
);
select ok(
  not has_table_privilege('anon', 'public.stall_lottery_campaigns', 'SELECT'),
  'anonymous users cannot read campaign configuration directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.stall_lottery_campaigns', 'SELECT'),
  'authenticated users cannot bypass the merchant API'
);
select ok(
  has_table_privilege('service_role', 'public.stall_lottery_campaigns', 'SELECT'),
  'the trusted service role can read campaign configuration'
);
select ok(
  not has_function_privilege(
    'anon', 'app_private.get_festival_lottery_product_pool(uuid,uuid,uuid)', 'EXECUTE'
  ),
  'anonymous users cannot call the campaign product selector'
);
select ok(
  has_function_privilege(
    'service_role', 'app_private.get_festival_lottery_product_pool(uuid,uuid,uuid)', 'EXECUTE'
  ),
  'the trusted service role can call the campaign product selector'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.stall_lottery_campaigns'::regclass),
  true,
  'campaign rows have RLS enabled'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.stall_lottery_campaigns'::regclass),
  true,
  'campaign rows force RLS even for table owners'
);

delete from public.stall_lottery_campaigns
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.products
set is_active = true, kind = 'SINGLE'::public.product_kind
where id = '44444444-4444-4444-8444-444444444441';
update public.product_categories category
set is_active = true
where exists (
  select 1 from public.products product
  where product.id = '44444444-4444-4444-8444-444444444441'
    and product.category_id = category.id
);
update public.stall_products
set is_enabled = true, is_sold_out = false,
    available_from = null, available_until = null
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';

insert into public.stall_lottery_campaigns (
  id, organization_id, stall_id, name, is_enabled,
  starts_on, ends_on, product_ids, sort_order
) values (
  'c8000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Mid-Autumn QA', true, '2026-09-20', '2026-09-27',
  array['44444444-4444-4444-8444-444444444441'::uuid], 0
);

select is(
  (
    select name || '|' || cardinality(product_ids)::text
    from public.stall_lottery_campaigns
    where id = 'c8000000-0000-4000-8000-000000000001'
  ),
  'Mid-Autumn QA|1',
  'a named campaign stores its own bounded product selection'
);
select results_eq(
  $$
    select product_id::text
    from app_private.get_festival_lottery_product_pool(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'c8000000-0000-4000-8000-000000000001'
    )
  $$,
  $$ values ('44444444-4444-4444-8444-444444444441'::text) $$,
  'the server selector returns only the product assigned to this campaign'
);
select throws_ok(
  $$
    insert into public.stall_lottery_campaigns (
      id, organization_id, stall_id, name, is_enabled,
      starts_on, ends_on, product_ids, sort_order
    ) values (
      'c8000000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'Overlapping QA', true, '2026-09-27', '2026-09-30',
      array['44444444-4444-4444-8444-444444444441'::uuid], 1
    )
  $$,
  '23514',
  'LOTTERY_CAMPAIGN_DATES_OVERLAP',
  'enabled campaigns cannot overlap, including a shared boundary date'
);

insert into public.stall_lottery_campaigns (
  id, organization_id, stall_id, name, is_enabled,
  starts_on, ends_on, product_ids, sort_order
) values (
  'c8000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Disabled draft QA', false, '2026-09-25', '2026-09-30',
  '{}'::uuid[], 2
);
select is(
  (
    select count(*)::integer
    from public.stall_lottery_campaigns
    where stall_id = '22222222-2222-4222-8222-222222222222'
  ),
  2,
  'disabled draft campaigns may overlap while they are being configured'
);
select throws_ok(
  $$
    insert into public.stall_lottery_campaigns (
      id, organization_id, stall_id, name, is_enabled,
      starts_on, ends_on, product_ids, sort_order
    ) values (
      'c8000000-0000-4000-8000-000000000004',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'Empty pool QA', true, '2026-10-01', '2026-10-02', '{}'::uuid[], 3
    )
  $$,
  '23514',
  null,
  'an enabled campaign cannot be saved without a product'
);

select * from finish();
rollback;
