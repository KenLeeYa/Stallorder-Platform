-- Competitive enhancement Phase 8: scoped Public API and outbound webhook foundation.
-- Additive only. API access and delivery remain disabled by default through
-- MODULE_PUBLIC_API_ENABLED and explicit endpoint lifecycle state.

create table public.public_api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null,
  stall_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'ACTIVE',
  expires_at timestamptz,
  last_used_at timestamptz,
  rotated_from_client_id uuid references public.public_api_clients(id) on delete restrict,
  revoked_at timestamptz,
  revoked_reason text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_api_clients_scope_key unique (id, organization_id),
  constraint public_api_clients_hash_key unique (key_hash),
  constraint public_api_clients_prefix_key unique (organization_id, key_prefix),
  constraint public_api_clients_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint public_api_clients_prefix_check check (key_prefix ~ '^slo_v1_[A-Za-z0-9_-]{8,24}$'),
  constraint public_api_clients_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint public_api_clients_scopes_check check (
    cardinality(scopes) between 1 and 10
    and scopes <@ array[
      'catalog:read', 'orders:read', 'customers:read', 'inventory:read', 'webhooks:write'
    ]::text[]
  ),
  constraint public_api_clients_stalls_check check (cardinality(stall_ids) <= 100),
  constraint public_api_clients_status_check check (status in ('ACTIVE', 'REVOKED')),
  constraint public_api_clients_lifecycle_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_reason is null)
    or (
      status = 'REVOKED'
      and revoked_at is not null
      and char_length(btrim(revoked_reason)) between 1 and 300
    )
  )
);

create index public_api_clients_active_idx
  on public.public_api_clients (organization_id, status, expires_at, id);

create table public.outbound_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  url text not null,
  event_types text[] not null,
  secret_reference uuid not null,
  secret_version integer not null default 1,
  status text not null default 'DISABLED',
  timeout_ms integer not null default 5000,
  max_attempts integer not null default 5,
  consecutive_failures integer not null default 0,
  last_successful_at timestamptz,
  last_error_code text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_webhook_endpoints_scope_key unique (id, organization_id),
  constraint outbound_webhook_endpoints_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint outbound_webhook_endpoints_url_check check (
    char_length(url) between 12 and 500 and url ~ '^https://'
  ),
  constraint outbound_webhook_endpoints_events_check check (
    cardinality(event_types) between 1 and 20
    and event_types <@ array[
      'CATALOG_PUBLISHED', 'ORDER_CREATED', 'ORDER_CONFIRMED',
      'ORDER_COMPLETED', 'ORDER_CANCELLED', 'INVENTORY_LOW'
    ]::text[]
  ),
  constraint outbound_webhook_endpoints_version_check check (secret_version between 1 and 1000000),
  constraint outbound_webhook_endpoints_status_check check (status in ('ACTIVE', 'DISABLED', 'ERROR')),
  constraint outbound_webhook_endpoints_timeout_check check (timeout_ms between 1000 and 10000),
  constraint outbound_webhook_endpoints_attempts_check check (max_attempts between 1 and 10),
  constraint outbound_webhook_endpoints_failures_check check (consecutive_failures between 0 and 1000000),
  constraint outbound_webhook_endpoints_error_check check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,119}$'
  )
);

create index outbound_webhook_endpoints_active_idx
  on public.outbound_webhook_endpoints (organization_id, status, id);

create table public.outbound_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null,
  event_id uuid not null,
  event_type text not null,
  payload_version integer not null default 1,
  payload_hash text not null,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_response_status integer,
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_webhook_deliveries_endpoint_scope_fkey
    foreign key (endpoint_id, organization_id)
    references public.outbound_webhook_endpoints(id, organization_id) on delete cascade,
  constraint outbound_webhook_deliveries_event_key unique (endpoint_id, event_id),
  constraint outbound_webhook_deliveries_type_check check (event_type in (
    'CATALOG_PUBLISHED', 'ORDER_CREATED', 'ORDER_CONFIRMED',
    'ORDER_COMPLETED', 'ORDER_CANCELLED', 'INVENTORY_LOW'
  )),
  constraint outbound_webhook_deliveries_version_check check (payload_version between 1 and 1000),
  constraint outbound_webhook_deliveries_hash_check check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint outbound_webhook_deliveries_status_check check (status in (
    'PENDING', 'DELIVERING', 'RETRY_PENDING', 'DELIVERED', 'DEAD_LETTER', 'CANCELLED'
  )),
  constraint outbound_webhook_deliveries_attempt_check check (attempt_count between 0 and 10),
  constraint outbound_webhook_deliveries_response_check check (
    last_response_status is null or last_response_status between 100 and 599
  ),
  constraint outbound_webhook_deliveries_error_check check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,119}$'
  )
);

create index outbound_webhook_deliveries_queue_idx
  on public.outbound_webhook_deliveries (status, next_attempt_at, created_at, id)
  where status in ('PENDING', 'RETRY_PENDING');
create index outbound_webhook_deliveries_scope_idx
  on public.outbound_webhook_deliveries (organization_id, endpoint_id, created_at desc, id desc);

create trigger public_api_clients_touch_updated_at
before update on public.public_api_clients
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.public_api_clients
for each statement execute function app_private.enforce_backend_writable();

create trigger outbound_webhook_endpoints_touch_updated_at
before update on public.outbound_webhook_endpoints
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.outbound_webhook_endpoints
for each statement execute function app_private.enforce_backend_writable();

create trigger outbound_webhook_deliveries_touch_updated_at
before update on public.outbound_webhook_deliveries
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.outbound_webhook_deliveries
for each statement execute function app_private.enforce_backend_writable();

alter table public.public_api_clients enable row level security;
alter table public.public_api_clients force row level security;
alter table public.outbound_webhook_endpoints enable row level security;
alter table public.outbound_webhook_endpoints force row level security;
alter table public.outbound_webhook_deliveries enable row level security;
alter table public.outbound_webhook_deliveries force row level security;

revoke all on table public.public_api_clients from public, anon, authenticated;
revoke all on table public.outbound_webhook_endpoints from public, anon, authenticated;
revoke all on table public.outbound_webhook_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.public_api_clients to service_role;
grant select, insert, update, delete on table public.outbound_webhook_endpoints to service_role;
grant select, insert, update, delete on table public.outbound_webhook_deliveries to service_role;

comment on table public.public_api_clients is
  'Scoped, expiring API client metadata. Only a SHA-256 key hash is persisted.';
comment on table public.outbound_webhook_endpoints is
  'Outbound webhook subscription metadata. Signing material is referenced from Vault.';
comment on table public.outbound_webhook_deliveries is
  'Idempotent delivery metadata with a payload digest and no business payload body.';
