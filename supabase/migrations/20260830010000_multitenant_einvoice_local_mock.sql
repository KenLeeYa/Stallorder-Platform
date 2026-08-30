-- Multi-tenant merchant-owned Taiwan e-invoice foundation.
-- This migration intentionally enables only architecture and local mock readiness.
-- Production issuing remains fail-closed behind separate feature flags.

create unique index if not exists stalls_id_organization_einvoice_idx
  on public.stalls (id, organization_id);
create unique index if not exists orders_id_organization_einvoice_idx
  on public.orders (id, organization_id);
create unique index if not exists payments_id_organization_einvoice_idx
  on public.payments (id, organization_id);

create table public.invoice_seller_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  legal_name varchar(200) not null,
  tax_id varchar(32) not null,
  tax_registration_number varchar(64),
  registered_address varchar(300) not null,
  contact_name varchar(120) not null,
  contact_email varchar(254) not null,
  contact_phone varchar(40) not null,
  country_code varchar(2) not null default 'TW',
  currency varchar(3) not null default 'TWD',
  default_tax_type varchar(40) not null default 'UNCONFIGURED',
  verification_status varchar(32) not null default 'DRAFT'
    check (verification_status in ('DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (country_code = 'TW'),
  check (currency = 'TWD')
);

create index invoice_seller_profiles_readiness_idx
  on public.invoice_seller_profiles (organization_id, verification_status);

create table public.invoice_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider varchar(24) not null
    check (provider in ('ECPAY', 'EZPAY', 'TRADEVAN', 'CUSTOM')),
  environment varchar(16) not null
    check (environment in ('MOCK', 'SANDBOX', 'PRODUCTION')),
  status varchar(32) not null default 'NOT_CONFIGURED'
    check (status in ('NOT_CONFIGURED', 'CONFIGURED', 'VALIDATING', 'SANDBOX_READY', 'PILOT_READY', 'PRODUCTION_READY', 'DEGRADED', 'DISABLED', 'ERROR')),
  merchant_account_id varchar(120),
  provider_store_id varchar(120),
  secret_reference varchar(300),
  encryption_key_reference varchar(300),
  webhook_secret_reference varchar(300),
  configuration_json jsonb not null default '{}'::jsonb,
  capabilities_json jsonb not null default '{}'::jsonb,
  last_validated_at timestamptz,
  last_successful_request_at timestamptz,
  last_error_code varchar(120),
  last_error_message_sanitized varchar(500),
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  updated_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, provider, environment),
  check (environment <> 'PRODUCTION' or status <> 'PRODUCTION_READY' or merchant_account_id is not null),
  check (provider <> 'CUSTOM' or status = 'DISABLED')
);

create index invoice_provider_connections_status_idx
  on public.invoice_provider_connections (organization_id, environment, status);

create table public.invoice_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  trigger varchar(32) not null
    check (trigger in ('PAYMENT_CAPTURED', 'ORDER_CONFIRMED', 'ORDER_COMPLETED', 'MANUAL')),
  default_tax_type varchar(40) not null,
  buyer_fields_required jsonb not null default '{}'::jsonb,
  auto_void_on_full_refund boolean not null default false,
  allowance_on_partial_refund boolean not null default false,
  carrier_support boolean not null default false,
  donation_support boolean not null default false,
  paper_proof_support boolean not null default false,
  notification_mode varchar(24) not null default 'NONE'
    check (notification_mode in ('NONE', 'EMAIL', 'SMS', 'PROVIDER_DEFAULT')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, version),
  check (effective_until is null or effective_until > effective_from)
);

create index invoice_policy_versions_effective_idx
  on public.invoice_policy_versions (organization_id, effective_from desc);

create table public.invoice_checkout_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  order_id uuid not null,
  buyer_type varchar(32) not null
    check (buyer_type in ('CLOUD', 'MOBILE_BARCODE', 'MEMBER_CARRIER', 'BUSINESS', 'DONATION', 'PAPER')),
  buyer_tax_id varchar(32),
  buyer_name varchar(200),
  carrier_type varchar(40),
  carrier_value_encrypted text,
  donation_code varchar(32),
  selection_snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (order_id, organization_id),
  constraint invoice_checkout_preferences_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint invoice_checkout_preferences_order_scope_fkey
    foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete cascade,
  check ((carrier_type is null) = (carrier_value_encrypted is null)),
  check (not (donation_code is not null and carrier_type is not null)),
  check (
    (buyer_type = 'BUSINESS' and buyer_tax_id is not null and buyer_name is not null)
    or (buyer_type <> 'BUSINESS' and buyer_tax_id is null and buyer_name is null)
  ),
  check ((buyer_type = 'DONATION') = (donation_code is not null)),
  check ((buyer_type in ('MOBILE_BARCODE', 'MEMBER_CARRIER')) = (carrier_type is not null))
);

create index invoice_checkout_preferences_stall_idx
  on public.invoice_checkout_preferences (stall_id, created_at desc);

create table public.invoice_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  order_id uuid not null,
  payment_id uuid,
  provider_connection_id uuid not null,
  seller_profile_id uuid not null,
  policy_version_id uuid not null,
  document_type varchar(32) not null default 'ORIGINAL',
  status varchar(40) not null default 'PENDING'
    check (status in (
      'NOT_REQUIRED', 'PENDING', 'ISSUING', 'ISSUED', 'ISSUE_FAILED',
      'VOID_PENDING', 'VOIDED', 'VOID_FAILED',
      'ALLOWANCE_PENDING', 'PARTIALLY_ALLOWED', 'FULLY_ALLOWED', 'ALLOWANCE_FAILED',
      'ALLOWANCE_VOID_PENDING', 'ALLOWANCE_VOIDED', 'ALLOWANCE_VOID_FAILED',
      'RECONCILIATION_REQUIRED', 'MANUAL_REVIEW'
    )),
  currency varchar(3) not null default 'TWD',
  sales_amount integer not null check (sales_amount >= 0),
  tax_amount integer not null check (tax_amount >= 0),
  total_amount integer not null check (total_amount > 0),
  allowed_amount integer not null default 0 check (allowed_amount >= 0),
  tax_type varchar(40) not null,
  rounding_policy varchar(80) not null,
  buyer_type varchar(32) not null,
  buyer_tax_id varchar(32),
  buyer_name varchar(200),
  carrier_type varchar(40),
  carrier_value_encrypted text,
  donation_code varchar(32),
  external_invoice_number varchar(120),
  external_random_code varchar(40),
  external_allowance_reference varchar(160),
  issued_at timestamptz,
  voided_at timestamptz,
  reconciliation_status varchar(32) not null default 'NOT_CHECKED',
  policy_snapshot_json jsonb not null,
  seller_snapshot_json jsonb not null,
  buyer_snapshot_json jsonb not null,
  test_document boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, order_id, document_type),
  unique (provider_connection_id, external_invoice_number),
  constraint invoice_documents_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint invoice_documents_order_scope_fkey
    foreign key (order_id, organization_id)
    references public.orders(id, organization_id) on delete restrict,
  constraint invoice_documents_payment_scope_fkey
    foreign key (payment_id, organization_id)
    references public.payments(id, organization_id) on delete restrict,
  constraint invoice_documents_connection_scope_fkey
    foreign key (provider_connection_id, organization_id)
    references public.invoice_provider_connections(id, organization_id) on delete restrict,
  constraint invoice_documents_seller_scope_fkey
    foreign key (seller_profile_id, organization_id)
    references public.invoice_seller_profiles(id, organization_id) on delete restrict,
  constraint invoice_documents_policy_scope_fkey
    foreign key (policy_version_id, organization_id)
    references public.invoice_policy_versions(id, organization_id) on delete restrict,
  check (currency = 'TWD'),
  check (sales_amount + tax_amount = total_amount),
  check (allowed_amount <= total_amount),
  check ((carrier_type is null) = (carrier_value_encrypted is null)),
  check (not (donation_code is not null and carrier_type is not null)),
  check (test_document or external_invoice_number is null or external_invoice_number !~ '^TEST-')
);

create index invoice_documents_status_idx
  on public.invoice_documents (organization_id, status, created_at desc);
create index invoice_documents_stall_issued_idx
  on public.invoice_documents (stall_id, issued_at desc);
create index invoice_documents_payment_idx
  on public.invoice_documents (payment_id);

create table public.invoice_provider_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_document_id uuid not null,
  operation_type varchar(32) not null
    check (operation_type in ('ISSUE', 'QUERY', 'VOID', 'ALLOWANCE', 'ALLOWANCE_VOID', 'CARRIER_VALIDATE', 'DONATION_VALIDATE', 'RECONCILE')),
  idempotency_key varchar(160) not null,
  provider_request_id varchar(160),
  external_reference varchar(160),
  status varchar(24) not null default 'PENDING'
    check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_SCHEDULED', 'DEAD_LETTERED')),
  attempt smallint not null default 0 check (attempt between 0 and 20),
  max_attempts smallint not null default 5 check (max_attempts between 1 and 20),
  request_hash varchar(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_code varchar(120),
  error_code varchar(120),
  error_message_sanitized varchar(500),
  next_attempt_at timestamptz,
  dead_lettered_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  constraint invoice_provider_operations_document_scope_fkey
    foreign key (invoice_document_id, organization_id)
    references public.invoice_documents(id, organization_id) on delete cascade
);

create index invoice_provider_operations_document_idx
  on public.invoice_provider_operations (invoice_document_id, operation_type, created_at desc);
create index invoice_provider_operations_retry_idx
  on public.invoice_provider_operations (status, next_attempt_at);

create table public.invoice_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_document_id uuid not null,
  provider varchar(24) not null,
  case_type varchar(64) not null,
  expected_amount integer,
  actual_amount integer,
  expected_tax_amount integer,
  actual_tax_amount integer,
  provider_reference varchar(160),
  review_status varchar(24) not null default 'OPEN'
    check (review_status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_code varchar(120),
  safe_notes varchar(1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_reconciliation_cases_document_scope_fkey
    foreign key (invoice_document_id, organization_id)
    references public.invoice_documents(id, organization_id) on delete restrict
);

create index invoice_reconciliation_cases_queue_idx
  on public.invoice_reconciliation_cases (organization_id, review_status, created_at desc);
create index invoice_reconciliation_cases_document_idx
  on public.invoice_reconciliation_cases (invoice_document_id, case_type, review_status);

insert into public.billing_feature_flags (code, is_enabled, phase, description) values
  ('EINVOICE_PLATFORM_ENABLED', false, 2, '店家自有帳號電子發票平台總開關。'),
  ('EINVOICE_MERCHANT_SETUP_ENABLED', false, 2, '允許商家準備電子發票設定；需在本機環境明確啟用。'),
  ('EINVOICE_CHECKOUT_UI_ENABLED', false, 2, '顧客結帳電子發票選擇器。'),
  ('EINVOICE_SANDBOX_ENABLED', false, 2, '外部供應商 Sandbox 呼叫。'),
  ('EINVOICE_PRODUCTION_ISSUE_ENABLED', false, 2, '正式電子發票開立。'),
  ('EINVOICE_ECPAY_ENABLED', false, 2, 'ECPay 電子發票 Adapter。'),
  ('EINVOICE_EZPAY_ENABLED', false, 2, 'ezPay 電子發票 Adapter。'),
  ('EINVOICE_TRADEVAN_ENABLED', false, 3, 'TradeVan 電子發票 Adapter。'),
  ('EINVOICE_AUTO_ISSUE_ENABLED', false, 2, '依政策自動開立。'),
  ('EINVOICE_AUTO_VOID_ENABLED', false, 3, '依核准政策自動作廢。'),
  ('EINVOICE_AUTO_ALLOWANCE_ENABLED', false, 3, '依核准政策自動折讓。'),
  ('EINVOICE_CARRIER_ENABLED', false, 2, '顧客載具欄位。'),
  ('EINVOICE_DONATION_ENABLED', false, 2, '顧客捐贈碼欄位。')
on conflict (code) do update
set is_enabled = excluded.is_enabled,
    description = excluded.description,
    updated_at = now();

alter table public.invoice_seller_profiles enable row level security;
alter table public.invoice_seller_profiles force row level security;
alter table public.invoice_provider_connections enable row level security;
alter table public.invoice_provider_connections force row level security;
alter table public.invoice_policy_versions enable row level security;
alter table public.invoice_policy_versions force row level security;
alter table public.invoice_checkout_preferences enable row level security;
alter table public.invoice_checkout_preferences force row level security;
alter table public.invoice_documents enable row level security;
alter table public.invoice_documents force row level security;
alter table public.invoice_provider_operations enable row level security;
alter table public.invoice_provider_operations force row level security;
alter table public.invoice_reconciliation_cases enable row level security;
alter table public.invoice_reconciliation_cases force row level security;

revoke all on table
  public.invoice_seller_profiles,
  public.invoice_provider_connections,
  public.invoice_policy_versions,
  public.invoice_checkout_preferences,
  public.invoice_documents,
  public.invoice_provider_operations,
  public.invoice_reconciliation_cases
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.invoice_seller_profiles,
  public.invoice_provider_connections,
  public.invoice_policy_versions,
  public.invoice_checkout_preferences,
  public.invoice_documents,
  public.invoice_provider_operations,
  public.invoice_reconciliation_cases
to service_role;

create trigger invoice_seller_profiles_touch_updated_at before update on public.invoice_seller_profiles
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger invoice_provider_connections_touch_updated_at before update on public.invoice_provider_connections
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger invoice_checkout_preferences_touch_updated_at before update on public.invoice_checkout_preferences
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger invoice_documents_touch_updated_at before update on public.invoice_documents
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger invoice_reconciliation_cases_touch_updated_at before update on public.invoice_reconciliation_cases
for each row execute function app_private.touch_competitive_enhancement_updated_at();

create or replace function app_private.enforce_invoice_policy_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'INVOICE_POLICY_VERSION_IMMUTABLE';
end;
$$;

create trigger invoice_policy_versions_immutable before update or delete on public.invoice_policy_versions
for each row execute function app_private.enforce_invoice_policy_immutable();

create or replace function app_private.enforce_invoice_operation_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.organization_id <> old.organization_id
    or new.invoice_document_id <> old.invoice_document_id
    or new.operation_type <> old.operation_type
    or new.idempotency_key <> old.idempotency_key
    or new.request_hash <> old.request_hash
    or new.created_at <> old.created_at then
    raise exception 'INVOICE_OPERATION_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger invoice_provider_operations_identity_immutable before update on public.invoice_provider_operations
for each row execute function app_private.enforce_invoice_operation_identity_immutable();

create trigger backend_writable_guard before insert or update or delete on public.invoice_seller_profiles
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_provider_connections
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_policy_versions
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_checkout_preferences
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_documents
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_provider_operations
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.invoice_reconciliation_cases
for each statement execute function app_private.enforce_backend_writable();

comment on table public.invoice_seller_profiles is
  'Merchant-owned legal seller identity. The platform organization is never substituted as seller.';
comment on table public.invoice_provider_connections is
  'Provider connection metadata only. Credential plaintext must remain in the referenced server-side secret store.';
comment on table public.invoice_checkout_preferences is
  'Order-scoped customer selection. Carrier values are encrypted server-side and are never copied into member profiles.';
comment on table public.invoice_documents is
  'Order e-invoice state is independent from order and payment state. test_document rows are not legal invoices.';
comment on table public.invoice_provider_operations is
  'Idempotent provider operation ledger. Request/response bodies and credential values are intentionally not stored.';
