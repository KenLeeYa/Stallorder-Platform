-- Provider-subject identities are deliberately separate from
-- profile_auth_identities, which maps project-local Supabase Auth users for DR.

alter table public.profiles
  alter column email drop not null,
  add column email_source text,
  add column email_verified boolean not null default false,
  add column auth_migration_required boolean not null default true,
  add column session_version integer not null default 1;

alter table public.profiles
  add constraint profiles_email_source_check
    check (
      email_source is null
      or email_source in ('LOCAL', 'GOOGLE', 'LINE', 'APPLE', 'ADMIN')
    ),
  add constraint profiles_session_version_check
    check (session_version > 0);

update public.profiles
set
  email_source = case
    when auth_user_id is not null then 'GOOGLE'
    when password_hash is not null then 'LOCAL'
    else null
  end,
  email_verified = auth_user_id is not null;

create table public.auth_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  provider text not null
    check (provider in ('GOOGLE', 'LINE', 'APPLE')),
  provider_subject text not null
    check (
      provider_subject = btrim(provider_subject)
      and char_length(provider_subject) between 1 and 255
    ),
  provider_email text
    check (
      provider_email is null
      or (
        provider_email = lower(btrim(provider_email))
        and provider_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
        and char_length(provider_email) <= 320
      )
    ),
  provider_email_verified boolean not null default false,
  provider_display_name text
    check (
      provider_display_name is null
      or char_length(provider_display_name) between 1 and 200
    ),
  provider_avatar_url text
    check (
      provider_avatar_url is null
      or char_length(provider_avatar_url) <= 2048
    ),
  provider_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(provider_metadata) = 'object'
      and not (
        provider_metadata ?| array[
          'access_token',
          'refresh_token',
          'authorization_code',
          'id_token',
          'client_secret',
          'private_key'
        ]
      )
    ),
  first_login_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject),
  unique (profile_id, provider)
);

create index auth_identities_profile
  on public.auth_identities (profile_id);

create index auth_identities_provider
  on public.auth_identities (provider);

create index auth_identities_provider_subject
  on public.auth_identities (provider_subject);

create index auth_identities_last_login
  on public.auth_identities (last_login_at desc);

create table public.auth_identity_link_invitations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  organization_id uuid
    references public.organizations(id) on delete cascade,
  allowed_providers text[] not null,
  token_hash text not null unique
    check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by_profile_id uuid not null
    references public.profiles(id) on delete restrict,
  used_by_identity_id uuid
    references public.auth_identities(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    cardinality(allowed_providers) > 0
    and allowed_providers <@ array['GOOGLE', 'LINE', 'APPLE']::text[]
  ),
  check (expires_at > created_at),
  check (used_at is null or revoked_at is null)
);

create index auth_identity_link_invitations_profile
  on public.auth_identity_link_invitations (profile_id, expires_at desc);

create index auth_identity_link_invitations_organization
  on public.auth_identity_link_invitations (organization_id, expires_at desc);

create index auth_identity_link_invitations_active
  on public.auth_identity_link_invitations (expires_at)
  where used_at is null and revoked_at is null;

alter table public.auth_sessions
  add column device_id uuid,
  add column ip_hash text,
  add column user_agent_hash text,
  add column issued_at timestamptz,
  add column rotation_family_id uuid,
  add column rotated_from_id uuid,
  add column revoked_at timestamptz,
  add column revoke_reason text,
  add column profile_session_version integer not null default 1,
  add column reuse_detected_at timestamptz;

update public.auth_sessions
set
  issued_at = created_at,
  rotation_family_id = id;

alter table public.auth_sessions
  alter column issued_at set not null,
  alter column issued_at set default now(),
  alter column rotation_family_id set not null,
  alter column rotation_family_id set default gen_random_uuid(),
  add constraint auth_sessions_rotated_from_fkey
    foreign key (rotated_from_id)
    references public.auth_sessions(id)
    on delete set null,
  add constraint auth_sessions_profile_session_version_check
    check (profile_session_version > 0),
  add constraint auth_sessions_hash_shape_check
    check (
      (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$')
      and (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$')
    ),
  add constraint auth_sessions_revoke_reason_check
    check (
      revoke_reason is null
      or char_length(revoke_reason) between 1 and 120
    );

create unique index auth_sessions_rotated_from_unique
  on public.auth_sessions (rotated_from_id)
  where rotated_from_id is not null;

create index auth_sessions_rotation_family
  on public.auth_sessions (rotation_family_id, issued_at desc);

create index auth_sessions_active_profile
  on public.auth_sessions (profile_id, expires_at desc)
  where revoked_at is null;

create table public.oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null
    check (provider in ('GOOGLE', 'LINE', 'APPLE')),
  state_hash text not null unique
    check (state_hash ~ '^[a-f0-9]{64}$'),
  nonce_hash text not null
    check (nonce_hash ~ '^[a-f0-9]{64}$'),
  code_verifier_ciphertext text not null
    check (char_length(code_verifier_ciphertext) between 32 and 4096),
  redirect_uri text not null
    check (
      redirect_uri ~ '^https?://'
      and char_length(redirect_uri) <= 2048
    ),
  return_to text not null default '/'
    check (
      left(return_to, 1) = '/'
      and left(return_to, 2) <> '//'
      and char_length(return_to) <= 1024
    ),
  link_mode boolean not null default false,
  current_profile_id uuid
    references public.profiles(id) on delete cascade,
  invitation_id uuid
    references public.auth_identity_link_invitations(id) on delete set null,
  authorization_code_hash text unique
    check (
      authorization_code_hash is null
      or authorization_code_hash ~ '^[a-f0-9]{64}$'
    ),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'CONSUMED', 'EXPIRED', 'FAILED')),
  circuit_source text
    check (circuit_source is null or circuit_source in ('A', 'B')),
  result_session_id uuid
    references public.auth_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at),
  check (
    not link_mode
    or current_profile_id is not null
    or invitation_id is not null
  ),
  check (
    (status = 'CONSUMED' and consumed_at is not null)
    or status <> 'CONSUMED'
  )
);

create index oauth_transactions_expiry
  on public.oauth_transactions (expires_at)
  where status in ('PENDING', 'PROCESSING');

create index oauth_transactions_profile
  on public.oauth_transactions (current_profile_id, created_at desc);

create or replace function app_private.touch_oauth_foundation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger auth_identities_touch_updated_at
before update on public.auth_identities
for each row execute function app_private.touch_oauth_foundation_updated_at();

create trigger auth_identity_link_invitations_touch_updated_at
before update on public.auth_identity_link_invitations
for each row execute function app_private.touch_oauth_foundation_updated_at();

alter table public.auth_identities enable row level security;
alter table public.auth_identities force row level security;
alter table public.auth_identity_link_invitations enable row level security;
alter table public.auth_identity_link_invitations force row level security;
alter table public.oauth_transactions enable row level security;
alter table public.oauth_transactions force row level security;

revoke all on table public.auth_identities
  from public, anon, authenticated;
revoke all on table public.auth_identity_link_invitations
  from public, anon, authenticated;
revoke all on table public.oauth_transactions
  from public, anon, authenticated;
revoke all on table public.auth_sessions
  from public, anon, authenticated;

grant select, insert, update on table public.auth_identities
  to service_role;
grant select, insert, update on table public.auth_identity_link_invitations
  to service_role;
grant select, insert, update, delete on table public.oauth_transactions
  to service_role;
grant select, insert, update, delete on table public.auth_sessions
  to service_role;

revoke all on function app_private.touch_oauth_foundation_updated_at()
  from public, anon, authenticated, service_role;

comment on table public.auth_identities is
  'Authoritative OAuth identity ledger keyed only by verified provider and provider subject.';
comment on column public.auth_identities.provider_metadata is
  'Minimal non-sensitive claims only. OAuth codes, tokens and provider secrets are prohibited.';
comment on table public.oauth_transactions is
  'Single-use OAuth state, nonce and encrypted PKCE verifier ledger for replay-safe callback completion.';
comment on table public.auth_identity_link_invitations is
  'Hashed, short-lived invitation ledger for explicit privileged-account identity linking.';
comment on column public.auth_sessions.ip_hash is
  'Keyed or salted SHA-256 representation; raw client IP addresses are not stored.';
comment on column public.auth_sessions.user_agent_hash is
  'Keyed or salted SHA-256 representation; raw user-agent strings are not stored.';
