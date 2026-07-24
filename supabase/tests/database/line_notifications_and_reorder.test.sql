begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

select has_table('public', 'notification_integrations', 'notification integrations table exists');
select has_table('public', 'customer_contact_links', 'customer contact links table exists');
select has_table('public', 'notification_jobs', 'notification jobs table exists');
select has_table('public', 'line_link_sessions', 'LINE link sessions table exists');
select has_table('public', 'line_webhook_events', 'LINE webhook replay ledger exists');
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.notification_integrations'::regclass,
     'public.customer_contact_links'::regclass,
     'public.notification_jobs'::regclass,
     'public.line_link_sessions'::regclass,
     'public.line_webhook_events'::regclass
   )),
  'all LINE notification tables enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.notification_integrations', 'SELECT')
  and not has_table_privilege('anon', 'public.notification_jobs', 'SELECT'),
  'anonymous clients cannot read notification tables'
);
select ok(
  not has_table_privilege('anon', 'public.customer_contact_links', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notification_jobs', 'INSERT'),
  'anonymous and authenticated clients cannot write notification data directly'
);
select ok(
  has_table_privilege('authenticated', 'public.notification_integrations', 'SELECT')
  and has_table_privilege('authenticated', 'public.notification_jobs', 'SELECT'),
  'authorized management reads are exposed only behind RLS'
);
select is(
  (select count(distinct feature_code)::integer from public.plan_entitlements
   where feature_code in ('LINE_NOTIFICATIONS', 'LINE_ORDER_LINKING', 'LINE_REPEAT_ORDER')
     and is_enabled),
  3,
  'all LINE capabilities are enforced by server-side entitlements'
);
select ok(
  exists (
    select 1 from public.plan_entitlements entitlement
    join public.plan_versions version on version.id = entitlement.plan_version_id
    join public.plans plan on plan.id = version.plan_id
    where plan.code = 'STANDARD' and version.effective_until is null
      and entitlement.feature_code = 'LINE_NOTIFICATIONS' and entitlement.is_enabled
  ) and not exists (
    select 1 from public.plan_entitlements entitlement
    join public.plan_versions version on version.id = entitlement.plan_version_id
    join public.plans plan on plan.id = version.plan_id
    where plan.code = 'STANDARD' and version.effective_until is null
      and entitlement.feature_code = 'LINE_REPEAT_ORDER' and entitlement.is_enabled
  ),
  'Standard includes LINE notifications but not repeat ordering'
);
select ok(
  exists (
    select 1 from public.plan_entitlements entitlement
    join public.plan_versions version on version.id = entitlement.plan_version_id
    join public.plans plan on plan.id = version.plan_id
    where plan.code = 'PRO' and version.effective_until is null
      and entitlement.feature_code = 'LINE_REPEAT_ORDER' and entitlement.is_enabled
  ),
  'Pro includes repeat ordering'
);

select throws_ok(
  $$insert into public.notification_integrations (
      organization_id, stall_id, provider, settings_json
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', 'LINE',
      '{"channelAccessToken":"must-not-be-stored"}'::jsonb
    )$$,
  '23514', null,
  'raw provider secrets are rejected from public settings'
);

create temporary table line_test_secrets (name text primary key, secret_id uuid not null);
insert into line_test_secrets values
  ('integration', vault.create_secret(repeat('i', 64), 'line_test_integration', 'test only')),
  ('recipient', vault.create_secret(repeat('r', 64), 'line_test_recipient', 'test only')),
  ('other-recipient', vault.create_secret(repeat('o', 64), 'line_test_other_recipient', 'test only'));

insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  '9a000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111', 'LINE 隔離攤位',
  'line-isolation-stall', 'LINE-ISO', '台北市測試路 9 號',
  'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

select lives_ok(
  $$insert into public.notification_integrations (
      id, organization_id, stall_id, provider, status, public_identifier,
      secret_reference, settings_json
    ) values (
      '9a100000-0000-4000-8000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', 'LINE', 'ACTIVE', '1234567890',
      (select secret_id from line_test_secrets where name = 'integration'),
      '{"displayName":"測試 LINE","notifyConfirmed":true,"notifyReady":true,"notifyCancelled":true}'::jsonb
    )$$,
  'a valid LINE integration can reference a Vault secret'
);
select ok(
  not exists (
    select 1 from public.notification_integrations
    where settings_json ?| array['channelAccessToken', 'channelSecret', 'providerUserId']
  ),
  'public integration rows contain no raw credentials or recipient identifiers'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, pickup_code_hash,
  pickup_code_display, confirmation_expires_at, created_at, updated_at
) values
  (
    '9a200000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'LINE-001', repeat('1', 64),
    '9a210000-0000-4000-8000-000000000001', 'QR_MENU', 'LINE 測試顧客',
    'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 100, 100, repeat('2', 64),
    repeat('3', 64), '321', now() + interval '10 minutes', now(), now()
  ),
  (
    '9a200000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222', 'LINE-002', repeat('4', 64),
    '9a210000-0000-4000-8000-000000000002', 'QR_MENU', '無綁定顧客',
    'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 80, 80, repeat('5', 64),
    repeat('6', 64), '654', now() + interval '10 minutes', now(), now()
  );

select throws_ok(
  $$insert into public.customer_contact_links (
      organization_id, stall_id, integration_id, customer_reference_id, provider,
      provider_user_id_hash, provider_user_secret_reference, consent_status, consented_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '9a000000-0000-4000-8000-000000000001',
      '9a100000-0000-4000-8000-000000000001',
      '9a200000-0000-4000-8000-000000000001', 'LINE', repeat('7', 64),
      (select secret_id from line_test_secrets where name = 'other-recipient'),
      'GRANTED', now()
    )$$,
  'P0001', 'NOTIFICATION_INTEGRATION_SCOPE_MISMATCH',
  'a contact link cannot cross stall scope'
);

insert into public.customer_contact_links (
  id, organization_id, stall_id, integration_id, customer_reference_id, provider,
  provider_user_id_hash, provider_user_secret_reference, consent_status, consented_at
) values (
  '9a300000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '9a100000-0000-4000-8000-000000000001',
  '9a200000-0000-4000-8000-000000000001', 'LINE', repeat('8', 64),
  (select secret_id from line_test_secrets where name = 'recipient'),
  'GRANTED', now()
);

update public.orders set status = 'CONFIRMED', confirmed_at = now()
where id = '9a200000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000001'
     and template_code = 'ORDER_CONFIRMED'),
  1,
  'confirming a linked order enqueues one notification job'
);
update public.orders set status = 'CONFIRMED'
where id = '9a200000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000001'
     and template_code = 'ORDER_CONFIRMED'),
  1,
  'repeated status writes do not duplicate a notification job'
);
update public.orders set status = 'READY'
where id = '9a200000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000001'
     and template_code = 'ORDER_READY'),
  1,
  'ready status creates a separate notification job'
);
update public.orders set status = 'CONFIRMED', confirmed_at = now()
where id = '9a200000-0000-4000-8000-000000000002';
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000002'),
  0,
  'orders without customer consent do not enqueue notifications'
);
select is(
  public.revoke_line_contact_link('9a200000-0000-4000-8000-000000000001'),
  true,
  'customer consent can be revoked through the trusted RPC'
);
select is(
  (select consent_status::text from public.customer_contact_links
   where id = '9a300000-0000-4000-8000-000000000001'),
  'REVOKED',
  'revocation is persisted'
);
select ok(
  not exists (
    select 1 from vault.secrets
    where id = (select secret_id from line_test_secrets where name = 'recipient')
  ),
  'revocation deletes the recipient secret from Vault'
);
update public.orders set status = 'CANCELLED', cancelled_at = now()
where id = '9a200000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000001'
     and template_code = 'ORDER_CANCELLED'),
  0,
  'revoked consent prevents future notification jobs'
);

create temporary table line_test_sessions (
  sequence integer primary key,
  session_id uuid not null,
  secret_id uuid
);
insert into line_test_sessions (sequence, session_id) values (
  1,
  public.start_line_link_session(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '9a100000-0000-4000-8000-000000000001',
    '9a200000-0000-4000-8000-000000000002', repeat('a', 64),
    '{"trackingToken":"sto_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","codeVerifier":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nonce":"aaaaaaaaaaaaaaaa","redirectUri":"https://staging.qidaigo.com/api/public/line/callback"}',
    now() + interval '10 minutes'
  )
);
update line_test_sessions set secret_id = session.ephemeral_secret_reference
from public.line_link_sessions session
where sequence = 1 and session.id = line_test_sessions.session_id;
select is(
  (select count(*)::integer from public.line_link_sessions
   where order_id = '9a200000-0000-4000-8000-000000000002' and status = 'ACTIVE'),
  1,
  'one active OAuth link session is created'
);
insert into line_test_sessions (sequence, session_id) values (
  2,
  public.start_line_link_session(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '9a100000-0000-4000-8000-000000000001',
    '9a200000-0000-4000-8000-000000000002', repeat('b', 64),
    '{"trackingToken":"sto_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","codeVerifier":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","nonce":"bbbbbbbbbbbbbbbb","redirectUri":"https://staging.qidaigo.com/api/public/line/callback"}',
    now() + interval '10 minutes'
  )
);
update line_test_sessions set secret_id = session.ephemeral_secret_reference
from public.line_link_sessions session
where sequence = 2 and session.id = line_test_sessions.session_id;
select is(
  (select count(*)::integer from public.line_link_sessions
   where order_id = '9a200000-0000-4000-8000-000000000002' and status = 'ACTIVE'),
  1,
  'starting again replaces rather than duplicates the active OAuth session'
);
select ok(
  not exists (
    select 1 from vault.secrets
    where id = (select secret_id from line_test_sessions where sequence = 1)
  ),
  'replaced OAuth session secrets are deleted from Vault'
);
select is(
  app_private.expire_line_link_sessions(now() + interval '11 minutes'),
  1,
  'expired OAuth sessions are closed exactly once'
);
select is(
  (select count(*)::integer from public.line_link_sessions
   where order_id = '9a200000-0000-4000-8000-000000000002' and status = 'ACTIVE'),
  0,
  'expired OAuth state cannot be replayed'
);
select ok(
  exists (select 1 from cron.job where jobname = 'stallorder-notification-jobs')
  and exists (select 1 from cron.job where jobname = 'stallorder-line-link-session-cleanup'),
  'notification delivery and OAuth cleanup jobs are scheduled'
);

insert into auth.users (id, email) values
  ('9a500000-0000-4000-8000-000000000001', 'line-owner-auth@stallorder.test'),
  ('9a500000-0000-4000-8000-000000000002', 'line-kitchen-auth@stallorder.test');
update public.profiles set auth_user_id = '9a500000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555551';
update public.profiles set auth_user_id = '9a500000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555553';

set local role authenticated;
select set_config('request.jwt.claim.sub', '9a500000-0000-4000-8000-000000000001', true);
select is(
  (select count(*)::integer from public.notification_integrations
   where id = '9a100000-0000-4000-8000-000000000001'),
  1,
  'organization owner can read the authorized LINE integration'
);
select set_config('request.jwt.claim.sub', '9a500000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.notification_integrations
   where id = '9a100000-0000-4000-8000-000000000001'),
  0,
  'KITCHEN cannot read LINE integration settings'
);
select is(
  (select count(*)::integer from public.notification_jobs
   where order_id = '9a200000-0000-4000-8000-000000000001'),
  0,
  'KITCHEN cannot read notification delivery jobs'
);
reset role;

select throws_ok(
  $$insert into public.notification_jobs (
      organization_id, stall_id, integration_id, contact_link_id, order_id,
      provider, template_code, recipient_reference
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '9a000000-0000-4000-8000-000000000001',
      '9a100000-0000-4000-8000-000000000001',
      '9a300000-0000-4000-8000-000000000001',
      '9a200000-0000-4000-8000-000000000001', 'LINE', 'ORDER_CANCELLED',
      (select secret_id from line_test_secrets where name = 'other-recipient')
    )$$,
  'P0001', 'NOTIFICATION_INTEGRATION_SCOPE_MISMATCH',
  'notification jobs cannot cross stall scope'
);

select * from finish();
rollback;
