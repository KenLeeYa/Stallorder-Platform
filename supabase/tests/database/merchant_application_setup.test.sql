begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.merchant_applications'::regclass),
  'merchant applications enforce RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.merchant_setup_progress'::regclass),
  'merchant setup progress enforces RLS'
);
select ok(not has_table_privilege('anon', 'public.merchant_applications', 'SELECT'), 'anonymous cannot read applications');
select ok(not has_table_privilege('anon', 'public.merchant_setup_progress', 'SELECT'), 'anonymous cannot read setup progress');

insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-000000000001', 'application-one@stallorder.test'),
  ('e1000000-0000-4000-8000-000000000002', 'application-two@stallorder.test'),
  ('e1000000-0000-4000-8000-000000000003', 'application-admin@stallorder.test');

insert into public.profiles (
  id, auth_user_id, email, display_name, is_active, platform_role, created_at, updated_at
) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'application-one@stallorder.test', '申請人一', true, null, now(), now()),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'application-two@stallorder.test', '申請人二', true, null, now(), now()),
  ('e2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'application-admin@stallorder.test', '申請管理員', true, 'PLATFORM_ADMIN', now(), now());

insert into public.merchant_applications (
  id, applicant_profile_id, applicant_email, applicant_display_name,
  merchant_name, business_type, contact_name, phone, phone_hash, business_phone,
  preferred_contact_method, business_address, city, stall_name, stall_location,
  requested_slug, status, internal_review_note, terms_accepted, privacy_accepted,
  data_processing_accepted, information_confirmed, consented_at, submitted_at
) values
  (
    'e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
    'application-one@stallorder.test', '申請人一', '測試商家一', 'NIGHT_MARKET_STALL',
    '負責人一', '0911111111', 'application-phone-one', '0911111111', 'PHONE',
    '台北市測試路 1 號', '台北市', '測試攤位一', '測試夜市', 'application-test-one',
    'PENDING_REVIEW', '僅限內部一', true, true, true, true, now(), now()
  ),
  (
    'e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002',
    'application-two@stallorder.test', '申請人二', '測試商家二', 'FOOD_TRUCK',
    '負責人二', '0922222222', 'application-phone-two', '0922222222', 'EMAIL',
    '台中市測試路 2 號', '台中市', '測試攤位二', '測試市集', 'application-test-two',
    'PENDING_REVIEW', '僅限內部二', true, true, true, true, now(), now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.merchant_applications), 1, 'applicant reads only own application');
select is((select count(*)::integer from public.merchant_applications where id = 'e3000000-0000-4000-8000-000000000002'), 0, 'applicant cannot read another application');
select ok(not has_column_privilege(current_user, 'public.merchant_applications', 'internal_review_note', 'SELECT'), 'applicant cannot select internal review notes');
select ok(not has_table_privilege(current_user, 'public.merchant_applications', 'INSERT'), 'applicant cannot write applications directly');

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is((select count(*)::integer from public.merchant_applications), 2, 'platform admin can review all applications through RLS');
reset role;

insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_primary_owner, is_active
) values (
  '11111111-1111-4111-8111-111111111111',
  'e2000000-0000-4000-8000-000000000001',
  'ORGANIZATION_OWNER', true, false, true
);

update public.merchant_applications
set status = 'APPROVED', approved_organization_id = '11111111-1111-4111-8111-111111111111', approved_at = now()
where id = 'e3000000-0000-4000-8000-000000000001';

insert into public.merchant_setup_progress (
  id, application_id, organization_id, stall_id, qr_code_id,
  merchant_profile_completed, stall_profile_completed, catalog_completed,
  payment_options_completed, team_setup_completed, qr_preview_completed
) values (
  'e4000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  true, true, true, true, true, true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.merchant_setup_progress), 1, 'organization owner reads own setup progress');
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.merchant_setup_progress), 0, 'non-member cannot read setup progress');
reset role;

select throws_like(
  $$update public.merchant_setup_progress
    set go_live_completed = true, go_live_completed_at = now()
    where id = 'e4000000-0000-4000-8000-000000000001'$$,
  '%merchant_setup_progress_go_live_check%',
  'go live is rejected before a test order completes'
);

insert into public.orders (
  id, organization_id, stall_id, order_no, tracking_token_hash, idempotency_key,
  source, is_test, customer_name, status, payment_status, subtotal, total,
  device_hash, confirmation_expires_at, created_at, updated_at, paid_at
) values (
  'e5000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '990115-001', repeat('a', 64), 'e6000000-0000-4000-8000-000000000001',
  'MERCHANT_SETUP_TEST', true, '開店流程測試', 'WAITING_CONFIRMATION', 'PAID', 1, 1,
  repeat('b', 64), '2099-01-15 12:10:00+00', '2099-01-15 12:00:00+00',
  '2099-01-15 12:00:00+00', '2099-01-15 12:00:00+00'
);
update public.merchant_setup_progress
set test_order_id = 'e5000000-0000-4000-8000-000000000001'
where id = 'e4000000-0000-4000-8000-000000000001';
update public.orders
set status = 'COMPLETED', completed_at = '2099-01-15 12:05:00+00'
where id = 'e5000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.usage_events where reference_type = 'ORDER' and reference_id = 'e5000000-0000-4000-8000-000000000001'),
  0,
  'completed test order creates no billable usage event'
);
select ok(
  (select test_order_completed from public.merchant_setup_progress where id = 'e4000000-0000-4000-8000-000000000001'),
  'completed test order advances setup progress'
);
select lives_ok(
  $$select public.rebuild_daily_stall_summary('22222222-2222-4222-8222-222222222222', '2099-01-15', '2099-01-15')$$,
  'daily summary can rebuild after a test order'
);
select is(
  (select completed_order_count from public.daily_stall_summaries where stall_id = '22222222-2222-4222-8222-222222222222' and business_date = '2099-01-15'),
  0,
  'test order is excluded from revenue summaries'
);
select throws_like(
  $$delete from public.orders where id = 'e5000000-0000-4000-8000-000000000001'$$,
  '%merchant_setup_progress_test_order_id_fkey%',
  'linked setup test order is retained as audit evidence'
);

delete from public.stall_ordering_settings
where stall_id = '22222222-2222-4222-8222-222222222222';
insert into public.stall_ordering_settings (organization_id, stall_id)
values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222'
);
select is(
  (select dine_in_enabled from public.stall_ordering_settings where stall_id = '22222222-2222-4222-8222-222222222222'),
  false,
  'new stall ordering settings keep dine-in disabled'
);
select is(
  (select enabled_locales from public.stall_ordering_settings where stall_id = '22222222-2222-4222-8222-222222222222'),
  array['zh-TW']::text[],
  'new stall ordering settings enable only Traditional Chinese'
);

select * from finish();
rollback;
