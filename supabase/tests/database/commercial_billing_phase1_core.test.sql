begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

select is((select count(*)::integer from public.plans), 6, '方案目錄保留 TRIAL 與四種舊方案，並新增 PAYG');
select is((select count(*)::integer from public.plan_versions where version = 1), 6, '每個方案建立第一版合約');
select is((select count(*)::integer from public.subscriptions where plan_version_id is null), 0, '既有訂閱全部綁定方案版本');
select is((select version.trial_days from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'TRIAL' and version.version = 1), 14, '試用版本為十四天');
select is((select version.included_orders from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'TRIAL' and version.version = 1), 100, '試用版本包含一百筆計費訂單');
select is((select version.base_price from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'LITE' and version.version = 1), 399, 'Lite 月費為 TWD 399');
select is((select version.annual_price from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'STANDARD' and version.version = 1), 6990, 'Standard 年費為 TWD 6990');
select is((select version.max_products from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'PRO' and version.version = 1), 1000, 'Pro 商品上限為一千');
select ok((select version.requires_quote and not version.is_public from public.plan_versions version join public.plans plan on plan.id = version.plan_id where plan.code = 'ENTERPRISE' and version.version = 1), 'Enterprise 需報價且不可自行購買');

select ok(exists(
  select 1 from public.plan_entitlements entitlement
  join public.plan_versions version on version.id = entitlement.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'STANDARD' and entitlement.feature_code = 'CSV_EXPORT' and entitlement.is_enabled
), 'Standard 包含 CSV 匯出');
select ok(not exists(
  select 1 from public.plan_entitlements entitlement
  join public.plan_versions version on version.id = entitlement.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'TRIAL' and entitlement.feature_code = 'CSV_EXPORT' and entitlement.is_enabled
), '試用方案不包含 CSV 匯出');
select ok(exists(
  select 1 from public.plan_entitlements entitlement
  join public.plan_versions version on version.id = entitlement.plan_version_id
  join public.plans plan on plan.id = version.plan_id
  where plan.code = 'PRO' and entitlement.feature_code = 'ADVANCED_REPORTS' and entitlement.is_enabled
), 'Pro 包含進階報表');

select is((select count(*)::integer from public.add_on_catalog), 11, '建立十一個 Add-on 目錄項目');
select is((select availability_status from public.add_on_catalog where code = 'ORDER_PACKAGE_STANDARD_500'), 'ENABLED', '人工訂單包在 Phase 1 可用');
select is((select availability_status from public.add_on_catalog where code = 'PRINTER_INTEGRATION'), 'COMING_SOON', '列印訂閱自動化保持未啟用');
select is((select count(*)::integer from public.billing_feature_flags where is_enabled), 2, '只啟用人工計費與開放測試免費模式');
select ok((select is_enabled from public.billing_feature_flags where code = 'MANUAL_BILLING_ENABLED'), '人工計費旗標已啟用');
select ok(not (select is_enabled from public.billing_feature_flags where code = 'ECPAY_BILLING_ENABLED'), 'ECPay 旗標預設關閉');
select ok(not (select is_enabled from public.billing_feature_flags where code = 'E_INVOICE_ENABLED'), '電子發票旗標預設關閉');

select ok(
  (
    select count(*) = 9 and bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'plan_versions', 'plan_entitlements', 'add_on_catalog',
        'subscription_items', 'manual_payment_records', 'billing_usage_summaries',
        'billing_feature_flags', 'billing_notifications', 'notification_outbox'
      ])
  ),
  '所有新增 exposed tables 均啟用並強制 RLS'
);
select ok(not has_table_privilege('anon', 'public.manual_payment_records', 'SELECT'), '匿名不可讀取付款紀錄');
select ok(not has_table_privilege('anon', 'public.billing_notifications', 'SELECT'), '匿名不可讀取帳務通知');
select ok(not has_table_privilege('authenticated', 'public.billing_feature_flags', 'SELECT'), '前端不可直接讀取 server-only flags');
select ok(not has_table_privilege('authenticated', 'public.manual_payment_records', 'UPDATE'), '商家不可直接驗證付款');

insert into public.invoices (
  id, organization_id, subscription_id, status, currency,
  billing_period_start, billing_period_end, due_at
)
select 'ba100000-0000-4000-8000-000000000001', subscription.organization_id,
  subscription.id, 'DRAFT', 'TWD', subscription.billing_period_start,
  subscription.billing_period_end, now() + interval '14 days'
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111';

select matches(
  (select invoice_number from public.invoices where id = 'ba100000-0000-4000-8000-000000000001'),
  '^SO-[0-9]{6}-[0-9]{6}$',
  'Invoice number 由資料庫 sequence 產生'
);

insert into public.invoice_line_items (
  organization_id, invoice_id, item_type, code, description, quantity, unit_price, subtotal
) values (
  '11111111-1111-4111-8111-111111111111',
  'ba100000-0000-4000-8000-000000000001',
  'BASE_PLAN', 'PRO', 'Pro 月繳', 1, 1190, 1190
), (
  '11111111-1111-4111-8111-111111111111',
  'ba100000-0000-4000-8000-000000000001',
  'DISCOUNT', 'MANUAL_DISCOUNT', '人工折抵', 1, 100, 100
);

select is(
  (select subtotal::text || ':' || discount_amount::text || ':' || total_amount::text || ':' || amount_due::text
   from public.invoices where id = 'ba100000-0000-4000-8000-000000000001'),
  '1190:100:1090:1090',
  'Line Item trigger 在伺服器端重算 Invoice 金額'
);

select throws_ok(
  $$insert into public.manual_payment_records (
      organization_id, invoice_id, payment_method, amount, received_at,
      recorded_by_profile_id, idempotency_key
    ) values (
      '99999999-9999-4999-8999-999999999999',
      'ba100000-0000-4000-8000-000000000001', 'CASH', 1090, now(),
      '55555555-5555-4555-8555-555555555551', 'scope-mismatch-payment'
    )$$,
  'P0001', 'BILLING_ORGANIZATION_SCOPE_MISMATCH',
  '跨 Organization Invoice 無法建立付款紀錄'
);

insert into auth.users (id, email) values
  ('ba200000-0000-4000-8000-000000000001', 'billing-owner@stallorder.test'),
  ('ba200000-0000-4000-8000-000000000002', 'billing-staff@stallorder.test');
update public.profiles set auth_user_id = 'ba200000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'ba200000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555552';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ba200000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into public.manual_payment_records (
      organization_id, invoice_id, payment_method, amount, reference_number,
      received_at, recorded_by_profile_id, idempotency_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ba100000-0000-4000-8000-000000000001', 'LINE_PAY_MANUAL', 1090,
      'LINE-P1-REFERENCE', now(), '55555555-5555-4555-8555-555555555551',
      'owner-payment-idempotency'
    )$$,
  'Organization Owner 可送出自身待驗證付款'
);
select is((select count(*)::integer from public.manual_payment_records), 1, 'Owner 只能看到自身組織付款');
select throws_ok(
  $$insert into public.manual_payment_records (
      organization_id, invoice_id, payment_method, amount, received_at,
      recorded_by_profile_id, idempotency_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ba100000-0000-4000-8000-000000000001', 'LINE_PAY_MANUAL', 1090,
      now(), '55555555-5555-4555-8555-555555555551', 'owner-payment-idempotency'
    )$$,
  '23505', null,
  '付款 idempotency key 不可重播'
);

select set_config('request.jwt.claim.sub', 'ba200000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.manual_payment_records), 0, 'Staff 不可讀取付款紀錄');
select throws_ok(
  $$insert into public.manual_payment_records (
      organization_id, invoice_id, payment_method, amount, received_at,
      recorded_by_profile_id, idempotency_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'ba100000-0000-4000-8000-000000000001', 'CASH', 1090,
      now(), '55555555-5555-4555-8555-555555555552', 'staff-payment-attempt'
    )$$,
  'P0001', 'BILLING_ORGANIZATION_SCOPE_MISMATCH',
  'Staff 不可送出付款紀錄'
);

select * from finish();
rollback;
