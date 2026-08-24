begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);

select has_table('public', 'passkey_credentials', 'passkey credential table exists');
select has_table('public', 'passkey_challenges', 'passkey challenge table exists');
select has_table('public', 'payment_provider_connections', 'provider connection table exists');
select has_table('public', 'payment_provider_transactions', 'provider transaction table exists');
select has_table('public', 'payment_provider_webhook_events', 'webhook replay ledger exists');
select has_table('public', 'payment_provider_refunds', 'refund ledger exists');
select has_table('public', 'payment_reconciliation_cases', 'reconciliation queue exists');

select ok(
  (select bool_and(not default_enabled)
   from public.resilience_feature_flags
   where code in (
     'OAUTH_MICROSOFT_ENABLED', 'AUTH_PASSKEYS_ENABLED',
     'PAYMENTS_FOUNDATION_ENABLED', 'PAYMENTS_MOCK_PROVIDER_ENABLED',
     'PAYMENTS_ADMIN_UI_ENABLED',
     'PAYMENTS_LINE_PAY_ENABLED',
     'PAYMENTS_JKO_PAY_ENABLED', 'PAYMENTS_TWQR_ENABLED',
     'PAYMENTS_TAIWAN_PAY_ENABLED', 'PAYMENTS_PX_PAY_PLUS_ENABLED',
     'PAYMENTS_IPASS_MONEY_ENABLED', 'PAYMENTS_ICASH_PAY_ENABLED',
     'PAYMENTS_PLUS_PAY_ENABLED', 'PAYMENTS_EASY_WALLET_ENABLED',
     'PAYMENTS_GAMA_PAY_ENABLED', 'PAYMENTS_OPAY_ENABLED',
     'PAYMENTS_GATEWAY_ENABLED', 'PAYMENTS_REFUNDS_ENABLED',
     'PAYMENTS_RECONCILIATION_ENABLED'
   )),
  'every new live capability defaults off'
);
select is(
  (select count(*)::integer
   from public.resilience_feature_flags
   where code like 'PAYMENTS_%_ENABLED' or code in ('OAUTH_MICROSOFT_ENABLED', 'AUTH_PASSKEYS_ENABLED')),
  19,
  'all expected auth and payment flags exist'
);
select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.passkey_credentials'::regclass,
     'public.passkey_challenges'::regclass,
     'public.payment_provider_connections'::regclass,
     'public.payment_provider_transactions'::regclass,
     'public.payment_provider_webhook_events'::regclass,
     'public.payment_provider_refunds'::regclass,
     'public.payment_reconciliation_cases'::regclass
   )),
  'all new security-sensitive tables force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.payment_provider_transactions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payment_provider_transactions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payment_provider_refunds', 'INSERT')
  and not has_table_privilege('authenticated', 'public.passkey_credentials', 'UPDATE')
  and has_table_privilege('service_role', 'public.payment_provider_transactions', 'INSERT'),
  'browser roles cannot read or mutate provider ledgers'
);
select ok(
  exists(select 1 from pg_constraint where conname = 'payment_provider_transactions_order_scope_fkey'),
  'transactions bind to tenant-scoped orders'
);
select ok(
  exists(select 1 from pg_constraint where conname = 'payment_provider_webhook_events_transaction_scope_fkey'),
  'webhooks bind to tenant-scoped transactions'
);
select ok(
  exists(select 1 from pg_constraint where conname = 'payment_provider_refunds_transaction_scope_fkey'),
  'refunds bind to tenant-scoped transactions'
);
select ok(
  exists(select 1 from pg_constraint where conname = 'payment_reconciliation_cases_transaction_scope_fkey'),
  'reconciliation binds to tenant-scoped transactions'
);
select has_index('public', 'payment_provider_webhook_events', 'payment_provider_webhook_events_provider_event_key', 'provider event replay key exists');
select has_index('public', 'payment_provider_transactions', 'payment_provider_transactions_idempotency_key', 'payment create idempotency key exists');
select has_function('app_private', 'validate_payment_provider_scope', 'provider connection scope validator exists');
select has_function('app_private', 'guard_passkey_challenge_update', 'single-use Passkey challenge guard exists');

select * from finish();
rollback;
