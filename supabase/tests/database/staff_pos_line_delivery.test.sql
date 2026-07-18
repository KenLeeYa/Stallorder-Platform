begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

select ok(
  exists (
    select 1 from pg_enum enum_value
    join pg_type enum_type on enum_type.oid = enum_value.enumtypid
    where enum_type.typname = 'fulfillment_type' and enum_value.enumlabel = 'DELIVERY'
  ),
  '履約類型包含 DELIVERY'
);

select is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'public' and (
     (table_name = 'stall_ordering_settings' and column_name = 'delivery_module_enabled')
     or (table_name = 'order_sessions' and column_name = 'ordering_mode')
     or (table_name = 'orders' and column_name = 'delivery_address')
   )),
  3,
  '外送模組、session 模式及地址欄位均已建立'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_public_delivery_order(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  '匿名角色不可直接執行外送建單 RPC'
);

select ok(
  not has_table_privilege('anon', 'public.orders', 'INSERT'),
  '匿名角色不可直接新增外送訂單'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_public_delivery_order(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text)',
    'EXECUTE'
  ),
  '只有受信任服務角色可執行外送建單 RPC'
);

update public.stall_ordering_settings
set delivery_module_enabled = true, print_module_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.order_sessions (
  id, tenant_id, organization_id, stall_id, qr_code_id, token_hash,
  device_hash, ip_hash, status, ordering_mode, expires_at, created_at
) values (
  '78000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  (select id from public.qr_codes where token = 'demo-aming-chicken-qr-2026-rotate-me'),
  encode(extensions.digest('delivery-session', 'sha256'), 'hex'),
  encode(extensions.digest('delivery-device', 'sha256'), 'hex'),
  encode(extensions.digest('delivery-ip', 'sha256'), 'hex'),
  'ACTIVE', 'DELIVERY', now() + interval '10 minutes', now()
);

select throws_ok(
  $$update public.order_sessions set ordering_mode = 'FORGED'
    where id = '78000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'order session 僅接受受信任的點餐模式'
);

create temporary table delivery_result as
select public.create_public_delivery_order(
  '78000000-0000-4000-8000-000000000002',
  'demo-aming-chicken-qr-2026-rotate-me',
  encode(extensions.digest('delivery-session', 'sha256'), 'hex'),
  encode(extensions.digest('delivery-device', 'sha256'), 'hex'),
  encode(extensions.digest('delivery-ip', 'sha256'), 'hex'),
  'delivery-qr-hash',
  'delivery-behavior',
  '78000000-0000-4000-8000-000000000003',
  'delivery-idempotency',
  '外送測試顧客',
  '0912345678',
  '台北市信義區測試路 1 號',
  '',
  jsonb_build_array(jsonb_build_object(
    'product_id', '44444444-4444-4444-8444-444444444441',
    'quantity', 1,
    'note', '',
    'modifier_option_ids', jsonb_build_array()
  )),
  encode(extensions.digest('delivery-tracking', 'sha256'), 'hex'),
  encode(extensions.digest('unused-delivery-pickup', 'sha256'), 'hex'),
  'delivery-test'
) as result;

select is((select result->>'ok' from delivery_result), 'true', '受信任 RPC 可建立外送訂單');
select is((select result->'order'->>'order_status' from delivery_result), 'WAITING_CONFIRMATION', '公開外送訂單仍從待確認開始');
select is((select result->'order'->>'fulfillment_type' from delivery_result), 'DELIVERY', '外送 RPC 回傳正確履約類型');
select is((select source from public.orders where id = '78000000-0000-4000-8000-000000000002'), 'LINE_DELIVERY', '資料庫標記 LINE 外送來源');
select is(
  (select customer_phone || '|' || delivery_address from public.orders where id = '78000000-0000-4000-8000-000000000002'),
  '0912345678|台北市信義區測試路 1 號',
  '外送訂單保存受驗證的聯絡資料'
);
select is(
  (select pickup_code_hash from public.orders where id = '78000000-0000-4000-8000-000000000002'),
  null::text,
  '外送訂單不保存取餐驗證碼'
);
select is(
  public.get_public_order(
    encode(extensions.digest('delivery-tracking', 'sha256'), 'hex'),
    encode(extensions.digest('delivery-device', 'sha256'), 'hex')
  )->>'deliveryAddress',
  '台北市信義區測試路 1 號',
  '公開訂單追蹤可取得自己的外送地址'
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '78000000-0000-4000-8000-000000000002';
select is(
  (select status::text from public.print_jobs where order_id = '78000000-0000-4000-8000-000000000002'),
  'PENDING',
  '確認外送訂單後自動排入列印佇列'
);

select * from finish();
rollback;
