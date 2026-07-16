begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

select ok(
  (select count(*) = 10 from information_schema.columns
   where table_schema = 'public' and (
     (table_name = 'stall_ordering_settings' and column_name in ('estimated_wait_minutes', 'business_day_cutoff_hour'))
     or (table_name = 'stall_products' and column_name in ('available_from', 'available_until'))
     or (table_name = 'dining_tables' and column_name in ('service_state', 'seated_at', 'cleaned_at'))
     or (table_name = 'order_item_batch_actions' and column_name in ('target_status', 'item_snapshots', 'expires_at'))
   )),
  'P0 營運欄位均已建立'
);
select is(
  (select estimated_wait_minutes::text || ',' || business_day_cutoff_hour::text
   from public.stall_ordering_settings where stall_id = '22222222-2222-4222-8222-222222222222'),
  '15,0',
  '既有攤位取得向後相容預設值'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.order_item_batch_actions'::regclass),
  '批次復原憑證啟用 RLS'
);
select ok(
  not has_table_privilege('anon', 'public.order_item_batch_actions', 'INSERT'),
  '匿名角色不可寫入批次復原憑證'
);

update public.stall_ordering_settings
set business_day_cutoff_hour = 4
where stall_id = '22222222-2222-4222-8222-222222222222';
select is(
  public.stall_business_date('22222222-2222-4222-8222-222222222222', '2026-07-16 19:30:00+00'::timestamptz),
  '2026-07-16'::date,
  '凌晨四點前仍計入前一營業日'
);
select is(
  public.stall_business_date('22222222-2222-4222-8222-222222222222', '2026-07-16 20:30:00+00'::timestamptz),
  '2026-07-17'::date,
  '切點後計入新營業日'
);
select throws_ok(
  $$update public.stall_products
    set available_from = now() + interval '2 hours', available_until = now() + interval '1 hour'
    where id = (select id from public.stall_products where stall_id = '22222222-2222-4222-8222-222222222222' limit 1)$$,
  '23514', null,
  '商品供應結束時間不可早於開始時間'
);

update public.stall_products
set available_from = now() + interval '1 hour', available_until = now() + interval '2 hours'
where stall_id = '22222222-2222-4222-8222-222222222222'
  and product_id = '44444444-4444-4444-8444-444444444441';
insert into public.order_sessions (
  id, organization_id, stall_id, qr_code_id, token_hash, device_hash,
  ip_hash, status, expires_at, created_at
) values (
  '76000000-0000-4000-8000-000000000010',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  (select id from public.qr_codes where token = 'demo-aming-chicken-qr-2026-rotate-me'),
  encode(extensions.digest('p0-scheduled-session', 'sha256'), 'hex'),
  encode(extensions.digest('p0-scheduled-device', 'sha256'), 'hex'),
  encode(extensions.digest('p0-scheduled-ip', 'sha256'), 'hex'),
  'ACTIVE', now() + interval '10 minutes', now()
);
select is(
  (public.create_public_order(
    '76000000-0000-4000-8000-000000000011',
    'demo-aming-chicken-qr-2026-rotate-me',
    encode(extensions.digest('p0-scheduled-session', 'sha256'), 'hex'),
    encode(extensions.digest('p0-scheduled-device', 'sha256'), 'hex'),
    encode(extensions.digest('p0-scheduled-ip', 'sha256'), 'hex'),
    'p0-scheduled-qr', 'p0-scheduled-behavior',
    '76000000-0000-4000-8000-000000000012', 'p0-scheduled-idempotency',
    'P0 排程顧客', '',
    jsonb_build_array(jsonb_build_object(
      'product_id', '44444444-4444-4444-8444-444444444441',
      'quantity', 1, 'note', '', 'modifier_option_ids', '[]'::jsonb
    )),
    repeat('c', 64), repeat('d', 64), 'p0-scheduled-request'
  )->>'code'),
  'PRODUCT_UNAVAILABLE',
  '正式建單 RPC 會再次拒絕尚未開始供應的商品'
);

insert into public.dining_tables (
  id, organization_id, stall_id, code, label, is_active, sort_order
) values (
  '76000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'P0-QA', 'P0 測試桌', true, 999
);
insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, table_label, dining_table_id,
  fulfillment_type, status, payment_status, total, device_hash,
  confirmation_expires_at, created_at, updated_at
) values (
  '76000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'P0-TABLE-001', repeat('a', 64),
  '76000000-0000-4000-8000-000000000003', 'QR_MENU', 'P0 顧客', 'P0 測試桌',
  '76000000-0000-4000-8000-000000000001', 'DINE_IN', 'WAITING_CONFIRMATION',
  'UNPAID', 100, repeat('b', 64), now() + interval '10 minutes', now(), now()
);
select is(
  (select service_state::text from public.dining_tables where id = '76000000-0000-4000-8000-000000000001'),
  'OCCUPIED',
  '第一筆內用訂單會自動標記桌位已入座'
);
select ok(
  (select seated_at is not null from public.dining_tables where id = '76000000-0000-4000-8000-000000000001'),
  '桌位會保留入座時間'
);
update public.orders set status = 'COMPLETED' where id = '76000000-0000-4000-8000-000000000002';
select is(
  (select service_state::text from public.dining_tables where id = '76000000-0000-4000-8000-000000000001'),
  'NEEDS_CLEANING',
  '桌上最後訂單完成後會自動標記待清潔'
);

rollback;
