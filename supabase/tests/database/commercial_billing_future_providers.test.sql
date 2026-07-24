begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

select is((
  select count(*)::integer
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'payment_provider_customers', 'payment_attempts', 'billing_webhook_events',
      'tax_documents', 'tax_document_events'
    )
), 5, 'future provider tables exist');

select ok((
  select count(*) = 5 and bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'payment_provider_customers', 'payment_attempts', 'billing_webhook_events',
      'tax_documents', 'tax_document_events'
    )
), 'future provider tables force RLS');

select ok((
  select bool_and(not has_table_privilege('anon', format('public.%I', table_name), 'SELECT'))
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'payment_provider_customers', 'payment_attempts', 'billing_webhook_events',
      'tax_documents', 'tax_document_events'
    )
), 'anonymous users cannot read future provider data');

select ok((
  select bool_and(
    not has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
    and not has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
  )
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'payment_provider_customers', 'payment_attempts', 'billing_webhook_events',
      'tax_documents', 'tax_document_events'
    )
), 'authenticated users cannot write future provider data');

select ok((
  select bool_and(
    has_table_privilege('service_role', format('public.%I', table_name), 'SELECT')
    and has_table_privilege('service_role', format('public.%I', table_name), 'INSERT')
  )
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'payment_provider_customers', 'payment_attempts', 'billing_webhook_events',
      'tax_documents', 'tax_document_events'
    )
), 'only the trusted service role receives future provider access');

select ok(not exists(
  select 1 from information_schema.columns
  where table_schema = 'public'
    and table_name = 'billing_webhook_events'
    and column_name in ('payload', 'raw_payload', 'request_body')
), 'webhook table stores a payload hash instead of a raw payload');

select is((
  select count(*)::integer from public.billing_feature_flags
  where code in (
    'AUTOMATED_BILLING_ENABLED', 'ECPAY_BILLING_ENABLED',
    'NEWEBPAY_BILLING_ENABLED', 'E_INVOICE_ENABLED'
  ) and not is_enabled
), 4, 'all external provider flags remain disabled');

insert into public.organizations (
  id, name, slug, business_name, status, email, phone,
  default_timezone, default_currency, created_at, updated_at
) values (
  'f9000000-0000-4000-8000-000000000001', 'Future Provider Isolation',
  'future-provider-isolation', 'Future Provider Isolation', 'TRIALING',
  'future-provider-isolation@example.test', '0900000000',
  'Asia/Taipei', 'TWD', now(), now()
);

select lives_ok(
  $$insert into public.invoices (
      id, organization_id, subscription_id, invoice_number, status, currency,
      billing_period_start, billing_period_end, subtotal, discount_amount,
      tax_amount, total_amount, amount_paid, amount_due, due_at, created_at, updated_at
    ) select
      'f9000000-0000-4000-8000-000000000002', subscription.organization_id,
      subscription.id, 'FUTURE-PROVIDER-QA-001', 'DRAFT', 'TWD',
      date '2036-01-01', date '2036-02-01', 699, 0, 0, 699, 0, 699,
      timestamptz '2036-01-05 00:00:00+00', now(), now()
    from public.subscriptions subscription
    where subscription.organization_id = '11111111-1111-4111-8111-111111111111'$$,
  'provider test invoice can be created'
);

select lives_ok(
  $$insert into public.payment_attempts (
      organization_id, invoice_id, provider, provider_transaction_id,
      amount, currency, status
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'f9000000-0000-4000-8000-000000000002', 'MOCK', 'mock-transaction-1',
      699, 'TWD', 'PENDING'
    )$$,
  'matching organization payment attempt is accepted'
);

select throws_ok(
  $$insert into public.payment_attempts (
      organization_id, invoice_id, provider, amount, currency, status
    ) values (
      'f9000000-0000-4000-8000-000000000001',
      'f9000000-0000-4000-8000-000000000002', 'MOCK', 699, 'TWD', 'PENDING'
    )$$,
  '23503',
  'insert or update on table "payment_attempts" violates foreign key constraint "payment_attempts_invoice_organization_fk"',
  'payment attempt cannot cross organization boundaries'
);

select lives_ok(
  $$insert into public.tax_documents (
      id, organization_id, invoice_id, document_type, carrier_type,
      carrier_value_hash, status
    ) values (
      'f9000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111',
      'f9000000-0000-4000-8000-000000000002', 'INVOICE', 'MOBILE_BARCODE',
      repeat('a', 64), 'CREATED'
    )$$,
  'hashed carrier data is accepted for a matching invoice'
);

select throws_ok(
  $$insert into public.tax_documents (
      organization_id, invoice_id, document_type, status
    ) values (
      'f9000000-0000-4000-8000-000000000001',
      'f9000000-0000-4000-8000-000000000002', 'INVOICE', 'CREATED'
    )$$,
  '23503',
  'insert or update on table "tax_documents" violates foreign key constraint "tax_documents_invoice_organization_fk"',
  'tax document cannot cross organization boundaries'
);

select lives_ok(
  $$insert into public.billing_webhook_events (
      provider, provider_event_id, event_type, payload_hash, processing_status
    ) values ('MOCK', 'mock-event-1', 'PAYMENT_SUCCEEDED', repeat('b', 64), 'RECEIVED')$$,
  'hashed mock webhook event is accepted'
);

select throws_ok(
  $$insert into public.billing_webhook_events (
      provider, provider_event_id, event_type, payload_hash, processing_status
    ) values ('MOCK', 'mock-event-1', 'PAYMENT_SUCCEEDED', repeat('c', 64), 'RECEIVED')$$,
  '23505',
  'duplicate key value violates unique constraint "billing_webhook_events_provider_event_unique"',
  'duplicate provider webhook event is rejected'
);

select throws_ok(
  $$insert into public.billing_webhook_events (
      provider, provider_event_id, event_type, payload_hash, processing_status
    ) values ('MOCK', 'mock-event-2', 'PAYMENT_SUCCEEDED', repeat('d', 64), 'PROCESSED')$$,
  '23514',
  'new row for relation "billing_webhook_events" violates check constraint "billing_webhook_events_processed_check"',
  'terminal webhook state requires a processed timestamp'
);

select * from finish();
rollback;
