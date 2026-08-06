begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select ok(
  exists (
    select 1
    from pg_type type
    join pg_namespace namespace on namespace.oid = type.typnamespace
    where namespace.nspname = 'public' and type.typname = 'product_kind'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'kind'
  ),
  '商品主檔具備 SINGLE/BUNDLE 種類'
);

select is(
  (
    select count(*)::integer
    from public.products
    where id = any (array[
      '44444444-4444-4444-8444-444444444441'::uuid,
      '44444444-4444-4444-8444-444444444442'::uuid,
      '44444444-4444-4444-8444-444444444443'::uuid,
      '44444444-4444-4444-8444-444444444444'::uuid
    ]) and kind = 'SINGLE'::public.product_kind
  ),
  4,
  '既有商品安全回填為一般商品'
);

select ok(
  (
    select count(*) = 2 and bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class
    where oid = any (array[
      'public.product_bundle_choice_groups'::regclass,
      'public.product_bundle_choices'::regclass
    ])
  ),
  '套餐資料表全部啟用並強制套用 RLS'
);

select ok(
  not has_table_privilege('anon', 'public.product_bundle_choice_groups', 'SELECT')
    and not has_table_privilege('anon', 'public.product_bundle_choices', 'SELECT'),
  '匿名角色不可直接讀取套餐主檔'
);

select ok(
  has_table_privilege('authenticated', 'public.product_bundle_choice_groups', 'SELECT')
    and has_table_privilege('authenticated', 'public.product_bundle_choices', 'SELECT')
    and not has_table_privilege('authenticated', 'public.product_bundle_choice_groups', 'INSERT')
    and not has_table_privilege('authenticated', 'public.product_bundle_choices', 'UPDATE'),
  '登入角色只能透過 RLS 讀取套餐主檔，寫入必須經受信任後端'
);

select ok(
  has_table_privilege('service_role', 'public.product_bundle_choice_groups', 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', 'public.product_bundle_choices', 'SELECT,INSERT,UPDATE,DELETE'),
  '受信任服務角色具備套餐管理所需最小權限'
);

insert into public.products (
  id, organization_id, category_id, name, description, default_price,
  kind, is_active, sort_order, updated_at
) values (
  'ab000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '77777777-7777-4777-8777-777777777771',
  '資料庫測試套餐',
  '',
  180,
  'BUNDLE',
  true,
  90,
  now()
), (
  'ab000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '77777777-7777-4777-8777-777777777771',
  '資料庫巢狀套餐',
  '',
  220,
  'BUNDLE',
  true,
  91,
  now()
);

insert into public.product_bundle_choice_groups (
  id, organization_id, bundle_product_id, name,
  min_selections, max_selections, sort_order
) values (
  'ab100000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'ab000000-0000-4000-8000-000000000001',
  '選一份主餐',
  1,
  1,
  1
);

insert into public.product_bundle_choices (
  id, organization_id, choice_group_id, component_product_id,
  quantity, price_delta, is_enabled, sort_order
) values (
  'ab200000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'ab100000-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444441',
  1,
  20,
  true,
  1
);

select is(
  (
    select bundle.default_price + choice.price_delta
    from public.products bundle
    join public.product_bundle_choice_groups choice_group on choice_group.bundle_product_id = bundle.id
    join public.product_bundle_choices choice on choice.choice_group_id = choice_group.id
    where bundle.id = 'ab000000-0000-4000-8000-000000000001'
  ),
  200,
  '套餐組合價保存在商品預設價，選項只保存可信價差'
);

select throws_ok(
  $$insert into public.product_bundle_choice_groups (
      organization_id, bundle_product_id, name, min_selections, max_selections, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444442',
      '一般商品不可有套餐群組', 1, 1, 2
    )$$,
  'P0001',
  'PRODUCT_BUNDLE_PARENT_MUST_BE_BUNDLE',
  '資料庫拒絕在一般商品下建立套餐群組'
);

select throws_ok(
  $$insert into public.product_bundle_choices (
      organization_id, choice_group_id, component_product_id,
      quantity, price_delta, is_enabled, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ab100000-0000-4000-8000-000000000001',
      'ab000000-0000-4000-8000-000000000002',
      1, 0, true, 2
    )$$,
  'P0001',
  'PRODUCT_BUNDLE_NESTING_NOT_ALLOWED',
  '資料庫拒絕套餐巢狀加入另一個套餐'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  'ab900000-0000-4000-8000-000000000001',
  '套餐跨組織測試',
  'bundle-scope-test',
  '套餐跨組織測試',
  'ACTIVE',
  'bundle-scope@stallorder.test',
  '0900-000-121',
  now()
);

insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  'ab910000-0000-4000-8000-000000000001',
  'ab900000-0000-4000-8000-000000000001',
  id,
  'ACTIVE',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';

insert into public.product_categories (
  id, organization_id, name, sort_order, is_active, updated_at
) values (
  'ab920000-0000-4000-8000-000000000001',
  'ab900000-0000-4000-8000-000000000001',
  '其他組織分類',
  1,
  true,
  now()
);

insert into public.products (
  id, organization_id, category_id, name, description, default_price,
  kind, is_active, sort_order, updated_at
) values (
  'ab930000-0000-4000-8000-000000000001',
  'ab900000-0000-4000-8000-000000000001',
  'ab920000-0000-4000-8000-000000000001',
  '其他組織一般商品',
  '',
  50,
  'SINGLE',
  true,
  1,
  now()
), (
  'ab930000-0000-4000-8000-000000000002',
  'ab900000-0000-4000-8000-000000000001',
  'ab920000-0000-4000-8000-000000000001',
  '其他組織套餐',
  '',
  100,
  'BUNDLE',
  true,
  2,
  now()
);

insert into public.product_bundle_choice_groups (
  id, organization_id, bundle_product_id, name,
  min_selections, max_selections, sort_order
) values (
  'ab940000-0000-4000-8000-000000000001',
  'ab900000-0000-4000-8000-000000000001',
  'ab930000-0000-4000-8000-000000000002',
  '其他組織群組',
  1,
  1,
  1
);

insert into public.product_bundle_choices (
  id, organization_id, choice_group_id, component_product_id,
  quantity, price_delta, is_enabled, sort_order
) values (
  'ab950000-0000-4000-8000-000000000001',
  'ab900000-0000-4000-8000-000000000001',
  'ab940000-0000-4000-8000-000000000001',
  'ab930000-0000-4000-8000-000000000001',
  1,
  0,
  true,
  1
);

select throws_ok(
  $$insert into public.product_bundle_choices (
      organization_id, choice_group_id, component_product_id,
      quantity, price_delta, is_enabled, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ab100000-0000-4000-8000-000000000001',
      'ab930000-0000-4000-8000-000000000001',
      1, 0, true, 3
    )$$,
  'P0001',
  'PRODUCT_BUNDLE_COMPONENT_SCOPE_MISMATCH',
  '資料庫拒絕跨組織套餐組件'
);

select throws_ok(
  $$insert into public.product_bundle_choices (
      organization_id, choice_group_id, component_product_id,
      quantity, price_delta, is_enabled, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ab100000-0000-4000-8000-000000000001',
      '44444444-4444-4444-8444-444444444441',
      2, 0, true, 4
    )$$,
  '23505',
  null,
  '同一群組不可重複加入同一商品'
);

select throws_ok(
  $$insert into public.product_bundle_choice_groups (
      organization_id, bundle_product_id, name, min_selections, max_selections, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ab000000-0000-4000-8000-000000000001',
      '錯誤上下限', 2, 1, 2
    )$$,
  '23514',
  null,
  '資料庫拒絕最少選擇數大於最多選擇數'
);

select throws_ok(
  $$update public.products
    set kind = 'BUNDLE'
    where id = '44444444-4444-4444-8444-444444444441'$$,
  'P0001',
  'PRODUCT_BUNDLE_NESTING_NOT_ALLOWED',
  '已被套餐使用的一般商品不可再改成套餐'
);

select throws_ok(
  $$update public.products
    set kind = 'SINGLE'
    where id = 'ab000000-0000-4000-8000-000000000001'$$,
  'P0001',
  'PRODUCT_BUNDLE_GROUPS_MUST_BE_REMOVED',
  '仍有選擇群組的套餐不可改成一般商品'
);

insert into auth.users (id, email) values (
  'ab990000-0000-4000-8000-000000000001',
  'bundle-owner-rls@stallorder.test'
);
update public.profiles
set auth_user_id = 'ab990000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ab990000-0000-4000-8000-000000000001', true);

select is(
  (
    select count(*)::integer
    from public.product_bundle_choice_groups
    where id = any (array[
      'ab100000-0000-4000-8000-000000000001'::uuid,
      'ab940000-0000-4000-8000-000000000001'::uuid
    ])
  ),
  1,
  'RLS 只允許組織成員讀取自己組織的套餐群組'
);

select is(
  (
    select count(*)::integer
    from public.product_bundle_choices
    where id = any (array[
      'ab200000-0000-4000-8000-000000000001'::uuid,
      'ab950000-0000-4000-8000-000000000001'::uuid
    ])
  ),
  1,
  'RLS 只允許組織成員讀取自己組織的套餐選項'
);

select * from finish();
rollback;
