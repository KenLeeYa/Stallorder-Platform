-- Platform customer extensions. The original orders, payments and staff memberships
-- remain authoritative. These records are server-only, never merchant-editable.
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
create table public.line_platform_stalls (
  stall_id uuid primary key references public.stalls(id),
  environment text not null check (environment in ('local','preview','production')),
  enabled boolean not null default false,
  cutover_at timestamptz not null default now(),
  configured_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.line_platform_order_owners (
  order_id uuid primary key references public.orders(id),
  profile_id uuid not null references public.line_platform_members(profile_id),
  environment text not null check (environment in ('local','preview','production')),
  provider_id text not null,
  subject_hash text not null,
  pickup_required boolean not null default false,
  created_at timestamptz not null default now()
);
create index line_platform_order_owners_member on public.line_platform_order_owners(profile_id, created_at desc);
create table public.line_platform_member_audit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  event_type text not null,
  terms_version text,
  created_at timestamptz not null default now()
);
create or replace function app_private.validate_line_platform_owner() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'LINE_PLATFORM_OWNER_IMMUTABLE';
  end if;
  if not exists(select 1 from public.line_platform_members m
    join public.orders o on o.id=new.order_id
    join public.line_platform_stalls s on s.stall_id=o.stall_id
    where m.profile_id=new.profile_id and m.environment=new.environment
      and m.provider_id=new.provider_id and m.subject_hash=new.subject_hash and m.revoked_at is null
      and s.environment=new.environment and s.enabled and o.created_at>=s.cutover_at
      and (not new.pickup_required or o.fulfillment_type='TAKEOUT')) then
    raise exception 'LINE_PLATFORM_OWNER_SCOPE_INVALID';
  end if;
  return new;
end $$;
create trigger line_platform_owner_scope before insert or update on public.line_platform_order_owners
  for each row execute function app_private.validate_line_platform_owner();
alter table public.line_platform_members enable row level security;
alter table public.line_platform_members force row level security;
alter table public.line_platform_stalls enable row level security;
alter table public.line_platform_stalls force row level security;
alter table public.line_platform_order_owners enable row level security;
alter table public.line_platform_order_owners force row level security;
alter table public.line_platform_member_audit enable row level security;
alter table public.line_platform_member_audit force row level security;
revoke all on public.line_platform_members,public.line_platform_stalls,public.line_platform_order_owners,public.line_platform_member_audit from anon,authenticated;
grant all on public.line_platform_members,public.line_platform_stalls,public.line_platform_order_owners,public.line_platform_member_audit to service_role;
