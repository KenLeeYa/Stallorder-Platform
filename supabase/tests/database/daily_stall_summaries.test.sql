begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

delete from public.payments;
delete from public.daily_stall_summaries;
delete from public.order_sessions;
delete from public.orders;

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values (
  '70000000-0000-4000-8000-000000000041',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'SUMMARY-001',
  repeat('1', 64),
  '71000000-0000-4000-8000-000000000041',
  'STAFF',
  '彙總測試顧客',
  'WAITING_CONFIRMATION',
  'UNPAID',
  180,
  repeat('2', 64),
  repeat('3', 64),
  now() + interval '10 minutes',
  now(),
  now()
);

select is(
  (select order_count from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  '新訂單會建立攤位每日彙總'
);
select is(
  (select pending_order_count from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  '待確認訂單列入待處理數'
);

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = '70000000-0000-4000-8000-000000000041';
select is(
  (select confirmed_order_count from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  '確認訂單後自動更新確認數'
);

update public.orders
set status = 'COMPLETED', payment_status = 'PAID', paid_at = now(), completed_at = now()
where id = '70000000-0000-4000-8000-000000000041';
select is(
  (select net_sales from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  180,
  '完成訂單計入淨銷售額'
);

insert into public.payments (
  organization_id, stall_id, order_id, amount, method, status, paid_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '70000000-0000-4000-8000-000000000041',
  180,
  'CASH',
  'PAID',
  now()
);
select is(
  (select cash_amount from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  180,
  '現金付款寫入每日付款彙總'
);
select is(
  (select average_order_value from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222'),
  180,
  '平均客單價使用已完成訂單計算'
);

select lives_ok(
  format(
    $$select public.rebuild_daily_stall_summary(
      '22222222-2222-4222-8222-222222222222',
      %L::date,
      %L::date
    )$$,
    (now() at time zone 'Asia/Taipei')::date,
    (now() at time zone 'Asia/Taipei')::date
  ),
  '可重建指定攤位日期區間'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91111111-1111-4111-8111-111111111140',
  '付款隔離組織',
  'payment-isolation-org',
  '付款隔離組織',
  'ACTIVE',
  'payment-isolation@stallorder.test',
  '0900-111-140',
  now()
);
select throws_like(
  $$insert into public.payments (
      organization_id, stall_id, order_id, amount, method, status
    ) values (
      '91111111-1111-4111-8111-111111111140',
      '22222222-2222-4222-8222-222222222222',
      '70000000-0000-4000-8000-000000000041',
      180,
      'CASH',
      'PAID'
    )$$,
  '%PAYMENT_SCOPE_MISMATCH%',
  '付款組織與訂單範圍不符時拒絕寫入'
);

insert into auth.users (id, email) values
  ('a4444444-4444-4444-8444-444444444440', 'summary-finance@stallorder.test'),
  ('a3333333-3333-4333-8333-333333333340', 'summary-kitchen@stallorder.test');
insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values (
  '54444444-4444-4444-8444-444444444440',
  'a4444444-4444-4444-8444-444444444440',
  'summary-finance@stallorder.test',
  '彙總財務測試員',
  true,
  now()
);
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  '54444444-4444-4444-8444-444444444440',
  'FINANCE_VIEWER',
  true,
  true
);
update public.profiles
set auth_user_id = 'a3333333-3333-4333-8333-333333333340'
where id = '55555555-5555-4555-8555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4444444-4444-4444-8444-444444444440', true);
select ok(
  (select count(id) >= 1 from public.daily_stall_summaries),
  '財務檢視者可讀取授權攤位的每日彙總'
);
select is(
  (select count(*)::integer from public.payments),
  1,
  '財務檢視者可讀取授權付款紀錄'
);

select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333340', true);
select is(
  (
    (select count(*) from public.daily_stall_summaries)
    + (select count(*) from public.payments)
  )::integer,
  0,
  '廚房角色無法讀取財務彙總與付款紀錄'
);

select * from finish();
rollback;
