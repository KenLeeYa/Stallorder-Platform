create table public.line_platform_members (
  profile_id uuid primary key references public.profiles(id),
  auth_identity_id uuid not null unique references public.auth_identities(id),
  environment text not null check (environment in ('local','preview','production')),
  provider_id text not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  subject_ciphertext text not null,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  terms_source text not null check (terms_source in ('MINI_APP','WEB')),
  notification_consent boolean not null default false,
  consent_updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(environment, provider_id, subject_hash)
);
create table public.line_platform_member_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  event_type text not null,
  terms_version text,
  created_at timestamptz not null default now()
);
alter table public.line_platform_members enable row level security;
alter table public.line_platform_members force row level security;
alter table public.line_platform_member_audit enable row level security;
alter table public.line_platform_member_audit force row level security;
revoke all on public.line_platform_members, public.line_platform_member_audit from anon, authenticated;
grant all on public.line_platform_members, public.line_platform_member_audit to service_role;
