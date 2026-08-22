begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);

select is((select count(*)::integer from public.plans), 6, '保留試用與四種舊方案，並新增 PAYG 方案');
select is(
  (select included_stalls::text || ':' || coalesce(additional_stall_price::text, 'DISABLED') || ':' || max_stalls::text from public.plans where code = 'LITE'),
  '1:DISABLED:1',
  'Lite 僅含一個攤位且不可加購'
);
select is(
  (select included_stalls::text || ':' || additional_stall_price::text || ':' || max_stalls::text from public.plans where code = 'STANDARD'),
  '1:299:10',
  'Standard 加購攤位單價由資料庫設定為 299'
);
select is(
  (select included_stalls::text || ':' || additional_stall_price::text || ':' || max_stalls::text from public.plans where code = 'PRO'),
  '3:199:50',
  'Pro 內含三個攤位且加購單價為 199'
);
select is(
  (select plan.code from public.subscriptions subscription join public.plans plan on plan.id = subscription.plan_id where subscription.organization_id = '11111111-1111-4111-8111-111111111111'),
  'PAYG',
  '主要示範組織使用現行 PAYG 訂閱'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values (
  '76000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'COMMERCIAL-001', repeat('d', 64),
  '76100000-0000-4000-8000-000000000001', 'STAFF', '商務測試顧客',
  'WAITING_CONFIRMATION', 'UNPAID', 100, repeat('e', 64), repeat('f', 64),
  now() + interval '10 minutes', now(), now()
);
select is(
  (select count(*)::integer from public.usage_events where event_type = 'ORDER_CREATED' and reference_id = '76000000-0000-4000-8000-000000000001'),
  1,
  '每張訂單只建立一筆用量事件'
);
select throws_ok(
  $$insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period, reference_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'ORDER_CREATED', 1, date_trunc('month', now())::date,
      '76000000-0000-4000-8000-000000000001'
    )$$,
  '23505', null,
  '相同訂單 reference 不得重複計量'
);

insert into public.qr_codes (
  id, organization_id, stall_id, token, label, state, token_version, created_at, updated_at
) values (
  '76200000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'commercial-qr-token-only-for-test', '商務測試 QR', 'ACTIVE', 20, now(), now()
);
select is(
  (select count(*)::integer from public.usage_events where event_type = 'QR_CODE_CREATED' and reference_id = '76200000-0000-4000-8000-000000000001'),
  1,
  '新增 QR Code 會建立用量事件'
);

update public.stalls set is_active = false where id = '22222222-2222-4222-8222-222222222222';
select is(
  (select quantity from public.usage_events where event_type = 'ACTIVE_STALL_CHANGED' and stall_id = '22222222-2222-4222-8222-222222222222' order by created_at desc, id desc limit 1),
  -1,
  '停用攤位記錄負向用量'
);
update public.stalls set is_active = true where id = '22222222-2222-4222-8222-222222222222';
select is(
  (select sum(quantity)::integer from public.usage_events where event_type = 'ACTIVE_STALL_CHANGED' and stall_id = '22222222-2222-4222-8222-222222222222'),
  1,
  '停用再啟用後攤位淨用量維持一個啟用攤位'
);

insert into public.stall_memberships (
  id, organization_id, stall_id, profile_id, role, is_active, updated_at
) values (
  '76300000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555552', 'KITCHEN', true, now()
);
delete from public.stall_memberships where id = '76300000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.usage_events where reference_id like 'stall-membership:76300000-0000-4000-8000-000000000001:%'),
  0,
  '同一成員的額外角色新增與刪除皆不重複計數'
);

insert into public.profiles (id, email, display_name, is_active, updated_at) values (
  '76400000-0000-4000-8000-000000000001', 'fresh-member@stallorder.test', '新成員', true, now()
);
insert into public.stall_memberships (
  id, organization_id, stall_id, profile_id, role, is_active, updated_at
) values (
  '76500000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '76400000-0000-4000-8000-000000000001', 'STAFF', true, now()
);
select is(
  (select quantity from public.usage_events where reference_id like 'stall-membership:76500000-0000-4000-8000-000000000001:%' order by created_at desc, id desc limit 1),
  1,
  '第一個有效 membership 將成員用量加一'
);
update public.stall_memberships set is_active = false where id = '76500000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.usage_events where reference_id like 'stall-membership:76500000-0000-4000-8000-000000000001:%' and quantity = -1),
  1,
  '最後一個有效 membership 停用時將成員用量減一'
);

select has_column('public', 'organization_invitations', 'token_hash', '邀請只保留 token 雜湊欄位');
select hasnt_column('public', 'organization_invitations', 'token', '邀請資料表不儲存原始 token');

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  '91000000-0000-4000-8000-000000000001', '其他商務組織', 'other-commercial-org',
  '其他商務組織', 'ACTIVE', 'other-commercial@stallorder.test', '0900-100-001', now()
);
insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  '93000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', id, 'ACTIVE',
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001', '其他商務攤位', 'other-commercial-stall',
  'OTHER-COMM', '測試地址', 'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

insert into public.organization_invitations (
  id, organization_id, email, role, token_hash, expires_at
) values (
  '76600000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111', 'owner-invite@stallorder.test',
  'ORGANIZATION_ADMIN', repeat('a', 64), now() + interval '7 days'
);
insert into public.organization_invitations (
  id, organization_id, stall_id, email, role, token_hash, expires_at
) values (
  '76600000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', 'stall-invite@stallorder.test',
  'STAFF', repeat('b', 64), now() + interval '7 days'
);
insert into public.organization_invitations (
  id, organization_id, email, role, token_hash, expires_at
) values (
  '76600000-0000-4000-8000-000000000003',
  '91000000-0000-4000-8000-000000000001', 'other-invite@stallorder.test',
  'ORGANIZATION_ADMIN', repeat('c', 64), now() + interval '7 days'
);
select is(
  (select count(*)::integer from public.organization_invitations where status = 'PENDING'),
  3,
  '有效邀請以待接受狀態建立'
);
select throws_ok(
  $$insert into public.organization_invitations (
      organization_id, email, role, token_hash, expires_at
    ) values (
      '11111111-1111-4111-8111-111111111111', 'bad-role@stallorder.test',
      'STAFF', repeat('d', 64), now() + interval '7 days'
    )$$,
  '23514', null,
  '攤位角色不得建立為組織範圍邀請'
);
select throws_ok(
  $$insert into public.organization_invitations (
      organization_id, email, role, token_hash, expires_at
    ) values (
      '11111111-1111-4111-8111-111111111111', 'owner-invite@stallorder.test',
      'ORGANIZATION_ADMIN', repeat('e', 64), now() + interval '7 days'
    )$$,
  '23505', null,
  '相同範圍與角色只能有一筆待接受邀請'
);
select throws_ok(
  $$insert into public.organization_invitations (
      organization_id, stall_id, email, role, token_hash, expires_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '92000000-0000-4000-8000-000000000001', 'cross-scope@stallorder.test',
      'STAFF', repeat('f', 64), now() + interval '7 days'
    )$$,
  'P0001', 'COMMERCIAL_ORGANIZATION_SCOPE_MISMATCH',
  '跨組織攤位邀請由資料庫 scope trigger 拒絕'
);
select throws_ok(
  $$insert into public.usage_events (
      organization_id, stall_id, event_type, quantity, billing_period, reference_id
    ) values (
      '91000000-0000-4000-8000-000000000001',
      '22222222-2222-4222-8222-222222222222',
      'CSV_EXPORTED', 1, date_trunc('month', now())::date, 'cross-usage'
    )$$,
  'P0001', 'COMMERCIAL_ORGANIZATION_SCOPE_MISMATCH',
  '跨組織用量事件由資料庫 scope trigger 拒絕'
);

insert into public.invoices (
  id, organization_id, subscription_id, invoice_number, status, currency,
  billing_period_start, billing_period_end, subtotal, total_amount, amount_due, due_at
) select
  '76700000-0000-4000-8000-000000000001', organization_id, id,
  'INV-COMM-001', 'DRAFT', 'TWD', billing_period_start, billing_period_end,
  199, 199, 199, now() + interval '14 days'
from public.subscriptions where organization_id = '11111111-1111-4111-8111-111111111111';
insert into public.invoices (
  id, organization_id, subscription_id, invoice_number, status, currency,
  billing_period_start, billing_period_end, subtotal, total_amount, amount_due, due_at
) select
  '76700000-0000-4000-8000-000000000002', organization_id, id,
  'INV-COMM-OTHER', 'DRAFT', 'TWD', billing_period_start, billing_period_end,
  299, 299, 299, now() + interval '14 days'
from public.subscriptions where organization_id = '91000000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.invoice_line_items (
      organization_id, invoice_id, item_type, code, description, quantity, unit_price, subtotal
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '76700000-0000-4000-8000-000000000001',
      'ADDITIONAL_STALL', 'ADDITIONAL_STALL', '額外攤位', 1, 199, 199
    )$$,
  '正確的發票明細金額可寫入'
);
select throws_ok(
  $$insert into public.invoice_line_items (
      organization_id, invoice_id, item_type, code, description, quantity, unit_price, subtotal
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '76700000-0000-4000-8000-000000000001',
      'ADDITIONAL_STALL', 'ADDITIONAL_STALL', '錯誤金額', 2, 199, 199
    )$$,
  '23514', null,
  '發票明細金額必須等於數量乘單價'
);
select throws_ok(
  $$insert into public.invoices (
      organization_id, subscription_id, invoice_number, status, currency,
      billing_period_start, billing_period_end, subtotal, total_amount, amount_due, due_at
    ) select organization_id, id, 'INV-BAD-TOTAL', 'DRAFT', 'TWD',
      date '2030-01-01', date '2030-02-01', 200, 100, 100, now() + interval '14 days'
    from public.subscriptions where organization_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514', null,
  '發票總額不得低於小計'
);

select lives_ok(
  $$insert into public.audit_logs (
      id, organization_id, action, entity_type, outcome, request_id, before_json, after_json
    ) values (
      '76900000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111', 'COMMERCIAL_AUDIT_TEST',
      'SUBSCRIPTION', 'SUCCESS', 'commercial-audit', '{"status":"TRIALING"}', '{"status":"ACTIVE"}'
    )$$,
  '稽核紀錄可保存結構化前後快照'
);
select throws_ok(
  $$insert into public.audit_logs (
      id, organization_id, action, entity_type, outcome, request_id, before_json
    ) values (
      '76900000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111', 'COMMERCIAL_BAD_AUDIT',
      'SUBSCRIPTION', 'SUCCESS', 'commercial-bad-audit', '[1,2,3]'
    )$$,
  '23514', null,
  '稽核快照只接受 JSON object'
);
select has_column('public', 'audit_logs', 'before_json', '稽核資料含 before_json');
select has_column('public', 'audit_logs', 'after_json', '稽核資料含 after_json');
select ok(
  (
    select count(*) = 7 and bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'plans', 'subscriptions', 'additional_stall_approvals', 'invoices',
        'invoice_line_items', 'usage_events', 'organization_invitations'
      ])
  ),
  '全部商務與邀請資料表均啟用並強制 RLS'
);

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-000000000001', 'commercial-owner@stallorder.test'),
  ('b2000000-0000-4000-8000-000000000001', 'commercial-finance@stallorder.test'),
  ('b3000000-0000-4000-8000-000000000001', 'commercial-kitchen@stallorder.test'),
  ('b4000000-0000-4000-8000-000000000001', 'commercial-manager@stallorder.test');
update public.profiles set auth_user_id = 'b1000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'b3000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555553';
insert into public.profiles (id, auth_user_id, email, display_name, is_active, updated_at) values
  ('76800000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'commercial-finance@stallorder.test', '商務財務', true, now()),
  ('76800000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001', 'commercial-manager@stallorder.test', '商務攤位經理', true, now());
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  '76800000-0000-4000-8000-000000000001', 'FINANCE_VIEWER', true, true
);
insert into public.stall_memberships (
  id, organization_id, stall_id, profile_id, role, is_active, updated_at
) values (
  '76800000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '76800000-0000-4000-8000-000000000002', 'STALL_MANAGER', true, now()
);

set local role authenticated;

select set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.subscriptions), 1, '組織擁有者只讀取自己組織的訂閱');
select is((select count(*)::integer from public.invoices), 1, '組織擁有者只讀取自己組織的發票');
select is(
  (select count(*)::integer from public.organization_invitations where organization_id = '91000000-0000-4000-8000-000000000001'),
  0,
  '組織擁有者不可讀取其他組織邀請'
);
select is((select count(*)::integer from public.organization_invitations), 2, '組織擁有者可讀取自己組織全部邀請');
select ok(
  not has_table_privilege(current_user, 'public.organization_invitations', 'INSERT'),
  '登入使用者不可直接寫入邀請'
);

select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.invoices), 0, '財務檢視者不可直接讀取擁有者帳務發票');
select ok(not has_table_privilege(current_user, 'public.invoices', 'UPDATE'), '財務檢視者不能修改發票');

select set_config('request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.subscriptions), 0, '廚房不可讀取訂閱');
select is((select count(*)::integer from public.usage_events), 0, '廚房不可讀取商務用量');

select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.organization_invitations), 1, '攤位經理只讀取已指派攤位邀請');
select is(
  (select count(*)::integer from public.organization_invitations where stall_id is null),
  0,
  '攤位經理不可讀取組織層邀請'
);

select * from finish();
rollback;
