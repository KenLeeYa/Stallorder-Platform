begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select ok(
  (select count(*) = 10 from information_schema.columns
   where table_schema = 'public' and (
     (table_name = 'stall_ordering_settings' and column_name = 'discount_approval_threshold_bps')
     or (table_name = 'orders' and column_name in (
       'discount_applied_by', 'discount_approved_by', 'discount_approval_reason',
       'cancellation_reason', 'cancellation_detail', 'cancelled_at', 'cancelled_by'
     ))
     or (table_name = 'payments' and column_name = 'checkout_group_id')
     or (table_name = 'print_jobs' and column_name = 'status')
   )),
  'P1 核心欄位均已建立'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.stall_business_hours'::regclass,
     'public.printers'::regclass,
     'public.print_jobs'::regclass,
     'public.cash_shifts'::regclass,
     'public.cash_movements'::regclass,
     'public.checkout_groups'::regclass
   )),
  'P1 所有新資料表均啟用並強制套用 RLS'
);

select ok(
  not has_table_privilege('anon', 'public.stall_business_hours', 'INSERT')
  and not has_table_privilege('anon', 'public.printers', 'INSERT')
  and not has_table_privilege('anon', 'public.print_jobs', 'INSERT')
  and not has_table_privilege('anon', 'public.cash_shifts', 'INSERT')
  and not has_table_privilege('anon', 'public.cash_movements', 'INSERT')
  and not has_table_privilege('anon', 'public.checkout_groups', 'INSERT'),
  '匿名角色不可直接寫入 P1 營運資料'
);

select is(
  (select discount_approval_threshold_bps from public.stall_ordering_settings
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  8000,
  '既有攤位取得八折的經理核准預設門檻'
);

select throws_ok(
  $$update public.stall_ordering_settings set discount_approval_threshold_bps = 10001
    where stall_id = '22222222-2222-4222-8222-222222222222'$$,
  '23514', null,
  '折扣核准門檻限制在 0 到 10000 bps'
);

select throws_ok(
  $$insert into public.stall_business_hours (
      organization_id, stall_id, day_of_week, opens_at, closes_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', 7, '17:00', '23:00'
    )$$,
  '23514', null,
  '營業時間拒絕無效星期'
);

update public.cash_shifts
set status = 'CLOSED',
    closed_at = coalesce(closed_at, now()),
    closed_by = coalesce(closed_by, opened_by),
    system_expected_amount = coalesce(system_expected_amount, opening_amount),
    counted_amount = coalesce(counted_amount, opening_amount),
    variance_amount = coalesce(variance_amount, 0)
where stall_id = '22222222-2222-4222-8222-222222222222'
  and status = 'OPEN';
insert into public.cash_shifts (
  id, organization_id, stall_id, opening_amount, opened_by
) values (
  '76100000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  2000,
  (select id from public.profiles where email = 'owner@stallorder.test')
);
select throws_ok(
  $$insert into public.cash_shifts (
      organization_id, stall_id, opening_amount, opened_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      1000,
      (select id from public.profiles where email = 'owner@stallorder.test')
    )$$,
  '23505', null,
  '同一攤位同時只能有一個進行中的現金班次'
);

select throws_ok(
  $$insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '76100000-0000-4000-8000-000000000001',
      'CASH_IN', 0, '無效金額',
      (select id from public.profiles where email = 'owner@stallorder.test')
    )$$,
  '23514', null,
  '現金收支金額必須大於零'
);

update public.printers
set last_seen_at = now() - interval '1 hour'
where stall_id = '22222222-2222-4222-8222-222222222222';

update public.stall_ordering_settings
set kds_module_enabled = true
where stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.printers (
  id, organization_id, stall_id, name, is_enabled, last_seen_at
) values (
  '76100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'P1 測試印表機', true, now()
);
insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, created_at, updated_at
) values (
  '76100000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'P1-PRINT-001', repeat('1', 64),
  '76100000-0000-4000-8000-000000000004', 'QR_MENU', 'P1 列印顧客',
  'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 100, 100, repeat('2', 64),
  now() + interval '10 minutes', now(), now()
);
update public.orders set status = 'CONFIRMED' where id = '76100000-0000-4000-8000-000000000003';
select is(
  (select status::text from public.print_jobs where order_id = '76100000-0000-4000-8000-000000000003'),
  'PENDING',
  '確認訂單後會自動建立待列印工作'
);
select is(
  (select printer_id from public.print_jobs where order_id = '76100000-0000-4000-8000-000000000003'),
  '76100000-0000-4000-8000-000000000002'::uuid,
  '列印工作優先指派最近在線的印表機'
);

update public.stall_ordering_settings
set kds_module_enabled = false
where stall_id = '22222222-2222-4222-8222-222222222222';
insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, created_at, updated_at
) values (
  '76100000-0000-4000-8000-000000000005',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'P1-NO-KDS-001', repeat('3', 64),
  '76100000-0000-4000-8000-000000000006', 'QR_MENU', '免 KDS 公開訂單顧客',
  'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 100, 100, repeat('4', 64),
  now() + interval '10 minutes', now(), now()
);
update public.orders set status = 'CONFIRMED' where id = '76100000-0000-4000-8000-000000000005';
select is(
  (select status::text from public.print_jobs
   where order_id = '76100000-0000-4000-8000-000000000005'),
  'PENDING',
  'KDS 關閉時確認公開訂單仍建立待列印工作'
);
insert into public.order_items (
  id, tenant_id, organization_id, stall_id, order_id, product_id,
  name, base_unit_price, unit_price, quantity, status
) values (
  '76100000-0000-4000-8000-000000000007',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '76100000-0000-4000-8000-000000000005',
  '44444444-4444-4444-8444-444444444441',
  '單店員餐點', 100, 100, 1, 'PENDING'
);
select is(
  (select count(*)::integer from public.order_production_tasks
   where order_id = '76100000-0000-4000-8000-000000000005'),
  0,
  'KDS 關閉時不建立隱藏的 production task'
);

select throws_ok(
  $$update public.orders set cancellation_detail = repeat('x', 201)
    where id = '76100000-0000-4000-8000-000000000003'$$,
  '23514', null,
  '取消補充說明限制為 200 字'
);

select throws_ok(
  $$insert into public.checkout_groups (
      organization_id, stall_id, dining_table_id, method_label,
      subtotal, discount_amount, total, cash_received, change_amount, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '現金',
      200, 20, 180, 150, -30,
      (select id from public.profiles where email = 'owner@stallorder.test')
    )$$,
  '23514', null,
  '同桌合併結帳拒絕不足的現金實收'
);

select ok(
  (select exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'cash_shifts_one_open_per_stall'
  )),
  '現金班次具有單一開班的部分唯一索引'
);

select ok(
  (select exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'print_jobs_initial_order_unique'
  )),
  '每張訂單僅建立一筆初始列印工作'
);

rollback;
