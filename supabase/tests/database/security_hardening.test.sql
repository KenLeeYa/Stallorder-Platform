begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select ok(
  has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT'),
  '登入角色可讀取安全的個人資料欄位'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'password_hash', 'SELECT'),
  '登入角色不可讀取密碼雜湊'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'SELECT'),
  '登入角色不可讀取外部驗證識別碼'
);
select ok(
  has_column_privilege('authenticated', 'public.orders', 'id', 'SELECT'),
  '登入角色可在 RLS 範圍內讀取訂單安全欄位'
);
select ok(
  not has_column_privilege('authenticated', 'public.orders', 'tracking_token_hash', 'SELECT'),
  '登入角色不可讀取訂單追蹤 token 雜湊'
);
select ok(
  not has_column_privilege('authenticated', 'public.orders', 'pickup_code_hash', 'SELECT'),
  '登入角色不可讀取取餐碼雜湊'
);
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants role_grant
    join pg_class relation on relation.relname = role_grant.table_name
    join pg_namespace namespace on namespace.oid = relation.relnamespace
      and namespace.nspname = role_grant.table_schema
    where role_grant.table_schema = 'public'
      and role_grant.grantee in ('anon', 'authenticated')
      and relation.relkind = 'r'
      and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ),
  '所有暴露給 anon 或 authenticated 的 public 資料表均啟用並強制 RLS'
);
select ok(
  not has_table_privilege('anon', 'public.orders', 'INSERT'),
  '匿名角色不可直接寫入訂單'
);

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000001', 'hardening-owner@stallorder.test'),
  ('c2000000-0000-4000-8000-000000000001', 'hardening-admin@stallorder.test'),
  ('c3000000-0000-4000-8000-000000000001', 'hardening-finance@stallorder.test'),
  ('c4000000-0000-4000-8000-000000000001', 'hardening-staff@stallorder.test');

update public.profiles
set auth_user_id = 'c1000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles
set auth_user_id = 'c4000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555552';

insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values
  (
    'c2000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    'hardening-admin@stallorder.test', '受限管理員', true, now()
  ),
  (
    'c3000000-0000-4000-8000-000000000002',
    'c3000000-0000-4000-8000-000000000001',
    'hardening-finance@stallorder.test', '財務檢視者', true, now()
  );

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'c5000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '未指派測試攤位', 'hardening-unassigned-stall', 'HARD-02',
  '台北市測試路二號', 'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'c2000000-0000-4000-8000-000000000002',
    'ORGANIZATION_ADMIN', false, true
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'c3000000-0000-4000-8000-000000000002',
    'FINANCE_VIEWER', true, true
  );

insert into public.stall_memberships (
  id, organization_id, profile_id, stall_id, role, is_active, updated_at
) values (
  'c4000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'c2000000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  'STALL_MANAGER', true, now()
);

insert into public.audit_logs (
  id, organization_id, stall_id, action, entity_type, outcome, request_id
) values
  (
    'c6000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'HARDENING_ASSIGNED', 'STALL', 'SUCCESS', 'hardening-assigned'
  ),
  (
    'c6000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'c5000000-0000-4000-8000-000000000001',
    'HARDENING_UNASSIGNED', 'STALL', 'SUCCESS', 'hardening-unassigned'
  );

insert into public.operational_alerts (
  id, organization_id, stall_id, alert_type, severity, message
) values
  (
    'c7000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'NO_RECENT_ACTIVITY', 'WARNING', '已指派攤位警示'
  ),
  (
    'c7000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'c5000000-0000-4000-8000-000000000001',
    'NO_RECENT_ACTIVITY', 'WARNING', '未指派攤位警示'
  );

insert into public.organization_invitations (
  id, organization_id, stall_id, email, role, token_hash, expires_at
) values
  (
    'c8000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'assigned-invite@stallorder.test', 'STAFF', repeat('a', 64), now() + interval '1 day'
  ),
  (
    'c8000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'c5000000-0000-4000-8000-000000000001',
    'unassigned-invite@stallorder.test', 'STAFF', repeat('b', 64), now() + interval '1 day'
  ),
  (
    'c8000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111', null,
    'organization-invite@stallorder.test', 'FINANCE_VIEWER', repeat('c', 64), now() + interval '1 day'
  );

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values (
  'c9000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'HARD-STAFF-001', repeat('d', 64),
  'c9000000-0000-4000-8000-000000000002', 'STAFF', '測試顧客',
  'WAITING_CONFIRMATION', 'UNPAID', 100, repeat('e', 64), repeat('f', 64),
  now() + interval '10 minutes', now(), now()
);

insert into public.invoices (
  id, organization_id, subscription_id, invoice_number, status, currency,
  billing_period_start, billing_period_end, subtotal, total
) select
  'ca000000-0000-4000-8000-000000000001', subscription.organization_id,
  subscription.id, 'HARDENING-INVOICE-001', 'ISSUED', 'TWD',
  current_date, current_date + 1, 100, 100
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111';

set local role authenticated;

select set_config('request.jwt.claim.sub', 'c2000000-0000-4000-8000-000000000001', true);
select is(
  (select count(id)::integer from public.audit_logs where action like 'HARDENING_%'),
  1,
  '受限管理員只看得到已指派攤位稽核紀錄'
);
select is(
  (select count(id)::integer from public.operational_alerts where message like '%攤位警示'),
  1,
  '受限管理員只看得到已指派攤位警示'
);
select is(
  (select count(id)::integer from public.organization_invitations where email like '%invite@stallorder.test'),
  1,
  '受限管理員只看得到已指派攤位邀請'
);
select is(
  (select count(id)::integer from public.organization_memberships where organization_id = '11111111-1111-4111-8111-111111111111'),
  1,
  '受限管理員不可列舉組織層其他成員'
);

select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select is(
  (select count(id)::integer from public.audit_logs where action like 'HARDENING_%'),
  2,
  '組織擁有者可讀取組織內全部攤位稽核紀錄'
);

select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
select is(
  (select count(id)::integer from public.orders where order_no = 'HARD-STAFF-001'),
  0,
  '財務檢視者不可讀取營運訂單列'
);
select is(
  (select count(id)::integer from public.invoices where invoice_number = 'HARDENING-INVOICE-001'),
  0,
  '財務檢視者不可直接讀取擁有者帳務資料'
);

reset role;

select throws_ok(
  $$insert into public.qr_codes (
      id, tenant_id, organization_id, stall_id, token, label, state, token_version, updated_at
    ) values (
      'cc000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'hardening-duplicate-qr-token', '重複版本', 'REVOKED', 1, now()
    )$$,
  '23505', null,
  '同一攤位不可建立重複 QR token 版本'
);

update public.stall_ordering_settings
set max_pending_orders_per_device = 1
where stall_id = '22222222-2222-4222-8222-222222222222';

select lives_ok(
  $$insert into public.orders (
      id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
      idempotency_key, source, customer_name, status, payment_status, total,
      device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
    ) values (
      'cb000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'HARD-QR-001', repeat('1', 64),
      'cb000000-0000-4000-8000-000000000002', 'QR_MENU', '測試顧客',
      'WAITING_CONFIRMATION', 'UNPAID', 100, repeat('2', 64), repeat('3', 64),
      now() + interval '10 minutes', now(), now()
    )$$,
  '第一筆同裝置待確認訂單可建立'
);
select throws_like(
  $$insert into public.orders (
      id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
      idempotency_key, source, customer_name, status, payment_status, total,
      device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
    ) values (
      'cb000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'HARD-QR-002', repeat('4', 64),
      'cb000000-0000-4000-8000-000000000004', 'QR_MENU', '測試顧客',
      'WAITING_CONFIRMATION', 'UNPAID', 100, repeat('2', 64), repeat('5', 64),
      now() + interval '10 minutes', now(), now()
    )$$,
  '%TOO_MANY_PENDING_ORDERS%',
  '同攤位裝置的待確認訂單上限由資料庫原子化強制執行'
);

select set_config('request.jwt.claim.sub', 'c3000000-0000-4000-8000-000000000001', true);
select ok(
  not public.can_view_orders('22222222-2222-4222-8222-222222222222'),
  '財務檢視者不具訂單讀取權限'
);
select set_config('request.jwt.claim.sub', 'c4000000-0000-4000-8000-000000000001', true);
select ok(
  public.can_view_orders('22222222-2222-4222-8222-222222222222'),
  '已指派店員保留訂單讀取權限'
);

select * from finish();
rollback;
