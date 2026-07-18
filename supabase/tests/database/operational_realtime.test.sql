begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

delete from public.operational_alerts;
delete from public.operational_events;
delete from public.payments;
delete from public.order_sessions;
delete from public.orders;

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values (
  '70000000-0000-4000-8000-000000000051',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'REALTIME-001', repeat('1', 64),
  '71000000-0000-4000-8000-000000000051', 'STAFF', '即時測試顧客',
  'WAITING_CONFIRMATION', 'UNPAID', 180, repeat('2', 64), repeat('3', 64),
  now() + interval '10 minutes', now(), now()
);

insert into public.order_events (
  id, organization_id, stall_id, order_id, event_type, previous_status, new_status
) values (
  '72000000-0000-4000-8000-000000000051',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '70000000-0000-4000-8000-000000000051',
  'PUBLIC_ORDER_CREATED', null, 'WAITING_CONFIRMATION'
);
select is(
  (select event_type from public.operational_events where entity_id = '70000000-0000-4000-8000-000000000051' order by created_at desc limit 1),
  'ORDER_CREATED',
  '訂單事件先持久化為組織與攤位範圍的即時事件'
);

insert into public.order_events (
  id, organization_id, stall_id, order_id, event_type, previous_status, new_status
) values (
  '72000000-0000-4000-8000-000000000052',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '70000000-0000-4000-8000-000000000051',
  'STAFF_STATUS_CHANGED', 'WAITING_CONFIRMATION', 'CONFIRMED'
);
select is(
  (select count(*)::integer from public.operational_events where entity_id = '70000000-0000-4000-8000-000000000051' and event_type = 'ORDER_CONFIRMED'),
  1,
  '確認訂單會產生 ORDER_CONFIRMED 事件'
);

insert into public.payments (
  organization_id, stall_id, order_id, amount, method, status, paid_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '70000000-0000-4000-8000-000000000051', 180, 'CASH', 'PAID', now()
);
select is(
  (select count(*)::integer from public.operational_events where event_type = 'PAYMENT_RECORDED'),
  1,
  '付款紀錄會產生 PAYMENT_RECORDED 事件'
);

update public.stalls
set business_status = 'PAUSED', ordering_enabled = false
where id = '22222222-2222-4222-8222-222222222222';
select is(
  (select business_status::text || ':' || ordering_enabled::text from public.stalls where id = '22222222-2222-4222-8222-222222222222'),
  'PAUSED:false',
  '停用新訂單時仍保留明確的暫停營運狀態'
);
select is(
  (select event_type from public.operational_events where entity_type = 'STALL' order by created_at desc, id desc limit 1),
  'STALL_PAUSED',
  '暫停攤位會產生 STALL_PAUSED 事件'
);

update public.stall_products
set is_sold_out = not is_sold_out
where stall_id = '22222222-2222-4222-8222-222222222222';
select cmp_ok(
  (select count(*)::integer from public.operational_events where event_type = 'PRODUCT_SOLD_OUT_CHANGED'),
  '>', 0,
  '攤位商品售罄變更會產生即時事件'
);

select public.refresh_operational_alerts('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::integer from public.operational_alerts where alert_type = 'ORDERING_PAUSED' and status = 'ACTIVE'),
  1,
  '警示偵測會建立暫停點餐警示'
);

update public.stalls
set business_status = 'OPEN', ordering_enabled = true
where id = '22222222-2222-4222-8222-222222222222';
select public.refresh_operational_alerts('11111111-1111-4111-8111-111111111111');
select is(
  (select status from public.operational_alerts where alert_type = 'ORDERING_PAUSED' order by created_at desc limit 1),
  'RESOLVED',
  '恢復點餐後自動解除暫停警示'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PENDING-' || series::text,
  encode(extensions.digest('pending-track-' || series::text, 'sha256'), 'hex'),
  gen_random_uuid(), 'STAFF', '待處理測試', 'CONFIRMED', 'UNPAID', 100,
  encode(extensions.digest('pending-device-' || series::text, 'sha256'), 'hex'),
  encode(extensions.digest('pending-pickup-' || series::text, 'sha256'), 'hex'),
  now() + interval '10 minutes', now(), now()
from generate_series(1, 9) series;
select public.refresh_operational_alerts('11111111-1111-4111-8111-111111111111');
select is(
  (select count(*)::integer from public.operational_alerts where alert_type = 'EXCESSIVE_PENDING_ORDERS' and status = 'ACTIVE'),
  1,
  '十筆待處理訂單會建立重大警示'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91111111-1111-4111-8111-111111111150', '即時隔離組織', 'realtime-isolation-org',
  '即時隔離組織', 'ACTIVE', 'realtime-isolation@stallorder.test', '0900-111-150', now()
);
insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  '93333333-3333-4333-8333-333333333350',
  '91111111-1111-4111-8111-111111111150', id, 'ACTIVE',
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '92222222-2222-4222-8222-222222222250',
  '91111111-1111-4111-8111-111111111150', '其他即時攤位', 'other-realtime-stall',
  'OTHER-RT', '測試地址', 'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);
insert into public.operational_events (
  organization_id, stall_id, event_type, entity_type, entity_id
) values (
  '91111111-1111-4111-8111-111111111150',
  '92222222-2222-4222-8222-222222222250',
  'STALL_OPENED', 'STALL', '92222222-2222-4222-8222-222222222250'
);

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111150', 'realtime-owner@stallorder.test'),
  ('a2222222-2222-4222-8222-222222222250', 'realtime-staff@stallorder.test');
update public.profiles set auth_user_id = 'a1111111-1111-4111-8111-111111111150'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'a2222222-2222-4222-8222-222222222250'
where id = '55555555-5555-4555-8555-555555555552';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111150', true);
select cmp_ok(
  (select count(*)::integer from public.operational_events where organization_id = '11111111-1111-4111-8111-111111111111'),
  '>', 0,
  '組織擁有者可讀取自己組織的即時事件'
);
select is(
  (select count(*)::integer from public.operational_events where organization_id = '91111111-1111-4111-8111-111111111150'),
  0,
  '組織擁有者不可讀取其他組織的即時事件'
);
select cmp_ok(
  (select count(*)::integer from public.operational_alerts),
  '>', 0,
  '組織擁有者可讀取自己組織的營運警示'
);

select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222250', true);
select cmp_ok(
  (select count(*)::integer from public.operational_events where stall_id = '22222222-2222-4222-8222-222222222222'),
  '>', 0,
  '店員可讀取已指派攤位的即時事件'
);
select is(
  (select count(*)::integer from public.operational_events where stall_id = '92222222-2222-4222-8222-222222222250'),
  0,
  '店員不可讀取未指派攤位的即時事件'
);
select ok(
  not has_table_privilege(current_user, 'public.operational_events', 'INSERT'),
  '登入使用者不可直接寫入即時事件'
);
select ok(
  not has_table_privilege(current_user, 'public.operational_alerts', 'UPDATE'),
  '登入使用者不可直接竄改營運警示'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.operational_events'::regclass),
  '即時事件資料表強制套用 RLS'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.operational_alerts'::regclass),
  '營運警示資料表強制套用 RLS'
);

select * from finish();
rollback;
