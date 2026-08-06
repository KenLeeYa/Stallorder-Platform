begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

delete from public.public_order_attempts;
delete from public.public_rate_limit_buckets;
delete from public.order_sessions;
delete from public.orders;
delete from public.stall_order_counters;

select is(
  public.effective_stall_product_price(
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444441'
  ),
  95,
  '攤位未覆寫價格時使用組織商品預設價'
);

update public.stall_products
set price_override = 88
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';
select is(
  public.effective_stall_product_price(
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444441'
  ),
  88,
  '攤位價格覆寫優先於商品預設價'
);

update public.stall_products
set is_sold_out = true
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';
select is(
  public.effective_stall_product_price(
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444441'
  ),
  null::integer,
  '售罄商品不提供有效售價'
);
update public.stall_products
set is_sold_out = false
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '82222222-2222-4222-8222-222222222223',
  '11111111-1111-4111-8111-111111111111',
  '共用商品第二攤',
  'shared-product-stall-two',
  'SHARED-02',
  '台北市測試路二號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);
insert into public.stall_products (
  organization_id, stall_id, product_id, is_enabled, is_sold_out, sort_order
) values (
  '11111111-1111-4111-8111-111111111111',
  '82222222-2222-4222-8222-222222222223',
  '44444444-4444-4444-8444-444444444441',
  true,
  false,
  1
);
select is(
  (
    select count(*)::integer
    from public.stall_products
    where product_id = '44444444-4444-4444-8444-444444444441'
  ),
  2,
  '同一組織商品可分派到多個攤位'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91111111-1111-4111-8111-111111111112',
  '其他商品組織',
  'other-catalog-organization',
  '其他商品組織',
  'ACTIVE',
  'other-catalog@stallorder.test',
  '0900-888-888',
  now()
);
insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  '93333333-3333-4333-8333-333333333334',
  '91111111-1111-4111-8111-111111111112', id, 'ACTIVE',
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '92222222-2222-4222-8222-222222222223',
  '91111111-1111-4111-8111-111111111112',
  '其他商品攤位',
  'other-catalog-stall',
  'OTHER-CAT-01',
  '高雄市測試路一號',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now()
);
select throws_ok(
  $$insert into public.stall_products (
      organization_id, stall_id, product_id, is_enabled, is_sold_out, sort_order
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '92222222-2222-4222-8222-222222222223',
      '44444444-4444-4444-8444-444444444441',
      true, false, 1
    )$$,
  '23503',
  null,
  '跨組織攤位商品分派由複合外鍵拒絕'
);

insert into public.order_sessions (
  id, tenant_id, organization_id, stall_id, qr_code_id, token_hash,
  device_hash, ip_hash, status, expires_at, created_at
) values (
  '70000000-0000-4000-8000-000000000011',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  encode(extensions.digest('shared-price-session', 'sha256'), 'hex'),
  encode(extensions.digest('shared-price-device', 'sha256'), 'hex'),
  encode(extensions.digest('shared-price-ip', 'sha256'), 'hex'),
  'ACTIVE',
  now() + interval '10 minutes',
  now()
);
select public.create_public_order(
  '70000000-0000-4000-8000-000000000012',
  'demo-aming-chicken-qr-2026-rotate-me',
  encode(extensions.digest('shared-price-session', 'sha256'), 'hex'),
  encode(extensions.digest('shared-price-device', 'sha256'), 'hex'),
  encode(extensions.digest('shared-price-ip', 'sha256'), 'hex'),
  'shared-qr-hash',
  'shared-behavior-hash',
  '71000000-0000-4000-8000-000000000012',
  'shared-idempotency-hash',
  '共用商品測試',
  '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444441',
    'quantity', 2,
    'note', ''
  )),
  encode(extensions.digest('shared-tracking', 'sha256'), 'hex'),
  encode(extensions.digest('shared-pickup', 'sha256'), 'hex'),
  'shared-product-request'
);
select is(
  (select total from public.orders where id = '70000000-0000-4000-8000-000000000012'),
  176,
  '可信建單函式以攤位覆寫價計算訂單總額'
);
select is(
  (select unit_price from public.order_items where order_id = '70000000-0000-4000-8000-000000000012'),
  88,
  '訂單明細保留有效成交單價快照'
);

update public.products
set default_price = 120
where id = '44444444-4444-4444-8444-444444444441';
select is(
  (select unit_price from public.order_items where order_id = '70000000-0000-4000-8000-000000000012'),
  88,
  '後續商品調價不改寫歷史訂單單價'
);

insert into public.product_categories (
  id, organization_id, name, sort_order, is_active, updated_at
) values (
  '97777777-7777-4777-8777-777777777771',
  '91111111-1111-4111-8111-111111111112',
  '其他分類',
  1,
  true,
  now()
);
insert into public.products (
  id, organization_id, category_id, name, description, default_price,
  is_active, sort_order, updated_at
) values (
  '94444444-4444-4444-8444-444444444441',
  '91111111-1111-4111-8111-111111111112',
  '97777777-7777-4777-8777-777777777771',
  '其他商品',
  '',
  50,
  true,
  1,
  now()
);
insert into auth.users (id, email) values (
  'a1111111-1111-4111-8111-111111111112',
  'catalog-owner-rls@stallorder.test'
);
update public.profiles
set auth_user_id = 'a1111111-1111-4111-8111-111111111112'
where id = '55555555-5555-4555-8555-555555555551';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111112', true);
select ok(
  exists (
    select 1
    from public.products
    where id = '44444444-4444-4444-8444-444444444441'
  )
  and not exists (
    select 1
    from public.products
    where id = '94444444-4444-4444-8444-444444444441'
  ),
  'RLS 只允許組織擁有者讀取自己組織的商品主檔'
);

select * from finish();
rollback;
