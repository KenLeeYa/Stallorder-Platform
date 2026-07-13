-- Local development data only. Production environments must not apply this seed.
insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'StallOrder 示範商戶',
  'stallorder-demo',
  'StallOrder 示範商戶',
  'ACTIVE',
  'owner@stallorder.test',
  '0900-000-001',
  'Asia/Taipei',
  'TWD',
  now(),
  now()
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '阿明鹽酥雞',
  'aming-chicken',
  'AMING-01',
  '台北市饒河街觀光夜市',
  'TWD',
  'Asia/Taipei',
  true,
  'OPEN',
  true,
  now(),
  now()
);

insert into public.stall_ordering_settings (
  stall_id, organization_id, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  now(),
  now()
);

insert into public.qr_codes (
  id, organization_id, stall_id, token, label, state, token_version,
  created_at, updated_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'demo-aming-chicken-qr-2026-rotate-me',
  '主要點餐 QR Code',
  'ACTIVE',
  1,
  now(),
  now()
);

insert into public.product_categories (
  id, organization_id, name, sort_order, is_active, created_at, updated_at
) values
  ('77777777-7777-4777-8777-777777777771', '11111111-1111-4111-8111-111111111111', '炸物', 1, true, now(), now()),
  ('77777777-7777-4777-8777-777777777772', '11111111-1111-4111-8111-111111111111', '飲料', 2, true, now(), now());

insert into public.product_groups (
  id, organization_id, category_id, name, sort_order, is_active, created_at, updated_at
) values
  ('88888888-8888-4888-8888-888888888881', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '人氣炸物', 1, true, now(), now()),
  ('88888888-8888-4888-8888-888888888882', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', '清涼飲品', 1, true, now(), now());

insert into public.products (
  id, organization_id, category_id, group_id, name, description, default_price,
  is_active, sort_order, created_at, updated_at
) values
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '香酥雞排', '現炸雞排，灑上胡椒鹽。', 95, true, 1, now(), now()),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '地瓜薯條', '金黃酥脆，適合一起分享。', 55, true, 2, now(), now()),
  ('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '台式鹽酥雞', '一口大小的鹽酥雞，搭配九層塔。', 75, true, 3, now(), now()),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', '88888888-8888-4888-8888-888888888882', '冬瓜茶', '冰涼古早味冬瓜茶。', 35, true, 4, now(), now());

insert into public.stall_products (
  organization_id, stall_id, product_id, price_override, is_enabled,
  is_sold_out, sort_order, created_at, updated_at
)
select
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  id,
  null,
  true,
  false,
  sort_order,
  now(),
  now()
from public.products
where organization_id = '11111111-1111-4111-8111-111111111111';

insert into public.profiles (
  id, email, password_hash, display_name, is_active, created_at, updated_at
) values
  ('55555555-5555-4555-8555-555555555551', 'owner@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範商戶擁有者', true, now(), now()),
  ('55555555-5555-4555-8555-555555555552', 'staff@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範店員', true, now(), now()),
  ('55555555-5555-4555-8555-555555555553', 'kitchen@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範廚房', true, now(), now());

insert into public.organization_memberships (
  id, organization_id, profile_id, role, all_stalls, is_active, created_at, updated_at
) values (
  '66666666-6666-4666-8666-666666666661',
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555551',
  'ORGANIZATION_OWNER',
  true,
  true,
  now(),
  now()
);

insert into public.stall_memberships (
  id, organization_id, profile_id, stall_id, role, is_active, created_at, updated_at
) values
  ('66666666-6666-4666-8666-666666666662', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555552', '22222222-2222-4222-8222-222222222222', 'STAFF', true, now(), now()),
  ('66666666-6666-4666-8666-666666666663', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555553', '22222222-2222-4222-8222-222222222222', 'KITCHEN', true, now(), now());
