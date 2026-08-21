begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'printers' and column_name in (
          'connection_type', 'model', 'paper_width_mm'
        ))
        or (table_name = 'print_jobs' and column_name in (
          'print_rule_id', 'is_routing_copy', 'document_type'
        ))
      )
  ),
  6,
  '整合列印中心的連線、紙寬、規則與分流欄位均已建立'
);

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.print_rules'::regclass
  ),
  '列印規則強制套用 RLS'
);

select ok(
  not has_table_privilege('anon', 'public.print_rules', 'SELECT')
  and not has_table_privilege('anon', 'public.print_rules', 'INSERT'),
  '匿名角色不可讀寫列印規則'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.print_rules'::regclass
      and conname = 'print_rules_printer_tenant_fk'
      and contype = 'f'
  ),
  '列印規則不可把其他組織或攤位的印表機接入目前攤位'
);

select has_column(
  'public', 'print_rules', 'deleted_at',
  '列印規則保留軟刪除時間以維持歷史出單關聯'
);

select throws_ok(
  $$insert into public.printers (
      organization_id, stall_id, name, paper_width_mm
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '不支援紙寬', 57
    )$$,
  '23514', null,
  '57 mm 紙卷必須使用安全的 58 mm 版型設定'
);

update public.stall_ordering_settings
set print_module_enabled = true
where organization_id = '11111111-1111-4111-8111-111111111111'
  and stall_id = '22222222-2222-4222-8222-222222222222';

delete from public.print_rules
where stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.printers (
  id, organization_id, stall_id, name, connection_type, model,
  paper_width_mm, is_enabled, last_seen_at
) values
(
  '79100000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '整合列印廚房一', 'WEBPRNT_BLUETOOTH', 'MCP31LB', 58, true, now()
),
(
  '79100000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '整合列印廚房二', 'SYSTEM_PRINT', 'GENERIC', 80, true, now()
);

select throws_ok(
  $$insert into public.print_rules (
      organization_id, stall_id, printer_id, name, document_type, split_mode
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '79100000-0000-4000-8000-000000000001',
      '錯誤的分切明細', 'CUSTOMER_RECEIPT', 'CATEGORY'
    )$$,
  '23514', null,
  '顧客明細不可分切而遺失訂單總額'
);

insert into public.print_rules (
  id, organization_id, stall_id, printer_id, name, document_type, trigger,
  order_sources, fulfillment_types, copies, sort_order
) values
(
  '79100000-0000-4000-8000-000000000011',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000001',
  '廚房第一聯', 'KITCHEN_TICKET', 'ORDER_CONFIRMED',
  array['STAFF_POS'], array['TAKEOUT']::public.fulfillment_type[], 1, 10
),
(
  '79100000-0000-4000-8000-000000000012',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000002',
  '廚房第二聯', 'KITCHEN_TICKET', 'ORDER_CONFIRMED',
  array['STAFF_POS'], array['TAKEOUT']::public.fulfillment_type[], 2, 20
);

insert into public.print_rules (
  id, organization_id, stall_id, printer_id, name, is_enabled, deleted_at
) values
(
  '79100000-0000-4000-8000-000000000014',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000001',
  '可重用的規則名稱', false, now()
),
(
  '79100000-0000-4000-8000-000000000015',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000001',
  '可重用的規則名稱', false, null
);

select is(
  (
    select count(*)::integer
    from public.print_rules
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and name = '可重用的規則名稱'
  ),
  2,
  '軟刪除後可重用原規則名稱且保留舊關聯'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, origin, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, confirmation_expires_at,
  created_at, updated_at
) values (
  '79100000-0000-4000-8000-000000000021',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PRINT-RULE-001', repeat('a', 64), '79100000-0000-4000-8000-000000000031',
  'STAFF_POS', 'ONLINE_STAFF', '列印分流顧客', 'TAKEOUT',
  'WAITING_CONFIRMATION', 'UNPAID', 120, 120, repeat('b', 64),
  now() + interval '10 minutes', now(), now()
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '79100000-0000-4000-8000-000000000021';

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000021'
  ),
  2,
  '單一訂單可依規則分流到兩台印表機'
);

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000021'
      and reprint_of_id is null
      and not is_routing_copy
  ),
  1,
  '分流保留唯一相容根工作'
);

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000021'
      and reprint_of_id is not null
      and is_routing_copy
  ),
  1,
  '第二台印表機工作標記為規則分流而非人工補印'
);

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000021'
      and print_rule_id = '79100000-0000-4000-8000-000000000014'
  ),
  0,
  '已軟刪除規則不會再建立列印工作'
);

update public.orders
set status = 'CONFIRMED'
where id = '79100000-0000-4000-8000-000000000021';

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000021'
  ),
  2,
  '重複狀態更新不會重複出單'
);

insert into public.print_rules (
  id, organization_id, stall_id, printer_id, name, document_type, trigger,
  order_sources, fulfillment_types, copies, sort_order
)
select
  ('79200000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000001',
  '分流上限規則-' || sequence,
  'KITCHEN_TICKET', 'ORDER_CONFIRMED', array['STAFF_POS'],
  array['TAKEOUT']::public.fulfillment_type[], 1, 100 + sequence
from generate_series(1, 49) as sequence;

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, origin, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, confirmation_expires_at,
  created_at, updated_at
) values (
  '79100000-0000-4000-8000-000000000025',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PRINT-RULE-005', repeat('3', 64), '79100000-0000-4000-8000-000000000035',
  'STAFF_POS', 'ONLINE_STAFF', '分流上限顧客', 'TAKEOUT',
  'WAITING_CONFIRMATION', 'UNPAID', 100, 100, repeat('4', 64),
  now() + interval '10 minutes', now(), now()
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '79100000-0000-4000-8000-000000000025';

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000025'
  ),
  50,
  '單一事件最多建立一筆相容根工作與四十九筆分流工作'
);

delete from public.print_rules
where stall_id = '22222222-2222-4222-8222-222222222222'
  and name like '分流上限規則-%';

insert into public.print_rules (
  id, organization_id, stall_id, printer_id, name, document_type, trigger,
  order_sources, fulfillment_types, copies, sort_order
) values (
  '79100000-0000-4000-8000-000000000013',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '79100000-0000-4000-8000-000000000001',
  '付款顧客明細', 'CUSTOMER_RECEIPT', 'PAYMENT_COMPLETED',
  array['STAFF_POS'], array['DINE_IN']::public.fulfillment_type[], 1, 30
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, origin, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, table_label, confirmation_expires_at,
  created_at, updated_at
) values (
  '79100000-0000-4000-8000-000000000022',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PRINT-RULE-002', repeat('c', 64), '79100000-0000-4000-8000-000000000032',
  'STAFF_POS', 'ONLINE_STAFF', '付款列印顧客', 'DINE_IN',
  'WAITING_CONFIRMATION', 'UNPAID', 200, 200, repeat('d', 64), '測試桌',
  now() + interval '10 minutes', now(), now()
);

update public.orders
set payment_status = 'PAID', paid_at = now()
where id = '79100000-0000-4000-8000-000000000022';

select is(
  (
    select document_type::text
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000022'
  ),
  'CUSTOMER_RECEIPT',
  '付款完成事件可自動建立顧客明細'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, origin, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, confirmation_expires_at,
  created_at, updated_at
) values (
  '79100000-0000-4000-8000-000000000023',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PRINT-RULE-003', repeat('e', 64), '79100000-0000-4000-8000-000000000033',
  'OFFLINE_POS', 'OFFLINE_POS', '離線列印顧客', 'TAKEOUT',
  'WAITING_CONFIRMATION', 'UNPAID', 90, 90, repeat('f', 64),
  now() + interval '10 minutes', now(), now()
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '79100000-0000-4000-8000-000000000023';

select is(
  (
    select status::text
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000023'
      and reprint_of_id is null
  ),
  'CANCELLED',
  '離線 POS 的本機列印會取消伺服器相容工作以避免雙出單'
);

delete from public.print_rules
where stall_id = '22222222-2222-4222-8222-222222222222';

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, origin, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, confirmation_expires_at,
  created_at, updated_at
) values (
  '79100000-0000-4000-8000-000000000024',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'PRINT-RULE-004', repeat('1', 64), '79100000-0000-4000-8000-000000000034',
  'QR_MENU', 'ONLINE_QR', '相容列印顧客', 'TAKEOUT',
  'WAITING_CONFIRMATION', 'UNPAID', 80, 80, repeat('2', 64),
  now() + interval '10 minutes', now(), now()
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '79100000-0000-4000-8000-000000000024';

select is(
  (
    select count(*)::integer
    from public.print_jobs
    where order_id = '79100000-0000-4000-8000-000000000024'
      and status = 'PENDING'
      and print_rule_id is null
  ),
  1,
  '未設定規則時保留既有單一印表機出單行為'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_zz_route_integrated_print_jobs'
      and tgenabled = 'O'
  ),
  '整合列印 trigger 已啟用'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.route_integrated_order_print_jobs()',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.route_integrated_order_print_jobs()',
    'EXECUTE'
  ),
  '只有受信任服務角色可直接執行列印路由函式'
);

select * from finish();
rollback;
