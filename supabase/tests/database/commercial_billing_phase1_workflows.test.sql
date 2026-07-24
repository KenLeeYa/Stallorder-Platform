begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.billing_change_requests'::regclass),
  '帳務申請表啟用並強制 RLS'
);
select ok(not has_table_privilege('anon', 'public.billing_change_requests', 'SELECT'), '匿名角色沒有帳務申請讀取權');
select ok(not has_table_privilege('authenticated', 'public.billing_change_requests', 'UPDATE'), '商家角色不能直接核准帳務申請');

insert into auth.users (id, email) values
  ('bd000000-0000-4000-8000-000000000001', 'workflow-owner@stallorder.test'),
  ('bd000000-0000-4000-8000-000000000002', 'workflow-staff@stallorder.test'),
  ('bd000000-0000-4000-8000-000000000003', 'workflow-finance@stallorder.test'),
  ('bd000000-0000-4000-8000-000000000004', 'workflow-platform@stallorder.test');

update public.profiles set auth_user_id = 'bd000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'bd000000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555552';
insert into public.profiles (id, auth_user_id, email, display_name, is_active) values
  ('bd100000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000003', 'workflow-finance@stallorder.test', '帳務財務測試', true),
  ('bd100000-0000-4000-8000-000000000004', 'bd000000-0000-4000-8000-000000000004', 'workflow-platform@stallorder.test', '平台管理測試', true);
update public.profiles set platform_role = 'PLATFORM_ADMIN'
where id = 'bd100000-0000-4000-8000-000000000004';
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_primary_owner, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  'bd100000-0000-4000-8000-000000000003',
  'FINANCE_VIEWER', true, false, true
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone
) values (
  'bd200000-0000-4000-8000-000000000002', '其他帳務組織', 'billing-workflow-other',
  '其他帳務組織', 'ACTIVE', 'billing-workflow-other@stallorder.test', '0900000999'
);
insert into public.subscriptions (
  id, organization_id, plan_id, plan_version_id, status, billing_interval,
  billing_period_start, billing_period_end
)
select 'bd300000-0000-4000-8000-000000000002', 'bd200000-0000-4000-8000-000000000002',
  plan.id, version.id, 'ACTIVE', 'MONTHLY', date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans plan
join public.plan_versions version on version.plan_id = plan.id and version.version = 1
where plan.code = 'STANDARD';
insert into public.billing_change_requests (
  organization_id, subscription_id, request_type, requested_quantity, reason, requested_by_profile_id
) values (
  'bd200000-0000-4000-8000-000000000002', 'bd300000-0000-4000-8000-000000000002',
  'ADDITIONAL_STALL', 1, '其他組織測試', 'bd100000-0000-4000-8000-000000000004'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into public.billing_change_requests (
      organization_id, subscription_id, request_type, requested_plan_version_id,
      requested_billing_interval, reason, requested_by_profile_id
    )
    select subscription.organization_id, subscription.id, 'PLAN_CHANGE', version.id,
      'MONTHLY', 'Owner 方案升級', '55555555-5555-4555-8555-555555555551'
    from public.subscriptions subscription
    join public.plan_versions version on version.plan_id = (select id from public.plans where code = 'STANDARD')
      and version.version = 1
    where subscription.organization_id = '11111111-1111-4111-8111-111111111111'$$,
  'Organization Owner 可建立自身待審核方案申請'
);
select is((select count(*)::integer from public.billing_change_requests), 1, 'Owner 只能看到自身組織申請');
select throws_ok(
  $$insert into public.billing_change_requests (
      organization_id, subscription_id, request_type, requested_plan_version_id,
      requested_billing_interval, reason, requested_by_profile_id
    )
    select subscription.organization_id, subscription.id, 'PLAN_CHANGE', version.id,
      'MONTHLY', '重複申請', '55555555-5555-4555-8555-555555555551'
    from public.subscriptions subscription
    join public.plan_versions version on version.plan_id = (select id from public.plans where code = 'LITE')
      and version.version = 1
    where subscription.organization_id = '11111111-1111-4111-8111-111111111111'$$,
  '23505', null,
  '同組織同類型只能有一筆待審核申請'
);

select set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.billing_change_requests), 0, 'Staff 不可讀取帳務申請');
select throws_ok(
  $$insert into public.billing_change_requests (
      organization_id, subscription_id, request_type, requested_quantity, reason, requested_by_profile_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      (select id from public.subscriptions where organization_id = '11111111-1111-4111-8111-111111111111'),
      'ADDITIONAL_STALL', 1, 'Staff 嘗試', '55555555-5555-4555-8555-555555555552'
    )$$,
  '42501', null,
  'Staff 不可建立帳務申請'
);

select set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.billing_change_requests), 1, 'Finance Viewer 可讀自身組織帳務申請');
select throws_ok(
  $$insert into public.billing_change_requests (
      organization_id, subscription_id, request_type, requested_quantity, reason, requested_by_profile_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      (select id from public.subscriptions where organization_id = '11111111-1111-4111-8111-111111111111'),
      'ADDITIONAL_STALL', 1, 'Finance 嘗試', 'bd100000-0000-4000-8000-000000000003'
    )$$,
  '42501', null,
  'Finance Viewer 只有讀取權'
);

select set_config('request.jwt.claim.sub', 'bd000000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.billing_change_requests), 2, 'Platform Admin 可讀跨組織帳務申請');

reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.billing_change_requests$$,
  '42501', null,
  '匿名角色完全不能查詢帳務申請'
);
reset role;

select throws_ok(
  $$insert into public.billing_change_requests (
      organization_id, subscription_id, request_type, requested_quantity,
      requested_billing_interval, reason, requested_by_profile_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      (select id from public.subscriptions where organization_id = '11111111-1111-4111-8111-111111111111'),
      'ADDITIONAL_STALL', 1, 'MONTHLY', '錯誤 payload', '55555555-5555-4555-8555-555555555551'
    )$$,
  '23514', null,
  '帳務申請 payload 必須符合申請類型'
);

insert into public.invoices (
  id, organization_id, subscription_id, status, currency,
  billing_period_start, billing_period_end, due_at
) values (
  'bd400000-0000-4000-8000-000000000001',
  'bd200000-0000-4000-8000-000000000002',
  'bd300000-0000-4000-8000-000000000002', 'DRAFT', 'TWD',
  date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month')::date,
  now() + interval '7 days'
);
insert into public.invoice_line_items (
  organization_id, invoice_id, item_type, code, description, quantity, unit_price, subtotal
) values (
  'bd200000-0000-4000-8000-000000000002',
  'bd400000-0000-4000-8000-000000000001',
  'CUSTOM_SERVICE', 'DELETE_TEST', '刪除測試', 1, 100, 100
);
select lives_ok(
  $$delete from public.organizations where id = 'bd200000-0000-4000-8000-000000000002'$$,
  'Organization cascade 刪除帳單明細時不重算已刪除父帳單'
);

select lives_ok(
  $$insert into public.billing_notifications (
      organization_id, notification_type, title, message, entity_type, entity_id, dedupe_key
    ) values (
      '11111111-1111-4111-8111-111111111111', 'ADDITIONAL_STALL_APPROVED',
      '額外攤位已核准', '測試通知', 'ORGANIZATION',
      '11111111-1111-4111-8111-111111111111', 'workflow-notification-test'
    )$$,
  'P3 工作流程通知類型可安全寫入'
);

select * from finish();
rollback;
