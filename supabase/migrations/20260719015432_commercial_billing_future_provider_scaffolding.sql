create unique index if not exists invoices_id_organization_future_provider_idx
  on public.invoices (id, organization_id);

create table public.payment_provider_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  provider_customer_id text not null check (char_length(provider_customer_id) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'DELETED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_customers_org_provider_unique unique (organization_id, provider),
  constraint payment_provider_customers_provider_id_unique unique (provider, provider_customer_id)
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  provider text not null check (provider ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  provider_transaction_id text check (
    provider_transaction_id is null or char_length(provider_transaction_id) between 1 and 200
  ),
  amount integer not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'CREATED'
    check (status in ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED')),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  failure_message text check (failure_message is null or char_length(failure_message) <= 500),
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_invoice_organization_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id)
    on delete restrict,
  constraint payment_attempts_completion_check check (
    status not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED') or completed_at is not null
  )
);

create unique index payment_attempts_provider_transaction_unique_idx
  on public.payment_attempts (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index payment_attempts_invoice_status_idx
  on public.payment_attempts (invoice_id, status, attempted_at desc);
create index payment_attempts_org_status_idx
  on public.payment_attempts (organization_id, status, attempted_at desc);

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  processing_status text not null default 'RECEIVED'
    check (processing_status in ('RECEIVED', 'VERIFIED', 'PROCESSED', 'REJECTED', 'FAILED', 'DUPLICATE')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  constraint billing_webhook_events_provider_event_unique unique (provider, provider_event_id),
  constraint billing_webhook_events_processed_check check (
    processing_status not in ('PROCESSED', 'REJECTED', 'FAILED', 'DUPLICATE') or processed_at is not null
  )
);

create index billing_webhook_events_processing_idx
  on public.billing_webhook_events (processing_status, received_at);

create table public.tax_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  provider text check (provider is null or provider ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  document_type text not null check (document_type in ('INVOICE', 'ALLOWANCE')),
  tax_id text check (tax_id is null or char_length(tax_id) <= 20),
  carrier_type text check (carrier_type is null or carrier_type ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  carrier_value_hash text check (carrier_value_hash is null or carrier_value_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'CREATED'
    check (status in ('CREATED', 'PENDING', 'ISSUED', 'VOIDED', 'FAILED')),
  provider_document_id text check (
    provider_document_id is null or char_length(provider_document_id) between 1 and 200
  ),
  issued_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_documents_invoice_organization_fk
    foreign key (invoice_id, organization_id)
    references public.invoices(id, organization_id)
    on delete restrict,
  constraint tax_documents_issued_check check (status <> 'ISSUED' or issued_at is not null),
  constraint tax_documents_voided_check check (status <> 'VOIDED' or voided_at is not null)
);

create unique index tax_documents_provider_document_unique_idx
  on public.tax_documents (provider, provider_document_id)
  where provider is not null and provider_document_id is not null;
create index tax_documents_invoice_status_idx
  on public.tax_documents (invoice_id, status, created_at desc);
create index tax_documents_org_status_idx
  on public.tax_documents (organization_id, status, created_at desc);

create table public.tax_document_events (
  id uuid primary key default gen_random_uuid(),
  tax_document_id uuid not null references public.tax_documents(id) on delete cascade,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  provider_event_id text check (
    provider_event_id is null or char_length(provider_event_id) between 1 and 200
  ),
  status text not null check (status ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index tax_document_events_provider_event_unique_idx
  on public.tax_document_events (tax_document_id, provider_event_id)
  where provider_event_id is not null;
create index tax_document_events_document_created_idx
  on public.tax_document_events (tax_document_id, created_at);

create trigger payment_provider_customers_touch_updated_at
before update on public.payment_provider_customers
for each row execute function public.touch_commercial_updated_at();

create trigger payment_attempts_touch_updated_at
before update on public.payment_attempts
for each row execute function public.touch_commercial_updated_at();

create trigger tax_documents_touch_updated_at
before update on public.tax_documents
for each row execute function public.touch_commercial_updated_at();

alter table public.payment_provider_customers enable row level security;
alter table public.payment_provider_customers force row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_attempts force row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_webhook_events force row level security;
alter table public.tax_documents enable row level security;
alter table public.tax_documents force row level security;
alter table public.tax_document_events enable row level security;
alter table public.tax_document_events force row level security;

revoke all on table
  public.payment_provider_customers,
  public.payment_attempts,
  public.billing_webhook_events,
  public.tax_documents,
  public.tax_document_events
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.payment_provider_customers,
  public.payment_attempts,
  public.billing_webhook_events,
  public.tax_documents,
  public.tax_document_events
to service_role;

insert into public.billing_feature_flags (code, is_enabled, phase, description) values
  ('AUTOMATED_BILLING_ENABLED', false, 2, 'External automated billing adapters.'),
  ('ECPAY_BILLING_ENABLED', false, 2, 'ECPay billing adapter.'),
  ('NEWEBPAY_BILLING_ENABLED', false, 2, 'NewebPay billing adapter.'),
  ('E_INVOICE_ENABLED', false, 2, 'Electronic invoice adapter.')
on conflict (code) do update set
  is_enabled = false,
  phase = excluded.phase,
  description = excluded.description,
  updated_at = now();
