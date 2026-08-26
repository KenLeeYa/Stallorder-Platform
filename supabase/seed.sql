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
), (
  '11111111-1111-4111-8111-111111111112',
  'StallOrder Legacy 計費測試商戶',
  'stallorder-legacy-billing-fixture',
  'StallOrder Legacy 計費測試商戶',
  'ACTIVE',
  'legacy.billing@stallorder.test',
  '0900-000-099',
  'Asia/Taipei',
  'TWD',
  now(),
  now()
);

-- Commercial limits are enforced at insert time, so the local demo
-- subscription must exist before stalls, products, QR codes, or memberships.
insert into public.subscriptions (
  organization_id, plan_id, plan_version_id, status, billing_interval,
  billing_period_start, billing_period_end, pricing_effective_at
)
select
  '11111111-1111-4111-8111-111111111111',
  plan.id,
  version.id,
  'ACTIVE',
  'MONTHLY',
  date_trunc('month', now() at time zone 'Asia/Taipei')::date,
  (date_trunc('month', now() at time zone 'Asia/Taipei') + interval '1 month')::date,
  date_trunc('month', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei'
from public.plans plan
join lateral (
  select candidate.id
  from public.plan_versions candidate
  where candidate.plan_id = plan.id
    and candidate.effective_from <= now()
    and (candidate.effective_until is null or candidate.effective_until > now())
  order by candidate.version desc
  limit 1
) version on true
where plan.code = 'PAYG';

-- Keep one explicit fixed-price fixture for legacy renewal, order-package, and
-- additional-stall regression coverage without changing the primary PAYG demo.
insert into public.subscriptions (
  organization_id, plan_id, plan_version_id, status, billing_interval,
  billing_period_start, billing_period_end, payment_due_at
)
select
  '11111111-1111-4111-8111-111111111112',
  plan.id,
  version.id,
  'ACTIVE',
  'MONTHLY',
  date_trunc('month', now() at time zone 'Asia/Taipei')::date,
  (date_trunc('month', now() at time zone 'Asia/Taipei') + interval '1 month')::date,
  (date_trunc('month', now() at time zone 'Asia/Taipei') + interval '1 month') at time zone 'Asia/Taipei'
from public.plans plan
join lateral (
  select candidate.id
  from public.plan_versions candidate
  where candidate.plan_id = plan.id
    and candidate.effective_from <= now()
    and (candidate.effective_until is null or candidate.effective_until > now())
  order by candidate.version desc
  limit 1
) version on true
where plan.code = 'PRO';

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
  stall_id, organization_id, dine_in_enabled, delivery_module_enabled, staff_delivery_enabled,
  print_module_enabled, kds_module_enabled, payment_module_enabled, discount_module_enabled,
  lottery_enabled, discount_approval_threshold_bps, takeout_preorder_enabled, preorder_slot_minutes,
  enabled_locales, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  8000,
  true,
  5,
  array['zh-TW', 'en', 'ja', 'ko', 'vi', 'th']::text[],
  now(),
  now()
);

insert into public.stall_business_hours (
  organization_id, stall_id, day_of_week, opens_at, closes_at, is_closed, created_at, updated_at
)
select
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  day_of_week,
  '17:00',
  '23:00',
  day_of_week = 1,
  now(),
  now()
from generate_series(0, 6) as day_of_week;

insert into public.printers (
  id, organization_id, stall_id, name, is_enabled, created_at, updated_at
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '櫃台印表機',
  true,
  now(),
  now()
);

insert into public.dining_tables (
  id, organization_id, stall_id, code, label, is_active, sort_order,
  layout_x, layout_y, created_at, updated_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'A1',
  'A1 桌',
  true,
  1,
  60,
  80,
  now(),
  now()
);

insert into public.payment_options (
  id, organization_id, stall_id, code, name, kind, is_enabled, sort_order, created_at, updated_at
) values
  ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'CASH', '現金', 'CASH', true, 1, now(), now()),
  ('99999999-9999-4999-8999-999999999992', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'LINE_PAY', 'LINE Pay', 'LINE_PAY', true, 2, now(), now()),
  ('99999999-9999-4999-8999-999999999993', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'JKO_PAY', '街口支付', 'JKO_PAY', true, 3, now(), now());

insert into public.discount_options (
  id, organization_id, stall_id, name, rate_bps, is_enabled, sort_order, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '9 折', 9000, true, 1, now(), now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '8 折', 8000, true, 2, now(), now());

insert into public.stall_lottery_discount_chances (
  stall_id, discount_option_id, win_rate_bps, created_at
) values
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 1000, now()),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 500, now());

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

insert into public.qr_codes (
  id, organization_id, stall_id, dining_table_id, token, label, state, token_version,
  created_at, updated_at
) values (
  '33333333-3333-4333-8333-333333333334',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'demo-aming-chicken-table-a1-qr-2026',
  'A1 桌點餐 QR',
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

insert into public.product_category_translations (
  organization_id, category_id, locale, name, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', 'en', 'Fried Foods', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', 'ja', '揚げ物', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', 'ko', '튀김', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', 'vi', 'Món chiên', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', 'th', 'ของทอด', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', 'en', 'Drinks', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', 'ja', 'ドリンク', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', 'ko', '음료', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', 'vi', 'Đồ uống', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', 'th', 'เครื่องดื่ม', now(), now());

insert into public.product_group_translations (
  organization_id, group_id, locale, name, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888881', 'en', 'Popular Fried Foods', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888881', 'ja', '人気の揚げ物', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888881', 'ko', '인기 튀김', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888881', 'vi', 'Món chiên phổ biến', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888881', 'th', 'ของทอดยอดนิยม', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888882', 'en', 'Refreshing Drinks', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888882', 'ja', 'さわやかドリンク', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888882', 'ko', '시원한 음료', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888882', 'vi', 'Đồ uống giải khát', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888882', 'th', 'เครื่องดื่มสดชื่น', now(), now());

insert into public.products (
  id, organization_id, category_id, group_id, name, description, default_price,
  is_active, sort_order, created_at, updated_at
) values
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '香酥雞排', '現炸雞排，灑上胡椒鹽。', 95, true, 1, now(), now()),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '地瓜薯條', '金黃酥脆，適合一起分享。', 55, true, 2, now(), now()),
  ('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777771', '88888888-8888-4888-8888-888888888881', '台式鹽酥雞', '一口大小的鹽酥雞，搭配九層塔。', 75, true, 3, now(), now()),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777772', '88888888-8888-4888-8888-888888888882', '冬瓜茶', '冰涼古早味冬瓜茶。', 35, true, 4, now(), now());

insert into public.product_translations (
  organization_id, product_id, locale, name, description, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'en', 'Deep-Fried Chicken Cutlet', 'Freshly deep-fried Taiwanese chicken cutlet seasoned with pepper salt.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'ja', '鶏肉の揚げ物', '揚げたての台湾風大判チキンに胡椒塩をかけました。', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'ko', '지파이 (대만식 닭튀김)', '갓 튀긴 대만식 대형 닭튀김에 후추 소금을 뿌렸습니다.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'vi', 'Gà phi lê chiên giòn kiểu Đài Loan', 'Gà phi lê kiểu Đài Loan chiên nóng, nêm muối tiêu.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'th', 'ไก่ทอดแผ่นใหญ่สไตล์ไต้หวัน', 'ไก่ทอดแผ่นใหญ่แบบไต้หวัน โรยเกลือพริกไทย', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'en', 'Sweet Potato Fries', 'Golden, crispy sweet potato fries for sharing.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'ja', 'さつまいもフライ', '黄金色でサクサクのさつまいもフライ。', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'ko', '고구마튀김', '함께 즐기기 좋은 바삭한 고구마튀김입니다.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'vi', 'Khoai lang chiên', 'Khoai lang chiên vàng giòn, thích hợp để dùng chung.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'th', 'มันหวานทอด', 'มันหวานทอดกรอบสีทอง เหมาะสำหรับแบ่งกันทาน', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'en', 'Pepper Popcorn Chicken', 'Bite-sized fried chicken seasoned with pepper salt and Taiwanese basil.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'ja', '台湾風鶏の唐揚げ', '一口サイズの鶏の唐揚げを胡椒塩と台湾バジルで仕上げました。', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'ko', '셴수지 (타이완식 후라이드 치킨)', '한입 크기 닭튀김에 후추 소금과 대만 바질을 곁들였습니다.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'vi', 'Gà chiên muối tiêu kiểu Đài Loan', 'Gà chiên miếng nhỏ nêm muối tiêu và húng quế Đài Loan.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'th', 'ไก่ป๊อปคอร์นพริกไทยสไตล์ไต้หวัน', 'ไก่ทอดชิ้นพอดีคำปรุงเกลือพริกไทยและโหระพาไต้หวัน', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'en', 'Winter Melon Tea', 'Chilled traditional winter melon tea.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'ja', '冬瓜茶', '冷たい昔ながらの冬瓜茶。', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'ko', '동과차', '시원한 전통 동과차입니다.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'vi', 'Trà bí đao', 'Trà bí đao truyền thống dùng lạnh.', now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'th', 'ชาฟักเขียว', 'ชาฟักเขียวแบบดั้งเดิมเสิร์ฟเย็น', now(), now());

insert into public.product_note_groups (
  id, organization_id, name, selection_mode, is_required, min_selections,
  max_selections, sort_order, is_active, created_at, updated_at
) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '11111111-1111-4111-8111-111111111111', '辣度', 'SINGLE', true, 1, 1, 1, true, now(), now()),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '11111111-1111-4111-8111-111111111111', '加料', 'MULTIPLE', false, 0, 2, 2, true, now(), now());

insert into public.product_note_options (
  id, organization_id, note_group_id, name, price_delta, sort_order, is_active, created_at, updated_at
) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '不辣', 0, 1, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '小辣', 0, 2, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '中辣', 0, 3, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '大辣', 0, 4, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd5', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '加蛋', 15, 1, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd6', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '加起司', 20, 2, true, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd7', '11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '加九層塔', 5, 3, true, now(), now());

insert into public.product_note_group_translations (
  organization_id, note_group_id, locale, name, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'en', 'Spice Level', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'ja', '辛さ', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'ko', '맵기', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'vi', 'Mức độ cay', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'th', 'ระดับความเผ็ด', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'en', 'Add-ons', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'ja', '追加トッピング', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'ko', '추가 토핑', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'vi', 'Món thêm', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'th', 'ท็อปปิ้งเพิ่มเติม', now(), now());

insert into public.product_note_option_translations (
  organization_id, note_option_id, locale, name, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'en', 'No Spice', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'ja', '無辛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'ko', '안 맵게', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'vi', 'Không cay', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'th', 'ไม่เผ็ด', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'en', 'Mild', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'ja', '小辛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'ko', '약간 매운맛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'vi', 'Ít cay', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'th', 'เผ็ดน้อย', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'en', 'Medium', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'ja', '中辛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'ko', '보통 매운맛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'vi', 'Cay vừa', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'th', 'เผ็ดปานกลาง', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'en', 'Hot', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'ja', '大辛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'ko', '매운맛', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'vi', 'Rất cay', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'th', 'เผ็ดมาก', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'en', 'Extra Egg', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'ja', '卵追加', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'ko', '계란 추가', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'vi', 'Thêm trứng', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'th', 'เพิ่มไข่', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'en', 'Extra Cheese', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'ja', 'チーズ追加', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'ko', '치즈 추가', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'vi', 'Thêm phô mai', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'th', 'เพิ่มชีส', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'en', 'Extra Taiwanese Basil', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'ja', '台湾バジル追加', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'ko', '대만 바질 추가', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'vi', 'Thêm húng quế Đài Loan', now(), now()),
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'th', 'เพิ่มโหระพาไต้หวัน', now(), now());

insert into public.product_note_group_assignments (
  organization_id, product_id, note_group_id, sort_order, is_active, created_at, updated_at
) values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 1, true, now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444441', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 1, true, now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444442', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 2, true, now(), now()),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444443', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 3, true, now(), now());

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

-- Reproducible completed demo sales make the QR Top 3 and popularity-weighted
-- lottery behavior visible immediately after a local reset.
with demo_sales(sequence_no, product_id, unit_price, quantity) as (
  values
    (1, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (2, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (3, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (4, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (5, '44444444-4444-4444-8444-444444444442'::uuid, 55, 4),
    (6, '44444444-4444-4444-8444-444444444442'::uuid, 55, 2),
    (7, '44444444-4444-4444-8444-444444444442'::uuid, 55, 2),
    (8, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1),
    (9, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1),
    (10, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1)
)
insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, origin, is_test, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, confirmed_at, paid_at,
  completed_at, created_at, updated_at
)
select
  ('b5100000-0000-4000-8000-' || lpad(sequence_no::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'DEMO-HOT-' || lpad(sequence_no::text, 3, '0'),
  encode(extensions.digest('DEMO-HOT-' || sequence_no, 'sha256'), 'hex'),
  ('b5300000-0000-4000-8000-' || lpad(sequence_no::text, 12, '0'))::uuid,
  'DEMO_BESTSELLER_SEED',
  'IMPORTED'::public.order_origin,
  false,
  '熱銷示範訂單',
  'TAKEOUT',
  'COMPLETED',
  'PAID',
  unit_price * quantity,
  unit_price * quantity,
  rpad('demo-bestseller-seed', 64, '0'),
  now() - make_interval(hours => sequence_no),
  now() - make_interval(hours => sequence_no),
  now() - make_interval(hours => sequence_no),
  now() - make_interval(hours => sequence_no),
  now() - make_interval(hours => sequence_no),
  now()
from demo_sales;

with demo_sales(sequence_no, product_id, unit_price, quantity) as (
  values
    (1, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (2, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (3, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (4, '44444444-4444-4444-8444-444444444441'::uuid, 95, 3),
    (5, '44444444-4444-4444-8444-444444444442'::uuid, 55, 4),
    (6, '44444444-4444-4444-8444-444444444442'::uuid, 55, 2),
    (7, '44444444-4444-4444-8444-444444444442'::uuid, 55, 2),
    (8, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1),
    (9, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1),
    (10, '44444444-4444-4444-8444-444444444443'::uuid, 75, 1)
)
insert into public.order_items (
  id, organization_id, stall_id, order_id, product_id, source_line_index,
  name, base_unit_price, unit_price, quantity, status, created_at
)
select
  ('b5200000-0000-4000-8000-' || lpad(sale.sequence_no::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  ('b5100000-0000-4000-8000-' || lpad(sale.sequence_no::text, 12, '0'))::uuid,
  sale.product_id,
  1,
  product.name,
  sale.unit_price,
  sale.unit_price,
  sale.quantity,
  'SERVED'::public.order_item_status,
  now() - make_interval(hours => sale.sequence_no)
from demo_sales as sale
join public.products as product on product.id = sale.product_id;

insert into public.profiles (
  id, email, password_hash, display_name, is_active, created_at, updated_at
) values
  ('55555555-5555-4555-8555-555555555551', 'owner@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範商戶擁有者', true, now(), now()),
  ('55555555-5555-4555-8555-555555555552', 'staff@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範店員', true, now(), now()),
  ('55555555-5555-4555-8555-555555555553', 'kitchen@stallorder.test', '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm', '示範廚房', true, now(), now());

insert into public.profiles (
  id, email, password_hash, display_name, is_active, platform_role, created_at, updated_at
) values (
  '55555555-5555-4555-8555-555555555554',
  'platform.admin@stallorder.test',
  '$2b$12$7u7DvA296znZ3UsOt48Hwer7nLr8Rrtk6bbqqXILK1EKmH9xXxOjm',
  '示範平台管理員',
  true,
  'PLATFORM_ADMIN',
  now(),
  now()
);

insert into public.organization_memberships (
  id, organization_id, profile_id, role, all_stalls, is_primary_owner, is_active, created_at, updated_at
) values (
  '66666666-6666-4666-8666-666666666661',
  '11111111-1111-4111-8111-111111111111',
  '55555555-5555-4555-8555-555555555551',
  'ORGANIZATION_OWNER',
  true,
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

-- Local demo only: open the HQ menu-version pilot for hands-on verification.
-- Production and DR keep the module default off until a separately approved rollout.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local competitive enhancement verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_HQ_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();

-- Local demo only: allow campaign design while the separate CRM consent hard
-- lock continues to prevent customer issuance and marketing delivery.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local Growth campaign design verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_GROWTH_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();

-- Local demo only: open Supply Lite and provide a small, reversible test set.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local Supply Lite verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_SUPPLY_LITE_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();

insert into public.supply_ingredients (
  id, organization_id, code, name, base_uom,
  low_stock_threshold_micros, created_by_profile_id
)
values
  ('c6100000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'CHICKEN_THIGH', '去骨雞腿', 'G', 5000000, '55555555-5555-4555-8555-555555555551'),
  ('c6100000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'FRYING_OIL', '炸油', 'ML', 3000000, '55555555-5555-4555-8555-555555555551'),
  ('c6100000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'PAPER_BOWL', '紙碗', 'EA', 20, '55555555-5555-4555-8555-555555555551')
on conflict (organization_id, code) do update set
  name = excluded.name,
  base_uom = excluded.base_uom,
  low_stock_threshold_micros = excluded.low_stock_threshold_micros,
  updated_at = now();

insert into public.supply_locations (
  id, organization_id, stall_id, code, name, location_type, created_by_profile_id
)
values
  ('c6200000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, 'CENTRAL_01', '中央備料庫', 'CENTRAL', '55555555-5555-4555-8555-555555555551'),
  ('c6200000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'AMING_STALL', '阿明香雞排攤位庫存', 'STALL', '55555555-5555-4555-8555-555555555551')
on conflict (organization_id, code) do update set
  name = excluded.name,
  stall_id = excluded.stall_id,
  location_type = excluded.location_type,
  updated_at = now();

-- Local demo only: open the developer platform for API and Webhook verification.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local developer platform verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_PUBLIC_API_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();

-- Local demo only: allow event campaign and expense verification. Order
-- attribution capture remains disabled until both public-order circuits pass.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local event growth verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_EVENT_GROWTH_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();

-- Local demo only: expose governed KPI definitions and cross-module health.
insert into public.resilience_feature_flag_overrides (
  flag_id,
  scope_type,
  organization_id,
  enabled,
  reason,
  created_by_profile_id,
  updated_by_profile_id,
  created_at,
  updated_at
)
select
  flag.id,
  'ORGANIZATION',
  '11111111-1111-4111-8111-111111111111',
  true,
  'Local advanced analytics verification only',
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551',
  now(),
  now()
from public.resilience_feature_flags as flag
where flag.code = 'MODULE_ADVANCED_ANALYTICS_ENABLED'
on conflict (flag_id, scope_type, organization_id, stall_id, device_id)
do update set
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by_profile_id = excluded.updated_by_profile_id,
  updated_at = now();
