begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('a1111111-1111-4111-8111-111111111111', 'owner-rls@stallorder.test'),
  ('a2222222-2222-4222-8222-222222222222', 'staff-rls@stallorder.test'),
  ('a3333333-3333-4333-8333-333333333333', 'kitchen-rls@stallorder.test'),
  ('a4444444-4444-4444-8444-444444444444', 'finance-rls@stallorder.test'),
  ('a5555555-5555-4555-8555-555555555555', 'admin-rls@stallorder.test'),
  ('a9999999-9999-4999-8999-999999999999', 'other-owner-rls@stallorder.test');

update public.profiles set auth_user_id = 'a1111111-1111-4111-8111-111111111111'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'a2222222-2222-4222-8222-222222222222'
where id = '55555555-5555-4555-8555-555555555552';
update public.profiles set auth_user_id = 'a3333333-3333-4333-8333-333333333333'
where id = '55555555-5555-4555-8555-555555555553';

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91111111-1111-4111-8111-111111111111',
  '隔離測試組織',
  'isolated-organization',
  '隔離測試組織',
  'ACTIVE',
  'other-owner-rls@stallorder.test',
  '0900-999-999',
  now()
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values
  (
    '82222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    '示範第二攤',
    'demo-stall-two',
    'DEMO-02',
    '台北市測試路二號',
    'TWD',
    'Asia/Taipei',
    true,
    'OPEN',
    true,
    now()
  ),
  (
    '92222222-2222-4222-8222-222222222222',
    '91111111-1111-4111-8111-111111111111',
    '其他組織攤位',
    'isolated-stall',
    'OTHER-01',
    '高雄市測試路一號',
    'TWD',
    'Asia/Taipei',
    true,
    'OPEN',
    true,
    now()
  );

insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values
  ('54444444-4444-4444-8444-444444444444', 'a4444444-4444-4444-8444-444444444444', 'finance-rls@stallorder.test', '財務測試員', true, now()),
  ('55555555-aaaa-4555-8555-555555555555', 'a5555555-5555-4555-8555-555555555555', 'admin-rls@stallorder.test', '管理測試員', true, now()),
  ('59999999-9999-4999-8999-999999999999', 'a9999999-9999-4999-8999-999999999999', 'other-owner-rls@stallorder.test', '其他組織擁有者', true, now());

insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values
  ('11111111-1111-4111-8111-111111111111', '54444444-4444-4444-8444-444444444444', 'FINANCE_VIEWER', true, true),
  ('11111111-1111-4111-8111-111111111111', '55555555-aaaa-4555-8555-555555555555', 'ORGANIZATION_ADMIN', false, true),
  ('91111111-1111-4111-8111-111111111111', '59999999-9999-4999-8999-999999999999', 'ORGANIZATION_OWNER', true, true);

insert into public.stall_memberships (
  id, organization_id, profile_id, stall_id, role, is_active, updated_at
) values
  ('a6666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '55555555-aaaa-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'STALL_MANAGER', true, now()),
  ('a7777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555552', '82222222-2222-4222-8222-222222222222', 'STAFF', true, now());

insert into public.audit_logs (
  id, organization_id, stall_id, action, entity_type, outcome, request_id
) values (
  'a8888888-8888-4888-8888-888888888888',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'RLS_TEST',
  'STALL',
  'SUCCESS',
  'rls-test-request'
);

set local role authenticated;

select set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
select is(
  (select count(*)::integer from public.stalls),
  2,
  '組織擁有者可讀取自己組織的全部攤位'
);
select is(
  (select count(*)::integer from public.stalls where organization_id = '91111111-1111-4111-8111-111111111111'),
  0,
  '組織擁有者不可讀取其他組織攤位'
);
select is(
  (select count(*)::integer from public.orders where organization_id = '91111111-1111-4111-8111-111111111111'),
  0,
  '跨組織訂單查詢遭 RLS 拒絕'
);

select set_config('request.jwt.claim.sub', 'a5555555-5555-4555-8555-555555555555', true);
select is(
  (select count(*)::integer from public.stalls),
  1,
  '非全攤位組織管理員只看得到已指派攤位'
);
select ok(
  public.has_stall_role(
    '82222222-2222-4222-8222-222222222222',
    array['STALL_MANAGER'::public.user_role]
  ),
  '組織管理員可在已指派攤位執行管理操作'
);

select set_config('request.jwt.claim.sub', 'a4444444-4444-4444-8444-444444444444', true);
select is(
  (select count(*)::integer from public.stalls),
  2,
  '財務檢視者可讀取自己組織的攤位報表範圍'
);
select ok(
  not has_table_privilege(current_user, 'public.orders', 'UPDATE'),
  '財務檢視者沒有訂單寫入權限'
);

select set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222222', true);
select is(
  (select count(*)::integer from public.stalls),
  2,
  '店員可被指派到同組織的多個攤位'
);
select is(
  (select count(*)::integer from public.stalls where organization_id = '91111111-1111-4111-8111-111111111111'),
  0,
  '店員不可讀取未指派攤位'
);
select is(
  (
    select count(*)::integer
    from public.orders
    where stall_id = '92222222-2222-4222-8222-222222222222'
  ),
  0,
  '竄改 stall_id 不會繞過訂單範圍限制'
);
select ok(
  not has_table_privilege(current_user, 'public.orders', 'UPDATE'),
  '店員無法用直接資料庫更新跨攤位訂單'
);

select set_config('request.jwt.claim.sub', 'a3333333-3333-4333-8333-333333333333', true);
select is(
  (select count(*)::integer from public.audit_logs),
  0,
  '廚房角色不可存取組織財務與管理稽核資料'
);
select ok(
  not public.has_organization_role(
    '11111111-1111-4111-8111-111111111111',
    array['FINANCE_VIEWER'::public.user_role]
  ),
  '廚房角色不會取得財務角色'
);

select * from finish();
rollback;
