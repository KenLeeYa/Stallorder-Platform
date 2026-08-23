do $$
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

    insert into public.resilience_feature_flags (
      code, description, default_enabled, is_emergency
    ) values
      ('OAUTH_MICROSOFT_ENABLED', 'Optional Microsoft OIDC provider. Disabled until exact issuer and tenant configuration are verified.', false, false),
      ('AUTH_PASSKEYS_ENABLED', 'Passkey/WebAuthn second-stage foundation. Disabled until RP ID, Origin, and verifier acceptance pass.', false, false),
      ('PAYMENTS_FOUNDATION_ENABLED', 'Provider-neutral payment foundation gate. Disabled until approved release migration and acceptance.', false, false),
      ('PAYMENTS_MOCK_PROVIDER_ENABLED', 'Deterministic non-Production payment provider used only for local and ephemeral Preview acceptance.', false, false),
      ('PAYMENTS_LINE_PAY_ENABLED', 'LINE Pay live transport gate. Keep disabled until sandbox and merchant credentials pass E2E.', false, false),
      ('PAYMENTS_JKO_PAY_ENABLED', 'JKO Pay live transport gate. Requires contracted provider documentation.', false, false),
      ('PAYMENTS_TWQR_ENABLED', 'TWQR acquiring connection gate. Wallet capabilities come from the merchant acquirer contract.', false, false),
      ('PAYMENTS_TAIWAN_PAY_ENABLED', 'Taiwan Pay capability gate. Does not imply support for every TWQR wallet.', false, false),
      ('PAYMENTS_PX_PAY_PLUS_ENABLED', 'PX Pay Plus live transport gate. Requires contracted provider documentation.', false, false),
      ('PAYMENTS_IPASS_MONEY_ENABLED', 'iPASS MONEY capability gate. Requires verified acquirer or provider capability.', false, false),
      ('PAYMENTS_ICASH_PAY_ENABLED', 'icash Pay capability gate. Requires verified acquirer or provider capability.', false, false),
      ('PAYMENTS_PLUS_PAY_ENABLED', 'Plus Pay capability gate. Requires verified acquirer or provider capability.', false, false),
      ('PAYMENTS_EASY_WALLET_ENABLED', 'Easy Wallet capability gate. Requires verified acquirer or provider capability.', false, false),
      ('PAYMENTS_GAMA_PAY_ENABLED', 'GAMA Pay live transport gate. Requires a contracted provider or gateway.', false, false),
      ('PAYMENTS_OPAY_ENABLED', 'O Pay live transport gate. Requires a contracted provider or gateway.', false, false),
      ('PAYMENTS_GATEWAY_ENABLED', 'Hosted tokenized payment gateway family gate.', false, false),
      ('PAYMENTS_REFUNDS_ENABLED', 'Provider-authoritative digital refund workflow gate.', false, false),
      ('PAYMENTS_RECONCILIATION_ENABLED', 'Provider settlement reconciliation workflow gate.', false, false)
    on conflict (code) do nothing;
  end if;
end;
$$;

create table public.passkey_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  credential_id_hash text not null unique,
  public_key text not null,
  sign_count bigint not null default 0,
  transports text[] not null default '{}',
  device_label text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint passkey_credentials_id_hash_check
    check (credential_id_hash ~ '^[0-9a-f]{64}$'),
  constraint passkey_credentials_public_key_check
    check (length(public_key) between 32 and 8192),
  constraint passkey_credentials_sign_count_check check (sign_count >= 0),
  constraint passkey_credentials_transports_check
    check (transports <@ array['usb', 'nfc', 'ble', 'internal', 'hybrid']::text[]),
  constraint passkey_credentials_device_label_check
    check (length(btrim(device_label)) between 1 and 120),
  constraint passkey_credentials_time_check
    check (last_used_at is null or last_used_at >= created_at)
);

create index passkey_credentials_profile_active_idx
  on public.passkey_credentials (profile_id, revoked_at, created_at desc);

create table public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  challenge_hash text not null unique,
  purpose text not null,
  rp_id text not null,
  origin text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint passkey_challenges_hash_check
    check (challenge_hash ~ '^[0-9a-f]{64}$'),
  constraint passkey_challenges_purpose_check
    check (purpose in ('REGISTER', 'AUTHENTICATE', 'REAUTHENTICATE')),
  constraint passkey_challenges_rp_id_check
    check (length(rp_id) between 1 and 253 and rp_id !~ '[/\\[:space:]]'),
  constraint passkey_challenges_origin_check check (
    origin ~ '^https://[^/?#]+$'
    or origin ~ '^http://(localhost|127\\.0\\.0\\.1)(:[0-9]{2,5})?$'
  ),
  constraint passkey_challenges_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  constraint passkey_challenges_consumed_check
    check (consumed_at is null or consumed_at >= created_at)
);

create index passkey_challenges_profile_expiry_idx
  on public.passkey_challenges (profile_id, purpose, expires_at);

create table public.payment_provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid references public.stalls(id) on delete cascade,
  provider text not null,
  connection_mode text not null,
  environment text not null,
  status text not null default 'DISABLED',
  secret_reference text,
  merchant_reference text,
  store_reference text,
  acquirer_reference text,
  capabilities jsonb not null default '{}'::jsonb,
  enabled_channels text[] not null default '{}',
  last_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_connections_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint payment_provider_connections_provider_check check (
    provider in (
      'CASH_MANUAL', 'LINE_PAY', 'JKO_PAY', 'TWQR', 'TAIWAN_PAY',
      'PX_PAY_PLUS', 'IPASS_MONEY', 'ICASH_PAY', 'PLUS_PAY',
      'EASY_WALLET', 'GAMA_PAY', 'OPAY', 'PAYMENT_GATEWAY'
    )
  ),
  constraint payment_provider_connections_mode_check
    check (connection_mode in ('DIRECT', 'TWQR', 'GATEWAY', 'MANUAL')),
  constraint payment_provider_connections_environment_check
    check (environment in ('MOCK', 'SANDBOX', 'LIVE')),
  constraint payment_provider_connections_status_check
    check (status in ('DISABLED', 'PENDING_SETUP', 'READY', 'ACTIVE', 'ERROR')),
  constraint payment_provider_connections_secret_reference_check check (
    secret_reference is null
    or secret_reference ~ '^(vercel|supabase|vault|env)://[A-Za-z0-9_./:-]{3,240}$'
  ),
  constraint payment_provider_connections_capabilities_check
    check (jsonb_typeof(capabilities) = 'object'),
  constraint payment_provider_connections_channels_check check (
    enabled_channels <@ array['DINE_IN', 'TAKEOUT', 'DELIVERY', 'STAFF_POS', 'PUBLIC_MENU']::text[]
  ),
  constraint payment_provider_connections_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

create unique index payment_provider_connections_scope_key
  on public.payment_provider_connections (
    organization_id, coalesce(stall_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider, environment
  );
create unique index payment_provider_connections_id_scope_key
  on public.payment_provider_connections (id, organization_id, stall_id);
create index payment_provider_connections_health_idx
  on public.payment_provider_connections (provider, environment, status, updated_at);

create table public.payment_provider_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  order_id uuid not null,
  provider_connection_id uuid not null references public.payment_provider_connections(id) on delete restrict,
  payment_option_id uuid references public.payment_options(id) on delete set null,
  provider text not null,
  funding_method text,
  provider_transaction_id text,
  merchant_order_id text not null,
  amount integer not null,
  currency text not null default 'TWD',
  status text not null default 'CREATED',
  provider_status text,
  requested_at timestamptz not null default now(),
  authorized_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  browser_returned_at timestamptz,
  last_verified_at timestamptz,
  idempotency_key_hash text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_transactions_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint payment_provider_transactions_order_scope_fkey
    foreign key (order_id, organization_id, stall_id)
    references public.orders(id, organization_id, stall_id) on delete restrict,
  constraint payment_provider_transactions_amount_check check (amount > 0),
  constraint payment_provider_transactions_currency_check check (currency = 'TWD'),
  constraint payment_provider_transactions_status_check check (
    status in (
      'CREATED', 'PENDING', 'REQUIRES_CUSTOMER_ACTION', 'AUTHORIZED', 'PAID',
      'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED',
      'RECONCILIATION_REQUIRED'
    )
  ),
  constraint payment_provider_transactions_provider_check check (
    provider in (
      'CASH_MANUAL', 'LINE_PAY', 'JKO_PAY', 'TWQR', 'TAIWAN_PAY',
      'PX_PAY_PLUS', 'IPASS_MONEY', 'ICASH_PAY', 'PLUS_PAY',
      'EASY_WALLET', 'GAMA_PAY', 'OPAY', 'PAYMENT_GATEWAY'
    )
  ),
  constraint payment_provider_transactions_provider_id_check
    check (provider_transaction_id is null or length(provider_transaction_id) between 8 and 200),
  constraint payment_provider_transactions_merchant_order_check
    check (length(merchant_order_id) between 1 and 120),
  constraint payment_provider_transactions_idempotency_check
    check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_provider_transactions_metadata_check
    check (metadata is null or jsonb_typeof(metadata) = 'object')
);

create unique index payment_provider_transactions_id_scope_key
  on public.payment_provider_transactions (id, organization_id, stall_id);
create unique index payment_provider_transactions_idempotency_key
  on public.payment_provider_transactions (
    organization_id, stall_id, provider, idempotency_key_hash
  );
create unique index payment_provider_transactions_provider_transaction_key
  on public.payment_provider_transactions (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index payment_provider_transactions_order_idx
  on public.payment_provider_transactions (order_id, created_at desc);
create index payment_provider_transactions_health_idx
  on public.payment_provider_transactions (
    organization_id, stall_id, status, created_at desc
  );

create table public.payment_provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  provider_connection_id uuid references public.payment_provider_connections(id) on delete set null,
  transaction_id uuid,
  provider text not null,
  external_event_id text not null,
  body_hash text not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'RECEIVED',
  attempt_count integer not null default 0,
  sanitized_error_code text,
  constraint payment_provider_webhook_events_transaction_scope_fkey
    foreign key (transaction_id, organization_id, stall_id)
    references public.payment_provider_transactions(id, organization_id, stall_id)
    on delete restrict,
  constraint payment_provider_webhook_events_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint payment_provider_webhook_events_provider_check check (
    provider in (
      'CASH_MANUAL', 'LINE_PAY', 'JKO_PAY', 'TWQR', 'TAIWAN_PAY',
      'PX_PAY_PLUS', 'IPASS_MONEY', 'ICASH_PAY', 'PLUS_PAY',
      'EASY_WALLET', 'GAMA_PAY', 'OPAY', 'PAYMENT_GATEWAY'
    )
  ),
  constraint payment_provider_webhook_events_body_hash_check
    check (body_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_provider_webhook_events_status_check
    check (processing_status in ('RECEIVED', 'VERIFIED', 'APPLIED', 'DUPLICATE', 'FAILED', 'IGNORED')),
  constraint payment_provider_webhook_events_attempt_check check (attempt_count >= 0),
  constraint payment_provider_webhook_events_error_check
    check (sanitized_error_code is null or sanitized_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

create unique index payment_provider_webhook_events_provider_event_key
  on public.payment_provider_webhook_events (provider, external_event_id);
create index payment_provider_webhook_events_health_idx
  on public.payment_provider_webhook_events (
    organization_id, stall_id, processing_status, received_at
  );

create table public.payment_provider_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  transaction_id uuid not null,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_amount integer not null,
  currency text not null default 'TWD',
  reason text not null,
  provider_refund_id text unique,
  status text not null default 'REQUESTED',
  idempotency_key_hash text not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  sanitized_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_refunds_transaction_scope_fkey
    foreign key (transaction_id, organization_id, stall_id)
    references public.payment_provider_transactions(id, organization_id, stall_id)
    on delete restrict,
  constraint payment_provider_refunds_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint payment_provider_refunds_amount_check check (requested_amount > 0),
  constraint payment_provider_refunds_currency_check check (currency = 'TWD'),
  constraint payment_provider_refunds_reason_check check (length(btrim(reason)) between 3 and 500),
  constraint payment_provider_refunds_status_check
    check (status in ('REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  constraint payment_provider_refunds_idempotency_check
    check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_provider_refunds_error_check
    check (sanitized_error_code is null or sanitized_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$')
);

create unique index payment_provider_refunds_idempotency_key
  on public.payment_provider_refunds (transaction_id, idempotency_key_hash);
create index payment_provider_refunds_status_idx
  on public.payment_provider_refunds (organization_id, stall_id, status, requested_at);

create table public.payment_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  transaction_id uuid,
  provider text not null,
  case_type text not null,
  expected_amount integer,
  actual_amount integer,
  currency text not null default 'TWD',
  provider_reference text,
  settlement_date date,
  review_status text not null default 'OPEN',
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_code text,
  safe_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_reconciliation_cases_transaction_scope_fkey
    foreign key (transaction_id, organization_id, stall_id)
    references public.payment_provider_transactions(id, organization_id, stall_id)
    on delete restrict,
  constraint payment_reconciliation_cases_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete restrict,
  constraint payment_reconciliation_cases_provider_check check (
    provider in (
      'CASH_MANUAL', 'LINE_PAY', 'JKO_PAY', 'TWQR', 'TAIWAN_PAY',
      'PX_PAY_PLUS', 'IPASS_MONEY', 'ICASH_PAY', 'PLUS_PAY',
      'EASY_WALLET', 'GAMA_PAY', 'OPAY', 'PAYMENT_GATEWAY'
    )
  ),
  constraint payment_reconciliation_cases_type_check check (
    case_type in (
      'AMOUNT_MISMATCH', 'MISSING_ORDER', 'DUPLICATE_PAYMENT',
      'STATUS_MISMATCH', 'REFUNDED_MISMATCH', 'SETTLEMENT_MISSING'
    )
  ),
  constraint payment_reconciliation_cases_amount_check check (
    (expected_amount is null or expected_amount >= 0)
    and (actual_amount is null or actual_amount >= 0)
  ),
  constraint payment_reconciliation_cases_currency_check check (currency = 'TWD'),
  constraint payment_reconciliation_cases_review_check check (
    review_status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'IGNORED')
    and (
      (review_status in ('OPEN', 'IN_REVIEW') and reviewed_at is null)
      or (review_status in ('RESOLVED', 'IGNORED') and reviewed_at is not null)
    )
  ),
  constraint payment_reconciliation_cases_resolution_check
    check (resolution_code is null or resolution_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  constraint payment_reconciliation_cases_notes_check
    check (safe_notes is null or length(safe_notes) <= 1000)
);

create index payment_reconciliation_cases_review_idx
  on public.payment_reconciliation_cases (
    organization_id, stall_id, review_status, created_at
  );
create index payment_reconciliation_cases_settlement_idx
  on public.payment_reconciliation_cases (provider, settlement_date, review_status);

create function app_private.touch_auth_payment_foundation_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_provider_connections_touch_updated_at
before update on public.payment_provider_connections
for each row execute function app_private.touch_auth_payment_foundation_updated_at();
create trigger payment_provider_transactions_touch_updated_at
before update on public.payment_provider_transactions
for each row execute function app_private.touch_auth_payment_foundation_updated_at();
create trigger payment_provider_refunds_touch_updated_at
before update on public.payment_provider_refunds
for each row execute function app_private.touch_auth_payment_foundation_updated_at();
create trigger payment_reconciliation_cases_touch_updated_at
before update on public.payment_reconciliation_cases
for each row execute function app_private.touch_auth_payment_foundation_updated_at();

create function app_private.guard_passkey_challenge_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.id <> old.id
    or new.profile_id <> old.profile_id
    or new.challenge_hash <> old.challenge_hash
    or new.purpose <> old.purpose
    or new.rp_id <> old.rp_id
    or new.origin <> old.origin
    or new.expires_at <> old.expires_at
    or new.created_at <> old.created_at
    or old.consumed_at is not null
    or new.consumed_at is null then
    raise exception 'PASSKEY_CHALLENGE_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger passkey_challenges_guard_update
before update on public.passkey_challenges
for each row execute function app_private.guard_passkey_challenge_update();

create function app_private.validate_payment_provider_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
declare
  v_connection public.payment_provider_connections%rowtype;
  v_option record;
begin
  select * into v_connection
  from public.payment_provider_connections
  where id = new.provider_connection_id;
  if not found
    or v_connection.organization_id <> new.organization_id
    or (v_connection.stall_id is not null and v_connection.stall_id <> new.stall_id)
    or v_connection.provider <> new.provider then
    raise exception 'PAYMENT_PROVIDER_CONNECTION_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if new.payment_option_id is not null then
    select organization_id, stall_id into v_option
    from public.payment_options
    where id = new.payment_option_id;
    if not found
      or v_option.organization_id <> new.organization_id
      or v_option.stall_id <> new.stall_id then
      raise exception 'PAYMENT_OPTION_SCOPE_MISMATCH' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger payment_provider_transactions_validate_scope
before insert or update of organization_id, stall_id, provider_connection_id, payment_option_id, provider
on public.payment_provider_transactions
for each row execute function app_private.validate_payment_provider_scope();

alter table public.passkey_credentials enable row level security;
alter table public.passkey_credentials force row level security;
alter table public.passkey_challenges enable row level security;
alter table public.passkey_challenges force row level security;
alter table public.payment_provider_connections enable row level security;
alter table public.payment_provider_connections force row level security;
alter table public.payment_provider_transactions enable row level security;
alter table public.payment_provider_transactions force row level security;
alter table public.payment_provider_webhook_events enable row level security;
alter table public.payment_provider_webhook_events force row level security;
alter table public.payment_provider_refunds enable row level security;
alter table public.payment_provider_refunds force row level security;
alter table public.payment_reconciliation_cases enable row level security;
alter table public.payment_reconciliation_cases force row level security;

revoke all on table
  public.passkey_credentials,
  public.passkey_challenges,
  public.payment_provider_connections,
  public.payment_provider_transactions,
  public.payment_provider_webhook_events,
  public.payment_provider_refunds,
  public.payment_reconciliation_cases
from public, anon, authenticated;

grant select, insert, update, delete on table
  public.passkey_credentials,
  public.passkey_challenges,
  public.payment_provider_connections,
  public.payment_provider_transactions,
  public.payment_provider_webhook_events,
  public.payment_provider_refunds,
  public.payment_reconciliation_cases
to service_role;

create trigger backend_writable_guard
before insert or update or delete on public.passkey_credentials
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.passkey_challenges
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.payment_provider_connections
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.payment_provider_transactions
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.payment_provider_webhook_events
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.payment_provider_refunds
for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard
before insert or update or delete on public.payment_reconciliation_cases
for each statement execute function app_private.enforce_backend_writable();

revoke all on function app_private.touch_auth_payment_foundation_updated_at()
from public, anon, authenticated, service_role;
revoke all on function app_private.guard_passkey_challenge_update()
from public, anon, authenticated, service_role;
revoke all on function app_private.validate_payment_provider_scope()
from public, anon, authenticated, service_role;

comment on table public.passkey_credentials is
  'WebAuthn public credential material only. Never stores provider passwords or private keys.';
comment on table public.passkey_challenges is
  'Five-minute single-use Passkey challenges bound to exact profile, RP ID, Origin, and purpose.';
comment on table public.payment_provider_connections is
  'Tenant-scoped provider configuration. Stores secret references only, never raw provider secrets.';
comment on table public.payment_provider_transactions is
  'Server-authoritative provider-neutral TWD transaction ledger. Browser return is evidence only and cannot mark PAID.';
comment on table public.payment_provider_webhook_events is
  'Replay-protected webhook ledger containing hashes and sanitized status only; raw bodies and signatures are not persisted.';
comment on table public.payment_provider_refunds is
  'Idempotent full or partial provider refund request ledger.';
comment on table public.payment_reconciliation_cases is
  'Provider-versus-StallOrder mismatch queue requiring audited review.';
