begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

delete from public.payments where stall_id = '22222222-2222-4222-8222-222222222222';
delete from public.cash_shifts where stall_id = '22222222-2222-4222-8222-222222222222';

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.cash_shifts'::regclass,
     'public.cash_movements'::regclass,
     'public.cash_shift_reviews'::regclass
   )),
  'all cash reconciliation tables enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.cash_shifts', 'SELECT')
  and not has_table_privilege('anon', 'public.cash_movements', 'INSERT')
  and not has_table_privilege('anon', 'public.cash_shift_reviews', 'INSERT'),
  'anonymous clients cannot read or write cash reconciliation data'
);
select ok(
  has_table_privilege('authenticated', 'public.cash_shifts', 'SELECT')
  and has_table_privilege('authenticated', 'public.cash_movements', 'SELECT')
  and has_table_privilege('authenticated', 'public.cash_shift_reviews', 'SELECT')
  and not has_table_privilege('authenticated', 'public.cash_shifts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.cash_shift_reviews', 'UPDATE'),
  'authenticated clients are read-only behind RLS'
);
select ok(
  (select bool_and(is_enabled) from public.plan_entitlements where feature_code = 'CASH_SHIFT'),
  'cash shifts are enforced by enabled server-side entitlements'
);
select ok(
  not (select entitlement.is_enabled
       from public.plan_entitlements entitlement
       join public.plan_versions version on version.id = entitlement.plan_version_id
       join public.plans plan on plan.id = version.plan_id
       where plan.code = 'LITE' and entitlement.feature_code = 'CASH_RECONCILIATION'
         and version.effective_until is null)
  and (select bool_and(entitlement.is_enabled)
       from public.plan_entitlements entitlement
       join public.plan_versions version on version.id = entitlement.plan_version_id
       join public.plans plan on plan.id = version.plan_id
       where plan.code in ('STANDARD', 'PRO', 'ENTERPRISE')
         and entitlement.feature_code = 'CASH_RECONCILIATION'
         and version.effective_until is null),
  'manager reconciliation follows plan entitlements'
);
select is(
  (select array_agg(enumlabel order by enumsortorder)::text
   from pg_enum where enumtypid = 'public.cash_shift_status'::regtype),
  '{OPEN,CLOSED,CLOSING,REVIEW_REQUIRED}',
  'cash shift status enum includes close and review states'
);
select ok(
  (select array_agg(enumlabel::text order by enumsortorder) @> array['OPENING_FLOAT','CASH_SALE','CASH_REFUND','CORRECTION']::text[]
   from pg_enum where enumtypid = 'public.cash_movement_type'::regtype),
  'cash movement enum covers opening, sales, refunds and corrections'
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '84200000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '現金隔離測試攤位', 'cash-isolation-stall', 'CASH-ISO', '台北市測試路 42 號',
  'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

insert into public.cash_shifts (
  id, organization_id, stall_id, opening_amount, opened_by
) values
  (
    '84100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 2000,
    '55555555-5555-4555-8555-555555555551'
  ),
  (
    '84100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '84200000-0000-4000-8000-000000000001', 1000,
    '55555555-5555-4555-8555-555555555551'
  );

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values
  (
    '84300000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'CASH-001', repeat('1', 64),
    '84300000-0000-4000-8000-000000000011', 'STAFF', '現金測試顧客',
    'COMPLETED', 'PAID', 180, repeat('2', 64), repeat('3', 64),
    now() + interval '10 minutes', now(), now()
  ),
  (
    '84300000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'CASH-002', repeat('4', 64),
    '84300000-0000-4000-8000-000000000012', 'STAFF', '非現金測試顧客',
    'COMPLETED', 'PAID', 100, repeat('5', 64), repeat('6', 64),
    now() + interval '10 minutes', now(), now()
  );

select throws_ok(
  $$insert into public.payments (
      id, organization_id, stall_id, order_id, amount, method, status, paid_at
    ) values (
      '84400000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84300000-0000-4000-8000-000000000001', 180, 'CASH', 'PAID', now()
    )$$,
  'P0001', 'ACTIVE_CASH_SHIFT_REQUIRED',
  'paid cash cannot be recorded without an active shift binding'
);
select lives_ok(
  $$insert into public.payments (
      id, organization_id, stall_id, order_id, cash_shift_id,
      amount, method, status, paid_at, recorded_by
    ) values (
      '84400000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84300000-0000-4000-8000-000000000001',
      '84100000-0000-4000-8000-000000000001',
      180, 'CASH', 'PAID', now(), '55555555-5555-4555-8555-555555555552'
    )$$,
  'paid cash is recorded when bound to the open stall shift'
);
select is(
  (select cash_shift_id from public.payments where id = '84400000-0000-4000-8000-000000000001'),
  '84100000-0000-4000-8000-000000000001'::uuid,
  'cash payment permanently stores its shift association'
);
select is(
  (select amount from public.cash_movements
   where reference_id = '84400000-0000-4000-8000-000000000001' and type = 'CASH_SALE'),
  180,
  'cash payment automatically creates one sale ledger entry'
);
select throws_ok(
  $$insert into public.payments (
      organization_id, stall_id, order_id, cash_shift_id, amount, method, status
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84300000-0000-4000-8000-000000000002',
      '84100000-0000-4000-8000-000000000001', 100, 'OTHER', 'PAID'
    )$$,
  'P0001', 'NON_CASH_PAYMENT_CANNOT_HAVE_CASH_SHIFT',
  'non-cash payment cannot pollute a cash shift'
);
select lives_ok(
  $$insert into public.payments (
      id, organization_id, stall_id, order_id, amount, method, status
    ) values (
      '84400000-0000-4000-8000-000000000002',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84300000-0000-4000-8000-000000000002', 100, 'OTHER', 'PAID'
    )$$,
  'non-cash payment remains independent of a cash shift'
);
select throws_ok(
  $$update public.payments
    set cash_shift_id = '84100000-0000-4000-8000-000000000002'
    where id = '84400000-0000-4000-8000-000000000001'$$,
  'P0001', 'PAYMENT_CASH_SHIFT_IMMUTABLE',
  'a payment cannot be moved to another shift after insertion'
);

delete from public.payments where id = '84400000-0000-4000-8000-000000000002';
insert into public.payments (
  id, organization_id, stall_id, order_id, amount, method, status
) values (
  '84400000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '84300000-0000-4000-8000-000000000002', 100, 'CASH', 'REFUNDED'
);
select throws_ok(
  $$update public.payments set status = 'PAID'
    where id = '84400000-0000-4000-8000-000000000003'$$,
  'P0001', 'ACTIVE_CASH_SHIFT_REQUIRED',
  'a refunded cash payment cannot return to paid without a bound open shift'
);
delete from public.payments where id = '84400000-0000-4000-8000-000000000003';

insert into public.payments (
  id, organization_id, stall_id, order_id, cash_shift_id,
  amount, method, status, recorded_by
) values (
  '84400000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '84300000-0000-4000-8000-000000000002',
  '84100000-0000-4000-8000-000000000001',
  100, 'CASH', 'REFUNDED', '55555555-5555-4555-8555-555555555552'
);
select lives_ok(
  $$update public.payments set status = 'PAID'
    where id = '84400000-0000-4000-8000-000000000003'$$,
  'a refunded cash payment may return to paid when already bound to the open shift'
);
select is(
  (select amount from public.cash_movements
   where reference_id = '84400000-0000-4000-8000-000000000003'
     and type = 'CASH_SALE'),
  100,
  'transitioning a bound cash payment to paid creates its sale ledger entry'
);
select throws_ok(
  $$update public.payments set amount = 101
    where id = '84400000-0000-4000-8000-000000000003'$$,
  'P0001', 'PAYMENT_CASH_SHIFT_IMMUTABLE',
  'a paid cash amount cannot diverge from its immutable sale ledger entry'
);
delete from public.cash_movements
where reference_id = '84400000-0000-4000-8000-000000000003';
delete from public.payments where id = '84400000-0000-4000-8000-000000000003';

insert into public.cash_movements (
  organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
) values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '84100000-0000-4000-8000-000000000001', 'CASH_IN', 500, '追加備用金', '55555555-5555-4555-8555-555555555552'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '84100000-0000-4000-8000-000000000001', 'CASH_OUT', 100, '採買支出', '55555555-5555-4555-8555-555555555552');
update public.payments set status = 'REFUNDED'
where id = '84400000-0000-4000-8000-000000000001';
insert into public.cash_movements (
  organization_id, stall_id, cash_shift_id, type, amount, reason,
  reference_type, reference_id, recorded_by
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '84100000-0000-4000-8000-000000000001', 'CASH_REFUND', 180, '顧客退款',
  'PAYMENT', '84400000-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555552'
);
select is(
  (select 2000
    + coalesce(sum(amount) filter (where type in ('CASH_SALE', 'CASH_IN')), 0)
    - coalesce(sum(amount) filter (where type in ('CASH_OUT', 'CASH_REFUND')), 0)
   from public.cash_movements where cash_shift_id = '84100000-0000-4000-8000-000000000001'),
  2400::bigint,
  'expected cash includes sales, refunds, cash in and cash out'
);
select is(
  (select count(*)::integer from public.cash_movements
   where cash_shift_id = '84100000-0000-4000-8000-000000000001' and type = 'CASH_REFUND'),
  1,
  'cash refund is a separate immutable ledger entry'
);
select throws_ok(
  $$insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '84200000-0000-4000-8000-000000000001',
      '84100000-0000-4000-8000-000000000001', 'CASH_IN', 10, '跨攤位',
      '55555555-5555-4555-8555-555555555552'
    )$$,
  'P0001', 'CASH_MOVEMENT_SCOPE_MISMATCH',
  'cash movement scope cannot cross stalls'
);

update public.cash_shifts
set status = 'CLOSING', system_expected_amount = 2400, counted_amount = 2300,
    variance_amount = -100, closed_at = now(), closed_by = '55555555-5555-4555-8555-555555555552'
where id = '84100000-0000-4000-8000-000000000001';
select app_private.refresh_cash_shift_alerts();
select ok(
  exists (select 1 from public.operational_alerts
          where stall_id = '22222222-2222-4222-8222-222222222222'
            and alert_type = 'CASH_OVER_SHORT' and status = 'ACTIVE'),
  'cash difference creates an operational alert'
);
select throws_ok(
  $$insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84100000-0000-4000-8000-000000000001', 'CASH_IN', 10, '結班後收入',
      '55555555-5555-4555-8555-555555555552'
    )$$,
  'P0001', 'CASH_SHIFT_LEDGER_LOCKED',
  'ordinary cash movement is locked while awaiting review'
);
select throws_ok(
  $$insert into public.cash_shift_reviews (
      organization_id, stall_id, cash_shift_id, reviewed_by_profile_id, decision
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84100000-0000-4000-8000-000000000001',
      '55555555-5555-4555-8555-555555555551', 'ADJUSTMENT_REQUIRED'
    )$$,
  '23514', null,
  'review rejection or adjustment requires a comment'
);
insert into public.cash_shift_reviews (
  organization_id, stall_id, cash_shift_id, reviewed_by_profile_id, decision, comment
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '84100000-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555551', 'ADJUSTMENT_REQUIRED', '補登零用金'
);
update public.cash_shifts set status = 'REVIEW_REQUIRED'
where id = '84100000-0000-4000-8000-000000000001';
select lives_ok(
  $$insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84100000-0000-4000-8000-000000000001', 'CORRECTION', 100, '補登零用金',
      '55555555-5555-4555-8555-555555555551'
    )$$,
  'review-required shift accepts a reasoned correction'
);
select throws_ok(
  $$insert into public.cash_movements (
      organization_id, stall_id, cash_shift_id, type, amount, reason, recorded_by
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '84100000-0000-4000-8000-000000000001', 'CASH_IN', 10, '錯誤類型',
      '55555555-5555-4555-8555-555555555551'
    )$$,
  'P0001', 'ONLY_CORRECTION_ALLOWED_DURING_REVIEW',
  'only corrections can be posted during review'
);
select throws_ok(
  $$insert into public.cash_shift_reviews (
      organization_id, stall_id, cash_shift_id, reviewed_by_profile_id, decision
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '84200000-0000-4000-8000-000000000001',
      '84100000-0000-4000-8000-000000000001',
      '55555555-5555-4555-8555-555555555551', 'APPROVED'
    )$$,
  'P0001', 'CASH_SHIFT_REVIEW_SCOPE_MISMATCH',
  'cash shift review cannot cross stalls'
);
update public.cash_shifts
set status = 'CLOSING', system_expected_amount = 2500, variance_amount = -200
where id = '84100000-0000-4000-8000-000000000001';
insert into public.cash_shift_reviews (
  organization_id, stall_id, cash_shift_id, reviewed_by_profile_id, decision
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '84100000-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555551', 'APPROVED'
);
update public.cash_shifts set status = 'CLOSED'
where id = '84100000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.cash_shifts where id = '84100000-0000-4000-8000-000000000001'),
  'CLOSED',
  'approved reconciliation closes the shift'
);
select throws_ok(
  $$update public.cash_shifts set note = '竄改已結班資料'
    where id = '84100000-0000-4000-8000-000000000001'$$,
  'P0001', 'CLOSED_CASH_SHIFT_IMMUTABLE',
  'closed shift is immutable'
);
select throws_ok(
  $$update public.cash_shifts set note = note
    where id = '84100000-0000-4000-8000-000000000001'$$,
  'P0001', 'CLOSED_CASH_SHIFT_IMMUTABLE',
  'even a no-op update cannot alter the timestamp of a closed shift'
);
select throws_ok(
  $$update public.cash_movements set reason = '竄改分類帳'
    where id = (select id from public.cash_movements
                where cash_shift_id = '84100000-0000-4000-8000-000000000001' limit 1)$$,
  'P0001', 'CASH_LEDGER_ENTRY_IMMUTABLE',
  'cash ledger entries cannot be edited'
);

insert into auth.users (id, email) values
  ('a8410000-0000-4000-8000-000000000001', 'cash-owner@stallorder.test'),
  ('a8410000-0000-4000-8000-000000000002', 'cash-staff@stallorder.test'),
  ('a8410000-0000-4000-8000-000000000003', 'cash-kitchen@stallorder.test'),
  ('a8410000-0000-4000-8000-000000000004', 'cash-finance@stallorder.test');
update public.profiles set auth_user_id = 'a8410000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = 'a8410000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555552';
update public.profiles set auth_user_id = 'a8410000-0000-4000-8000-000000000003'
where id = '55555555-5555-4555-8555-555555555553';
insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, updated_at
) values (
  '84500000-0000-4000-8000-000000000004',
  'a8410000-0000-4000-8000-000000000004',
  'cash-finance@stallorder.test', '現金財務檢視者', true, now()
);
insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  '84500000-0000-4000-8000-000000000004', 'FINANCE_VIEWER', true, true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a8410000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.cash_shifts), 2, 'organization owner sees authorized organization shifts');
select set_config('request.jwt.claim.sub', 'a8410000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.cash_shifts where stall_id = '22222222-2222-4222-8222-222222222222'), 1, 'staff sees the assigned stall shift');
select is((select count(*)::integer from public.cash_shifts where stall_id = '84200000-0000-4000-8000-000000000001'), 0, 'staff cannot see an unassigned stall shift');
select set_config('request.jwt.claim.sub', 'a8410000-0000-4000-8000-000000000004', true);
select is((select count(*)::integer from public.cash_shifts), 2, 'finance viewer sees organization cash reconciliation');
select set_config('request.jwt.claim.sub', 'a8410000-0000-4000-8000-000000000003', true);
select is(
  ((select count(*) from public.cash_shifts)
   + (select count(*) from public.cash_movements)
   + (select count(*) from public.cash_shift_reviews))::integer,
  0,
  'kitchen role cannot read cash or reconciliation data'
);

reset role;
select * from finish();
rollback;
