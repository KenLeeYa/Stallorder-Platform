begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

update public.billing_feature_flags
set is_enabled = false
where code = 'OPEN_BETA_FREE_ACCESS_ENABLED';

create temporary table billing_test_baseline on commit drop as
select coalesce((
  select billable_order_count
  from public.billing_usage_summaries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and billing_period = date_trunc('month', now())::date
), 0)::integer as billable_order_count;

select is(
  public.billing_order_access_code('11111111-1111-4111-8111-111111111111', false),
  'OK',
  'active paid subscription can accept orders'
);

update public.plan_versions version
set included_stalls = 1, max_stalls = 50
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

select throws_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, location,
      is_active, created_at, updated_at
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111', 'Extra Stall',
      'billing-extra-stall-denied', 'BILL-DENIED', 'Taipei', 'Taipei',
      true, now(), now()
    )$$,
  'P0001', 'ADDITIONAL_STALL_APPROVAL_REQUIRED',
  'stall beyond included quantity needs approval'
);

insert into public.additional_stall_approvals (
  organization_id, subscription_id, quantity, unit_price, status, reason
)
select subscription.organization_id, subscription.id, 1, 199, 'APPROVED', 'pgtap'
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, location,
      is_active, created_at, updated_at
    ) values (
      'c1000000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111', 'Approved Stall',
      'billing-extra-stall-approved', 'BILL-APPROVED', 'Taipei', 'Taipei',
      true, now(), now()
    )$$,
  'approved additional stall is accepted transactionally'
);

update public.plan_versions version
set included_stalls = 2, max_stalls = 2
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

select throws_ok(
  $$insert into public.stalls (
      id, organization_id, name, slug, code, address, location,
      is_active, created_at, updated_at
    ) values (
      'c1000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111', 'Over Limit Stall',
      'billing-stall-plan-limit', 'BILL-LIMIT', 'Taipei', 'Taipei',
      true, now(), now()
    )$$,
  'P0001', 'PLAN_LIMIT_REACHED',
  'absolute stall limit is enforced'
);

update public.plan_versions version
set max_products = 4
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

select throws_ok(
  $$insert into public.products (
      id, organization_id, category_id, name, description, default_price,
      is_active, sort_order, created_at, updated_at
    ) values (
      'c2000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777771', 'Over Limit Product', '', 10,
      true, 99, now(), now()
    )$$,
  'P0001', 'PLAN_LIMIT_REACHED',
  'product count limit is enforced'
);

update public.plan_versions version
set max_qr_codes = 2
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

select throws_ok(
  $$insert into public.qr_codes (
      id, organization_id, stall_id, token, label, state, token_version,
      created_at, updated_at
    ) values (
      'c3000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'billing-qr-over-plan-limit', 'Over Limit QR', 'ACTIVE', 99, now(), now()
    )$$,
  'P0001', 'PLAN_LIMIT_REACHED',
  'QR count limit is enforced'
);

insert into public.profiles (
  id, email, password_hash, display_name, is_active, created_at, updated_at
) values (
  'c4000000-0000-4000-8000-000000000001', 'limit-staff@stallorder.test',
  null, 'Limit Staff', true, now(), now()
);
update public.plan_versions version
set max_staff = 2
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

select throws_ok(
  $$insert into public.stall_memberships (
      id, organization_id, profile_id, stall_id, role, is_active,
      created_at, updated_at
    ) values (
      'c4000000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      'c4000000-0000-4000-8000-000000000001',
      '22222222-2222-4222-8222-222222222222', 'STAFF', true, now(), now()
    )$$,
  'P0001', 'PLAN_LIMIT_REACHED',
  'distinct staff count limit is enforced'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values (
  'c5000000-0000-4000-8000-000000000001', 'Trial Expiry', 'billing-trial-expiry',
  'Trial Expiry', 'TRIALING', 'trial-expiry@stallorder.test', '0900000001',
  'Asia/Taipei', 'TWD', now(), now()
), (
  'c5000000-0000-4000-8000-000000000002', 'Trial Limit', 'billing-trial-limit',
  'Trial Limit', 'TRIALING', 'trial-limit@stallorder.test', '0900000002',
  'Asia/Taipei', 'TWD', now(), now()
);

insert into public.subscriptions (
  organization_id, plan_id, status, billing_period_start, billing_period_end,
  trial_started_at, trial_ends_at
)
select organization_id, plan.id, 'TRIALING', current_date,
  current_date + 14, now() - interval '1 day', now() + interval '13 days'
from (values
  ('c5000000-0000-4000-8000-000000000001'::uuid),
  ('c5000000-0000-4000-8000-000000000002'::uuid)
) organizations(organization_id)
cross join public.plans plan
where plan.code = 'TRIAL';

select is(
  public.billing_order_access_code('c5000000-0000-4000-8000-000000000001', false),
  'OK', 'unexpired trial can accept orders'
);

update public.subscriptions
set trial_ends_at = now() - interval '1 minute'
where organization_id = 'c5000000-0000-4000-8000-000000000001';

select is(
  public.billing_order_access_code('c5000000-0000-4000-8000-000000000001', false),
  'TRIAL_EXPIRED', 'expired trial is denied before scheduled reconciliation'
);
select is(public.expire_billing_trials(), 1, 'trial expiration job changes one subscription');
select is(
  (select status from public.subscriptions where organization_id = 'c5000000-0000-4000-8000-000000000001'),
  'SUSPENDED', 'expired trial subscription becomes suspended'
);
select is(
  (select status::text from public.organizations where id = 'c5000000-0000-4000-8000-000000000001'),
  'SUSPENDED', 'expired trial organization operational gate becomes suspended'
);
select ok(exists(
  select 1 from public.billing_notifications
  where organization_id = 'c5000000-0000-4000-8000-000000000001'
    and notification_type = 'TRIAL_EXPIRED'
), 'trial expiration creates an in-app notification');

insert into public.usage_events (
  organization_id, event_type, quantity, billing_period,
  reference_type, reference_id, occurred_at
)
select 'c5000000-0000-4000-8000-000000000002',
  'BILLABLE_ORDER_COMPLETED', 1, date_trunc('month', now())::date,
  'ORDER', 'trial-hard-limit-' || series::text, now()
from generate_series(1, 100) series;

select is(
  public.billing_order_access_code('c5000000-0000-4000-8000-000000000002', false),
  'TRIAL_ORDER_LIMIT_REACHED', 'trial hard limit denies the next order'
);

update public.plan_versions version
set included_stalls = 3, max_stalls = 50, max_staff = 15,
  max_products = 1000, max_qr_codes = 20, included_orders = 1
from public.subscriptions subscription
where subscription.organization_id = '11111111-1111-4111-8111-111111111111'
  and version.id = subscription.plan_version_id;

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, confirmed_at,
  created_at, updated_at
) values (
  'c6000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', 'BILL-001',
  repeat('a', 64), 'c6000000-0000-4000-8000-000000000011',
  'STAFF_POS', 'Billing Test', 'CONFIRMED', 'UNPAID', 100, 100,
  'billing-device', now(), now(), now(), now()
);

select is((
  select count(*)::integer from public.usage_events
  where event_type = 'BILLABLE_ORDER_COMPLETED'
    and reference_id = 'c6000000-0000-4000-8000-000000000001'
), 0, 'confirmed order is not billable yet');

update public.orders set status = 'COMPLETED', completed_at = now(), updated_at = now()
where id = 'c6000000-0000-4000-8000-000000000001';
select is((
  select count(*)::integer from public.usage_events
  where event_type = 'BILLABLE_ORDER_COMPLETED'
    and reference_id = 'c6000000-0000-4000-8000-000000000001'
), 1, 'first completion creates one billable event');

update public.orders set status = 'READY', updated_at = now()
where id = 'c6000000-0000-4000-8000-000000000001';
update public.orders set status = 'COMPLETED', completed_at = now(), updated_at = now()
where id = 'c6000000-0000-4000-8000-000000000001';
select is((
  select count(*)::integer from public.usage_events
  where event_type = 'BILLABLE_ORDER_COMPLETED'
    and reference_id = 'c6000000-0000-4000-8000-000000000001'
), 1, 'repeated completion cannot create a duplicate billable event');

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, cancelled_at,
  created_at, updated_at
) values (
  'c6000000-0000-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', 'BILL-002',
  repeat('b', 64), 'c6000000-0000-4000-8000-000000000012',
  'STAFF_POS', 'Cancelled Test', 'CANCELLED', 'UNPAID', 100, 100,
  'billing-device', now(), now(), now(), now()
);
select is((
  select count(*)::integer from public.usage_events
  where event_type = 'BILLABLE_ORDER_COMPLETED'
    and reference_id = 'c6000000-0000-4000-8000-000000000002'
), 0, 'cancelled order never becomes billable');

select is((
  select count(*)::integer from public.billing_notifications
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and notification_type in ('USAGE_80_PERCENT', 'USAGE_90_PERCENT', 'USAGE_100_PERCENT')
), 3, 'paid usage creates 80, 90, and 100 percent warnings');

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status,
  subtotal, total, device_hash, confirmation_expires_at, confirmed_at,
  created_at, updated_at
) values (
  'c6000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', 'BILL-003',
  repeat('c', 64), 'c6000000-0000-4000-8000-000000000013',
  'STAFF_POS', 'Soft Limit Test', 'CONFIRMED', 'UNPAID', 100, 100,
  'billing-device', now(), now(), now(), now()
);
update public.orders set status = 'COMPLETED', completed_at = now(), updated_at = now()
where id = 'c6000000-0000-4000-8000-000000000003';
select lives_ok(
  $$select public.billing_order_access_code('11111111-1111-4111-8111-111111111111', false)$$,
  'paid plan remains callable above included quota'
);
select is(
  public.billing_order_access_code('11111111-1111-4111-8111-111111111111', false),
  'OK', 'paid soft limit continues accepting orders'
);
select ok(exists(
  select 1 from public.billing_notifications
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and notification_type = 'USAGE_110_PERCENT'
), 'paid usage above 110 percent creates upgrade recommendation');
select is((
  select summary.billable_order_count - baseline.billable_order_count
  from public.billing_usage_summaries summary
  cross join billing_test_baseline baseline
  where summary.organization_id = '11111111-1111-4111-8111-111111111111'
    and summary.billing_period = date_trunc('month', now())::date
), 2, 'usage summary adds two unique completed-order events');

update public.subscriptions set status = 'SUSPENDED', suspended_at = now()
where organization_id = '11111111-1111-4111-8111-111111111111';
update public.organizations set status = 'SUSPENDED'
where id = '11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$insert into public.order_sessions (
      id, organization_id, stall_id, qr_code_id, token_hash, device_hash,
      ip_hash, status, expires_at, created_at
    ) values (
      'c7000000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', repeat('d', 64),
      repeat('e', 64), repeat('f', 64), 'ACTIVE', now() + interval '10 minutes', now()
    )$$,
  'P0001', 'SUBSCRIPTION_SUSPENDED',
  'suspended subscription blocks new order sessions'
);
select throws_ok(
  $$insert into public.orders (
      id, organization_id, stall_id, order_no, tracking_token_hash,
      idempotency_key, source, customer_name, status, payment_status,
      subtotal, total, device_hash, confirmation_expires_at, created_at, updated_at
    ) values (
      'c7000000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', 'BILL-SUSPENDED',
      repeat('d', 64), 'c7000000-0000-4000-8000-000000000012',
      'STAFF_POS', 'Suspended', 'CONFIRMED', 'UNPAID', 100, 100,
      'device', now(), now(), now()
    )$$,
  'P0001', 'SUBSCRIPTION_SUSPENDED',
  'suspended subscription blocks new staff orders too'
);
select is((
  select count(*)::integer from public.orders
  where id in (
    'c6000000-0000-4000-8000-000000000001',
    'c6000000-0000-4000-8000-000000000002',
    'c6000000-0000-4000-8000-000000000003'
  )
), 3, 'suspension preserves historical orders');

update public.subscriptions set status = 'ACTIVE', suspended_at = null
where organization_id = '11111111-1111-4111-8111-111111111111';
update public.organizations set status = 'ACTIVE'
where id = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$insert into public.subscription_items (
      organization_id, subscription_id, item_type, code, description,
      quantity, unit_price, currency, status
    ) select organization_id, id, 'ORDER_PACKAGE', 'ORDER_PACKAGE_PRO_1000',
      'Pro order package', 1, 300, 'TWD', 'ACTIVE'
      from public.subscriptions
      where organization_id = '11111111-1111-4111-8111-111111111112'$$,
  'matching paid order package can be assigned'
);
select throws_ok(
  $$insert into public.subscription_items (
      organization_id, subscription_id, item_type, code, description,
      quantity, unit_price, currency, status
    ) select organization_id, id, 'ORDER_PACKAGE', 'ORDER_PACKAGE_PRO_1000',
      'Wrong price', 1, 1, 'TWD', 'ACTIVE'
      from public.subscriptions
      where organization_id = '11111111-1111-4111-8111-111111111112'$$,
  'P0001', 'SERVER_PRICE_MISMATCH',
  'order package price is server-controlled'
);
select throws_ok(
  $$insert into public.subscription_items (
      organization_id, subscription_id, item_type, code, description,
      quantity, unit_price, currency, status
    ) select organization_id, id, 'ORDER_PACKAGE', 'ORDER_PACKAGE_STANDARD_500',
      'Wrong plan', 1, 250, 'TWD', 'ACTIVE'
      from public.subscriptions
      where organization_id = '11111111-1111-4111-8111-111111111112'$$,
  'P0001', 'UPGRADE_REQUIRED',
  'order package must match the paid plan'
);
select throws_ok(
  $$insert into public.subscription_items (
      organization_id, subscription_id, item_type, code, description,
      quantity, unit_price, currency, status
    ) select organization_id, id, 'ORDER_PACKAGE', 'ORDER_PACKAGE_LITE_100',
      'Trial package', 1, 100, 'TWD', 'ACTIVE'
      from public.subscriptions
      where organization_id = 'c5000000-0000-4000-8000-000000000002'$$,
  'P0001', 'UPGRADE_REQUIRED',
  'trial subscription cannot bypass hard limit with an order package'
);

select lives_ok(
  $$select public.rebuild_billing_usage_summary(
      '11111111-1111-4111-8111-111111111111', current_date,
      '55555555-5555-4555-8555-555555555551', 'pgtap-usage-rebuild'
    )$$,
  'trusted usage reconciliation can be manually triggered'
);
select ok(exists(
  select 1 from public.audit_logs
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and action = 'USAGE_REBUILT' and request_id = 'pgtap-usage-rebuild'
), 'manual usage reconciliation writes an audit event');
select is((
  select count(*)::integer from cron.job
  where jobname in (
    'stallorder-billing-trial-expiration',
    'stallorder-billing-invoice-overdue'
  )
), 2, 'database-only billing maintenance jobs are scheduled once');
select ok(
  not has_function_privilege(
    'anon', 'public.billing_order_access_code(uuid,boolean)', 'EXECUTE'
  ),
  'anonymous users cannot call the entitlement decision function'
);

select * from finish();
rollback;
