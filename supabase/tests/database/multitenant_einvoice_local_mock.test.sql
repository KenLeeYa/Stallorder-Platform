begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);

select is((
  select count(*)::integer
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'invoice_seller_profiles',
      'invoice_provider_connections',
      'invoice_policy_versions',
      'invoice_checkout_preferences',
      'invoice_documents',
      'invoice_provider_operations',
      'invoice_reconciliation_cases'
    )
), 7, 'all merchant e-invoice domain tables exist');

select is((
  select count(*)::integer
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in (
      'invoice_seller_profiles',
      'invoice_provider_connections',
      'invoice_policy_versions',
      'invoice_checkout_preferences',
      'invoice_documents',
      'invoice_provider_operations',
      'invoice_reconciliation_cases'
    )
    and relation.relkind = 'r'
    and relation.relrowsecurity
    and relation.relforcerowsecurity
), 7, 'all new invoice tables enable and force RLS');

select ok(
  not has_table_privilege('anon', 'public.invoice_documents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.invoice_documents', 'SELECT')
  and not has_table_privilege('authenticated', 'public.invoice_checkout_preferences', 'SELECT'),
  'browser database roles cannot read invoice or carrier preference records'
);

select ok(
  has_table_privilege('service_role', 'public.invoice_documents', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'public.invoice_checkout_preferences', 'SELECT,INSERT,UPDATE,DELETE'),
  'service role can use the server-owned invoice tables'
);

select is((
  select count(*)::integer
  from public.billing_feature_flags
  where code in (
    'EINVOICE_PLATFORM_ENABLED',
    'EINVOICE_MERCHANT_SETUP_ENABLED',
    'EINVOICE_CHECKOUT_UI_ENABLED',
    'EINVOICE_SANDBOX_ENABLED',
    'EINVOICE_PRODUCTION_ISSUE_ENABLED',
    'EINVOICE_ECPAY_ENABLED',
    'EINVOICE_EZPAY_ENABLED',
    'EINVOICE_TRADEVAN_ENABLED'
  ) and is_enabled
), 0, 'all external and production e-invoice feature flags default off');

select is((
  select count(*)::integer
  from pg_constraint
  where conname in (
    'invoice_checkout_preferences_stall_scope_fkey',
    'invoice_checkout_preferences_order_scope_fkey',
    'invoice_documents_stall_scope_fkey',
    'invoice_documents_order_scope_fkey',
    'invoice_documents_payment_scope_fkey',
    'invoice_documents_connection_scope_fkey',
    'invoice_documents_seller_scope_fkey',
    'invoice_documents_policy_scope_fkey',
    'invoice_provider_operations_document_scope_fkey',
    'invoice_reconciliation_cases_document_scope_fkey'
  )
), 10, 'tenant-scoped invoice references use composite foreign keys');

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  'e9000000-0000-4000-8000-000000000001',
  'Invoice Other Org', 'invoice-other-org', 'Invoice Other Org', 'ACTIVE',
  'invoice-other@stallorder.test', '0900000000', now()
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, status, payment_status, total,
  device_hash, pickup_code_hash, confirmation_expires_at, created_at, updated_at
) values (
  'e9000000-0000-4000-8000-000000000010',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'EINV-QA-001', repeat('1', 64),
  'e9000000-0000-4000-8000-000000000011', 'QR_MENU', 'Invoice QA',
  'COMPLETED', 'PAID', 100, repeat('2', 64), repeat('3', 64),
  now() + interval '10 minutes', now(), now()
);

insert into public.invoice_seller_profiles (
  id, organization_id, legal_name, tax_id, registered_address,
  contact_name, contact_email, contact_phone, default_tax_type
) values (
  'e9000000-0000-4000-8000-000000000020',
  '11111111-1111-4111-8111-111111111111',
  'TEST SELLER / NOT LEGAL', 'TEST-ONLY', 'TEST ONLY',
  'Local QA', 'owner@stallorder.test', '0900000000', 'MOCK_NOT_TAX_DETERMINED'
);

insert into public.invoice_provider_connections (
  id, organization_id, provider, environment, status, capabilities_json,
  created_by_profile_id, updated_by_profile_id
) values (
  'e9000000-0000-4000-8000-000000000030',
  '11111111-1111-4111-8111-111111111111',
  'ECPAY', 'MOCK', 'CONFIGURED', '{"b2cIssue":true}'::jsonb,
  '55555555-5555-4555-8555-555555555551',
  '55555555-5555-4555-8555-555555555551'
);

insert into public.invoice_policy_versions (
  id, organization_id, version, trigger, default_tax_type,
  effective_from, created_by_profile_id
) values (
  'e9000000-0000-4000-8000-000000000040',
  '11111111-1111-4111-8111-111111111111',
  9001, 'MANUAL', 'MOCK_NOT_TAX_DETERMINED', now(),
  '55555555-5555-4555-8555-555555555551'
);

insert into public.invoice_documents (
  id, organization_id, stall_id, order_id, provider_connection_id,
  seller_profile_id, policy_version_id, status, sales_amount, tax_amount,
  total_amount, tax_type, rounding_policy, buyer_type,
  policy_snapshot_json, seller_snapshot_json, buyer_snapshot_json, test_document
) values (
  'e9000000-0000-4000-8000-000000000050',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'e9000000-0000-4000-8000-000000000010',
  'e9000000-0000-4000-8000-000000000030',
  'e9000000-0000-4000-8000-000000000020',
  'e9000000-0000-4000-8000-000000000040',
  'PENDING', 100, 0, 100, 'MOCK_NOT_TAX_DETERMINED', 'TEST_ONLY', 'CLOUD',
  '{"testOnly":true}'::jsonb, '{"marker":"TEST / NOT A LEGAL INVOICE"}'::jsonb,
  '{"buyerType":"CLOUD"}'::jsonb, true
);

select lives_ok(
  $$insert into public.invoice_checkout_preferences (
      organization_id, stall_id, order_id, buyer_type, selection_snapshot_json
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'e9000000-0000-4000-8000-000000000010',
      'CLOUD', '{"buyerType":"CLOUD"}'::jsonb
    )$$,
  'same-tenant checkout preference is accepted'
);

select throws_ok(
  $$insert into public.invoice_checkout_preferences (
      organization_id, stall_id, order_id, buyer_type, selection_snapshot_json
    ) values (
      'e9000000-0000-4000-8000-000000000001',
      '22222222-2222-4222-8222-222222222222',
      'e9000000-0000-4000-8000-000000000010',
      'CLOUD', '{"buyerType":"CLOUD"}'::jsonb
    )$$,
  '23503',
  null,
  'cross-tenant checkout preference is rejected'
);

select throws_ok(
  $$update public.invoice_policy_versions
    set default_tax_type = 'CHANGED'
    where id = 'e9000000-0000-4000-8000-000000000040'$$,
  'P0001',
  'INVOICE_POLICY_VERSION_IMMUTABLE',
  'effective invoice policy versions are immutable'
);

select throws_ok(
  $$insert into public.invoice_provider_operations (
      organization_id, invoice_document_id, operation_type, idempotency_key,
      request_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e9000000-0000-4000-8000-000000000050',
      'ISSUE', 'bad-hash', 'not-a-sha256'
    )$$,
  '23514',
  null,
  'provider operation ledger rejects unhashed request material'
);

select throws_ok(
  $$insert into public.invoice_documents (
      organization_id, stall_id, order_id, provider_connection_id,
      seller_profile_id, policy_version_id, status, sales_amount, tax_amount,
      total_amount, tax_type, rounding_policy, buyer_type,
      external_invoice_number, policy_snapshot_json, seller_snapshot_json,
      buyer_snapshot_json, test_document
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'e9000000-0000-4000-8000-000000000010',
      'e9000000-0000-4000-8000-000000000030',
      'e9000000-0000-4000-8000-000000000020',
      'e9000000-0000-4000-8000-000000000040',
      'ISSUED', 100, 0, 100, 'TEST', 'TEST', 'CLOUD',
      'TEST-NOT-A-LEGAL-INVOICE-DUPLICATE', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, true
    )$$,
  '23505',
  null,
  'one original invoice document is enforced per order before any duplicate issue'
);

select ok(
  (select test_document from public.invoice_documents where id = 'e9000000-0000-4000-8000-000000000050')
  and (select seller_snapshot_json->>'marker' from public.invoice_documents where id = 'e9000000-0000-4000-8000-000000000050') = 'TEST / NOT A LEGAL INVOICE',
  'local mock document is explicitly marked as non-legal'
);

select * from finish();
rollback;
