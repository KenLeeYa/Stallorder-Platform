begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select ok(
  (select count(*) = 4 and bool_and(relrowsecurity)
   from pg_class
   where oid = any (array[
     'public.product_translations'::regclass,
     'public.dining_tables'::regclass,
     'public.payment_options'::regclass,
     'public.discount_options'::regclass
   ])),
  '商品翻譯、桌位、付款與折扣設定均啟用 RLS'
);
select ok(not has_table_privilege('anon', 'public.dining_tables', 'INSERT'), '匿名角色不可直接新增桌位');
select ok(not has_table_privilege('anon', 'public.payment_options', 'INSERT'), '匿名角色不可直接新增付款方式');
select ok(not has_table_privilege('anon', 'public.discount_options', 'INSERT'), '匿名角色不可直接新增折扣');
select ok(not has_table_privilege('anon', 'public.product_translations', 'INSERT'), '匿名角色不可直接新增商品翻譯');

select lives_ok(
  $$update public.qr_codes
    set label = label
    where token = 'demo-aming-chicken-qr-2026-rotate-me'$$,
  '外帶 QR 更新不會誤觸其他資料表欄位檢查'
);

insert into public.order_sessions (
  id, organization_id, stall_id, qr_code_id, token_hash, device_hash,
  ip_hash, status, expires_at, created_at
) values (
  '72000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  (select id from public.qr_codes where token = 'demo-aming-chicken-table-a1-qr-2026'),
  encode(extensions.digest('dine-session', 'sha256'), 'hex'),
  encode(extensions.digest('dine-device', 'sha256'), 'hex'),
  encode(extensions.digest('dine-ip', 'sha256'), 'hex'),
  'ACTIVE', now() + interval '10 minutes', now()
);

create temporary table dine_in_result as
select public.create_public_order(
  '73000000-0000-4000-8000-000000000001',
  'demo-aming-chicken-table-a1-qr-2026',
  encode(extensions.digest('dine-session', 'sha256'), 'hex'),
  encode(extensions.digest('dine-device', 'sha256'), 'hex'),
  encode(extensions.digest('dine-ip', 'sha256'), 'hex'),
  'dine-qr-hash',
  'dine-behavior',
  '74000000-0000-4000-8000-000000000001',
  'dine-idempotency',
  '內用測試顧客',
  '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444441',
    'quantity', 1,
    'note', ''
  )),
  encode(extensions.digest('dine-tracking', 'sha256'), 'hex'),
  encode(extensions.digest('unused-pickup', 'sha256'), 'hex'),
  'dine-in-test'
) as result;

select is((select result->'order'->>'order_status' from dine_in_result), 'WAITING_CONFIRMATION', '內用公開訂單仍從待確認開始');
select is((select result->'order'->>'fulfillment_type' from dine_in_result), 'DINE_IN', '桌位 QR 建立內用訂單');
select is((select result->'order'->>'pickup_required' from dine_in_result), 'false', '內用訂單不需要取餐碼');
select is((select fulfillment_type::text from public.orders where id = '73000000-0000-4000-8000-000000000001'), 'DINE_IN', '資料庫保存內用履約類型');
select is((select table_label from public.orders where id = '73000000-0000-4000-8000-000000000001'), 'A1 桌', '訂單保存受信任桌位快照');
select is((select pickup_code_hash from public.orders where id = '73000000-0000-4000-8000-000000000001'), null::text, '內用訂單不保存取餐碼雜湊');
select lives_ok(
  $$update public.order_items
    set status = 'PREPARING', preparing_at = now()
    where order_id = '73000000-0000-4000-8000-000000000001'$$,
  '餐點狀態可更新並寫入營運事件'
);
select is(
  (select count(*)::integer from public.operational_events where event_type = 'ORDER_ITEM_STATUS_CHANGED' and entity_id in (
    select id from public.order_items where order_id = '73000000-0000-4000-8000-000000000001'
  )),
  1,
  '餐點狀態變更建立即時營運事件'
);
select ok((select is_primary_owner from public.organization_memberships where profile_id = '55555555-5555-4555-8555-555555555551'), '示範組織最高擁有者已綁定');
select throws_ok(
  $$update public.organization_memberships
    set is_active = false
    where profile_id = '55555555-5555-4555-8555-555555555551'$$,
  '23514', null,
  '資料庫限制最高擁有者不可停用'
);

select * from finish();
rollback;
