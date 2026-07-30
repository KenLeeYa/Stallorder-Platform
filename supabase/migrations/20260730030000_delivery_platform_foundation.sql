-- Provider-neutral delivery integration foundation. All live provider features
-- remain disabled until partner approval, isolated credentials and canary review.

alter table public.orders
  add column external_provider text,
  add column external_order_id text,
  add column external_order_number text,
  add column external_store_id text,
  add column external_payment_status text,
  add column external_subtotal_amount integer,
  add column external_total_amount integer,
  add column merchant_receivable_amount integer,
  add column platform_discount_amount integer,
  add column merchant_discount_amount integer,
  add column scheduled_pickup_at timestamptz,
  add column rider_pickup_at timestamptz;

alter table public.orders
  add constraint orders_external_provider_check
    check (
      external_provider is null
      or external_provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')
    ),
  add constraint orders_external_amounts_nonnegative_check
    check (
      coalesce(external_subtotal_amount, 0) >= 0
      and coalesce(external_total_amount, 0) >= 0
      and coalesce(merchant_receivable_amount, 0) >= 0
      and coalesce(platform_discount_amount, 0) >= 0
      and coalesce(merchant_discount_amount, 0) >= 0
    );

create index orders_external_provider_created_idx
  on public.orders (stall_id, external_provider, created_at desc)
  where external_provider is not null;

create table public.delivery_platform_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  status text not null default 'DRAFT'
    check (status in (
      'DRAFT', 'PENDING_AUTHORIZATION', 'PENDING_PARTNER_APPROVAL',
      'PENDING_STORE_MAPPING', 'CONFIGURING', 'TESTING', 'ACTIVE', 'PAUSED',
      'ERROR', 'DISCONNECTED', 'REJECTED'
    )),
  external_chain_id text
    check (external_chain_id is null or char_length(external_chain_id) between 1 and 200),
  external_store_id text
    check (external_store_id is null or char_length(external_store_id) between 1 and 200),
  external_store_name text
    check (external_store_name is null or char_length(external_store_name) between 1 and 200),
  external_account_reference text
    check (
      external_account_reference is null
      or char_length(external_account_reference) between 1 and 240
    ),
  credential_reference text
    check (
      credential_reference is null
      or (
        char_length(credential_reference) between 10 and 240
        and credential_reference ~ '^(vercel|supabase|external-secret-manager)://[A-Za-z0-9_./:-]+$'
      )
    ),
  oauth_state_hash text
    check (oauth_state_hash is null or oauth_state_hash ~ '^[a-f0-9]{64}$'),
  oauth_pkce_verifier_reference text
    check (
      oauth_pkce_verifier_reference is null
      or (
        char_length(oauth_pkce_verifier_reference) between 10 and 240
        and oauth_pkce_verifier_reference ~ '^(vercel|supabase|external-secret-manager)://[A-Za-z0-9_./:-]+$'
      )
    ),
  oauth_expires_at timestamptz,
  provider_metadata_json jsonb not null default '{}'::jsonb,
  capabilities_json jsonb not null default '[]'::jsonb,
  connected_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  activated_at timestamptz,
  paused_at timestamptz,
  disconnected_at timestamptz,
  last_health_check_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_connections_scope_key
    unique (id, organization_id, stall_id, provider),
  constraint delivery_connections_active_timestamp_check
    check (status <> 'ACTIVE' or activated_at is not null),
  constraint delivery_connections_disconnect_timestamp_check
    check (status <> 'DISCONNECTED' or disconnected_at is not null)
);

create unique index delivery_connections_one_open_provider_idx
  on public.delivery_platform_connections (stall_id, provider)
  where status not in ('DISCONNECTED', 'REJECTED');

create unique index delivery_connections_external_store_idx
  on public.delivery_platform_connections (provider, external_store_id)
  where external_store_id is not null and status not in ('DISCONNECTED', 'REJECTED');

create index delivery_connections_org_status_idx
  on public.delivery_platform_connections (organization_id, status, updated_at desc);

create index delivery_connections_stall_status_idx
  on public.delivery_platform_connections (stall_id, status, updated_at desc);

create table public.delivery_platform_connection_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA')),
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  merchant_contact_name text not null
    check (char_length(btrim(merchant_contact_name)) between 2 and 120),
  merchant_contact_email text not null
    check (
      char_length(merchant_contact_email) between 3 and 320
      and merchant_contact_email = lower(merchant_contact_email)
    ),
  merchant_contact_phone text
    check (merchant_contact_phone is null or char_length(merchant_contact_phone) between 6 and 30),
  external_vendor_code text
    check (external_vendor_code is null or char_length(external_vendor_code) between 1 and 120),
  external_chain_code text
    check (external_chain_code is null or char_length(external_chain_code) between 1 and 120),
  current_provider text
    check (current_provider is null or char_length(current_provider) between 1 and 120),
  requested_capabilities_json jsonb not null default '[]'::jsonb,
  status text not null default 'DRAFT'
    check (status in (
      'DRAFT', 'SUBMITTED', 'NEEDS_INFORMATION', 'APPROVED_FOR_CONFIGURATION',
      'REJECTED', 'CANCELLED', 'COMPLETED'
    )),
  merchant_note text
    check (merchant_note is null or char_length(merchant_note) <= 2000),
  admin_note text
    check (admin_note is null or char_length(admin_note) <= 2000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_connection_requests_submitted_check
    check (status = 'DRAFT' or submitted_at is not null)
);

create unique index delivery_connection_requests_one_open_idx
  on public.delivery_platform_connection_requests (stall_id, provider)
  where status in ('DRAFT', 'SUBMITTED', 'NEEDS_INFORMATION', 'APPROVED_FOR_CONFIGURATION');

create index delivery_connection_requests_review_idx
  on public.delivery_platform_connection_requests (status, submitted_at, created_at);

create index delivery_connection_requests_org_idx
  on public.delivery_platform_connection_requests (organization_id, updated_at desc);

create table public.external_store_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  connection_id uuid not null,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  external_chain_id text
    check (external_chain_id is null or char_length(external_chain_id) between 1 and 200),
  external_store_id text not null
    check (char_length(external_store_id) between 1 and 200),
  external_store_name text not null
    check (char_length(btrim(external_store_name)) between 1 and 200),
  mapping_status text not null default 'UNVERIFIED'
    check (mapping_status in ('UNVERIFIED', 'VERIFIED', 'CONFLICT', 'DISABLED')),
  verified_at timestamptz,
  verified_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_store_mappings_connection_scope_fkey
    foreign key (connection_id, organization_id, stall_id, provider)
    references public.delivery_platform_connections (id, organization_id, stall_id, provider)
    on delete cascade,
  constraint external_store_mappings_verified_check
    check (mapping_status <> 'VERIFIED' or verified_at is not null),
  constraint external_store_mappings_connection_store_key
    unique (connection_id, external_store_id)
);

create unique index external_store_mappings_provider_store_idx
  on public.external_store_mappings (provider, external_store_id)
  where mapping_status <> 'DISABLED';

create index external_store_mappings_stall_status_idx
  on public.external_store_mappings (stall_id, mapping_status, updated_at desc);

create table public.external_menu_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  connection_id uuid not null,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  internal_entity_type text not null
    check (internal_entity_type in (
      'CATEGORY', 'PRODUCT', 'MODIFIER_GROUP', 'MODIFIER_ITEM', 'COMBO'
    )),
  internal_entity_id uuid not null,
  external_entity_id text not null
    check (char_length(external_entity_id) between 1 and 200),
  external_parent_id text
    check (external_parent_id is null or char_length(external_parent_id) between 1 and 200),
  mapping_status text not null default 'UNMAPPED'
    check (mapping_status in (
      'UNMAPPED', 'MAPPED', 'SYNCED', 'OUT_OF_SYNC', 'ERROR', 'DISABLED'
    )),
  provider_snapshot_json jsonb,
  last_synced_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_menu_mappings_connection_scope_fkey
    foreign key (connection_id, organization_id, stall_id, provider)
    references public.delivery_platform_connections (id, organization_id, stall_id, provider)
    on delete cascade,
  constraint external_menu_mappings_internal_key
    unique (connection_id, internal_entity_type, internal_entity_id),
  constraint external_menu_mappings_external_key
    unique (connection_id, internal_entity_type, external_entity_id)
);

create index external_menu_mappings_unmapped_idx
  on public.external_menu_mappings (connection_id, mapping_status, internal_entity_type);

create index external_menu_mappings_stall_idx
  on public.external_menu_mappings (stall_id, updated_at desc);

create table public.external_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  connection_id uuid not null,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  external_order_id text not null
    check (char_length(external_order_id) between 1 and 200),
  external_order_number text
    check (external_order_number is null or char_length(external_order_number) between 1 and 120),
  internal_order_id uuid unique references public.orders(id) on delete restrict,
  external_store_id text not null
    check (char_length(external_store_id) between 1 and 200),
  external_status text not null
    check (char_length(external_status) between 1 and 120),
  processing_status text not null default 'RECEIVED'
    check (processing_status in (
      'RECEIVED', 'VALIDATING', 'MAPPING_REQUIRED', 'READY_FOR_IMPORT',
      'IMPORTED', 'WAITING_PROVIDER_CONFIRMATION', 'CONFIRMED', 'REJECTED',
      'FAILED', 'CANCELLED'
    )),
  currency text not null default 'TWD'
    check (currency ~ '^[A-Z]{3}$'),
  external_subtotal_amount integer check (external_subtotal_amount is null or external_subtotal_amount >= 0),
  external_discount_amount integer check (external_discount_amount is null or external_discount_amount >= 0),
  merchant_discount_amount integer check (merchant_discount_amount is null or merchant_discount_amount >= 0),
  platform_discount_amount integer check (platform_discount_amount is null or platform_discount_amount >= 0),
  external_delivery_fee_amount integer check (external_delivery_fee_amount is null or external_delivery_fee_amount >= 0),
  external_service_fee_amount integer check (external_service_fee_amount is null or external_service_fee_amount >= 0),
  external_tax_amount integer check (external_tax_amount is null or external_tax_amount >= 0),
  external_total_amount integer check (external_total_amount is null or external_total_amount >= 0),
  merchant_receivable_amount integer check (merchant_receivable_amount is null or merchant_receivable_amount >= 0),
  scheduled_pickup_at timestamptz,
  rider_pickup_at timestamptz,
  received_at timestamptz not null default now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_synced_at timestamptz,
  payload_reference text
    check (
      payload_reference is null
      or (
        char_length(payload_reference) between 10 and 500
        and payload_reference ~ '^(supabase|external-secret-manager)://[A-Za-z0-9_./:-]+$'
      )
    ),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  received_via_circuit text not null default 'UNKNOWN'
    check (received_via_circuit in (
      'CIRCUIT_A_EDGE', 'CIRCUIT_B_VERCEL', 'BACKGROUND_JOB',
      'PLATFORM_ADMIN', 'UNKNOWN'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_orders_connection_scope_fkey
    foreign key (connection_id, organization_id, stall_id, provider)
    references public.delivery_platform_connections (id, organization_id, stall_id, provider)
    on delete restrict,
  constraint external_orders_provider_order_key
    unique (provider, external_order_id)
);

create index external_orders_stall_processing_idx
  on public.external_orders (stall_id, processing_status, received_at desc);

create index external_orders_connection_received_idx
  on public.external_orders (connection_id, received_at desc);

create table public.delivery_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  connection_id uuid references public.delivery_platform_connections(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  stall_id uuid references public.stalls(id) on delete set null,
  external_event_id text
    check (external_event_id is null or char_length(external_event_id) between 1 and 200),
  event_type text not null
    check (char_length(event_type) between 1 and 160),
  signature_valid boolean not null,
  replay_key text not null
    check (replay_key ~ '^[a-f0-9]{64}$'),
  payload_hash text not null
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  payload_reference text
    check (
      payload_reference is null
      or (
        char_length(payload_reference) between 10 and 500
        and payload_reference ~ '^(supabase|external-secret-manager)://[A-Za-z0-9_./:-]+$'
      )
    ),
  received_via_circuit text not null default 'UNKNOWN'
    check (received_via_circuit in (
      'CIRCUIT_A_EDGE', 'CIRCUIT_B_VERCEL', 'BACKGROUND_JOB',
      'PLATFORM_ADMIN', 'UNKNOWN'
    )),
  processing_status text not null default 'RECEIVED'
    check (processing_status in (
      'RECEIVED', 'VERIFIED', 'PROCESSING', 'PROCESSED',
      'RETRY_PENDING', 'DEAD_LETTER', 'REJECTED'
    )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
  last_error_message_safe text
    check (last_error_message_safe is null or char_length(last_error_message_safe) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_webhook_events_provider_replay_key
    unique (provider, replay_key)
);

create index delivery_webhook_events_process_idx
  on public.delivery_webhook_events (processing_status, next_attempt_at, received_at);

create index delivery_webhook_events_connection_idx
  on public.delivery_webhook_events (connection_id, received_at desc);

create table public.delivery_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  connection_id uuid not null,
  provider text not null
    check (provider in ('UBER_EATS', 'FOODPANDA', 'MOCK')),
  job_type text not null
    check (job_type in (
      'CONNECTION_HEALTH_CHECK', 'STORE_DISCOVERY', 'STORE_ACTIVATION',
      'MENU_FULL_SYNC', 'MENU_INCREMENTAL_SYNC', 'AVAILABILITY_SYNC',
      'ORDER_IMPORT', 'ORDER_ACCEPT', 'ORDER_REJECT', 'ORDER_PREPARING',
      'ORDER_READY', 'ORDER_RECONCILIATION', 'CONNECTION_DISCONNECT'
    )),
  status text not null default 'PENDING'
    check (status in (
      'PENDING', 'PROCESSING', 'SUCCEEDED', 'RETRY_PENDING',
      'FAILED', 'DEAD_LETTER', 'CANCELLED'
    )),
  priority smallint not null default 100 check (priority between 0 and 1000),
  deduplication_key text not null
    check (char_length(deduplication_key) between 8 and 240),
  requested_via_circuit text not null default 'UNKNOWN'
    check (requested_via_circuit in (
      'CIRCUIT_A_EDGE', 'CIRCUIT_B_VERCEL', 'BACKGROUND_JOB',
      'PLATFORM_ADMIN', 'UNKNOWN'
    )),
  claimed_by_worker text
    check (claimed_by_worker is null or char_length(claimed_by_worker) between 1 and 160),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'
    ),
  last_error_message_safe text
    check (last_error_message_safe is null or char_length(last_error_message_safe) <= 500),
  input_json jsonb not null default '{}'::jsonb,
  result_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_sync_jobs_connection_scope_fkey
    foreign key (connection_id, organization_id, stall_id, provider)
    references public.delivery_platform_connections (id, organization_id, stall_id, provider)
    on delete cascade,
  constraint delivery_sync_jobs_provider_deduplication_key
    unique (provider, deduplication_key),
  constraint delivery_sync_jobs_attempt_check
    check (attempt_count <= max_attempts)
);

create index delivery_sync_jobs_claim_idx
  on public.delivery_sync_jobs (status, scheduled_at, priority, created_at);

create index delivery_sync_jobs_connection_idx
  on public.delivery_sync_jobs (connection_id, created_at desc);

create or replace function app_private.enforce_delivery_primary_writer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  perform app_private.assert_backend_writable(null);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_delivery_primary_writer()
  from public, anon, authenticated, service_role;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'delivery_platform_connections',
    'delivery_platform_connection_requests',
    'external_store_mappings',
    'external_menu_mappings',
    'external_orders',
    'delivery_webhook_events',
    'delivery_sync_jobs'
  ]
  loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each statement execute function app_private.enforce_delivery_primary_writer()',
      target_table || '_primary_writer_guard',
      target_table
    );
  end loop;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'delivery_platform_connections',
    'delivery_platform_connection_requests',
    'external_store_mappings',
    'external_menu_mappings',
    'external_orders',
    'delivery_webhook_events',
    'delivery_sync_jobs'
  ]
  loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('alter table public.%I force row level security', target_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      target_table
    );
  end loop;
end;
$$;

grant select on table
  public.delivery_platform_connections,
  public.delivery_platform_connection_requests,
  public.external_store_mappings,
  public.external_menu_mappings,
  public.external_orders
to authenticated;

grant select, insert, update, delete on table
  public.delivery_platform_connections,
  public.delivery_platform_connection_requests,
  public.external_store_mappings,
  public.external_menu_mappings,
  public.external_orders,
  public.delivery_webhook_events,
  public.delivery_sync_jobs
to service_role;

create policy delivery_connections_authorized_select
  on public.delivery_platform_connections
  for select
  to authenticated
  using (
    app_private.is_platform_admin()
    or app_private.can_manage_stall(stall_id)
  );

create policy delivery_connection_requests_authorized_select
  on public.delivery_platform_connection_requests
  for select
  to authenticated
  using (
    app_private.is_platform_admin()
    or app_private.can_manage_stall(stall_id)
  );

create policy external_store_mappings_authorized_select
  on public.external_store_mappings
  for select
  to authenticated
  using (
    app_private.is_platform_admin()
    or app_private.can_manage_stall(stall_id)
  );

create policy external_menu_mappings_authorized_select
  on public.external_menu_mappings
  for select
  to authenticated
  using (
    app_private.is_platform_admin()
    or app_private.can_manage_stall(stall_id)
  );

create policy external_orders_authorized_select
  on public.external_orders
  for select
  to authenticated
  using (
    app_private.is_platform_admin()
    or app_private.can_view_stall_financials(stall_id)
    or app_private.has_stall_role(
      stall_id,
      array[
        'STALL_MANAGER'::public.user_role,
        'STAFF'::public.user_role
      ]
    )
  );

comment on table public.delivery_platform_connections is
  'Provider-neutral delivery connection metadata. Raw credentials and tokens are prohibited.';
comment on table public.delivery_webhook_events is
  'Replay-safe Webhook evidence ledger. Raw payloads are stored only through approved secure references.';
comment on table public.external_orders is
  'External provider order ledger linked to the existing canonical orders table.';
comment on table public.delivery_sync_jobs is
  'PostgreSQL-backed idempotent delivery action and synchronization queue.';
