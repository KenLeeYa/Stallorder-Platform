create table public.client_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  installation_id uuid not null,
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 80),
  platform text not null
    check (char_length(btrim(platform)) between 1 and 80),
  app_version text not null
    check (app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'),
  pwa_installed boolean not null default false,
  offline_enabled boolean not null default false,
  offline_role text not null default 'NONE'
    check (offline_role in ('OFFLINE_LEADER', 'OFFLINE_READ_ONLY', 'NONE')),
  status text not null default 'DISABLED'
    check (status in ('ACTIVE', 'REVOKED', 'LOST', 'REPLACED', 'DISABLED')),
  last_online_at timestamptz,
  last_sync_at timestamptz,
  permit_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, installation_id),
  constraint client_devices_disabled_role_check check (
    (offline_enabled and status = 'ACTIVE' and offline_role <> 'NONE')
    or (not offline_enabled and offline_role = 'NONE')
  ),
  constraint client_devices_revocation_check check (
    (status in ('REVOKED', 'LOST', 'REPLACED') and revoked_at is not null)
    or (status not in ('REVOKED', 'LOST', 'REPLACED'))
  )
);

create unique index client_devices_one_offline_leader
  on public.client_devices (stall_id)
  where status = 'ACTIVE'
    and offline_enabled
    and offline_role = 'OFFLINE_LEADER';

create index client_devices_stall_status
  on public.client_devices (stall_id, status, offline_enabled);

create index client_devices_profile_status
  on public.client_devices (profile_id, status);

create table public.offline_stall_runtime_policy (
  stall_id uuid primary key
    references public.stalls(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  offline_enabled boolean not null default false,
  offline_write_mode text not null default 'DISABLED'
    check (offline_write_mode in ('DISABLED', 'SINGLE_DEVICE_ONLY', 'LOCAL_GATEWAY_FUTURE')),
  offline_leader_device_id uuid
    references public.client_devices(id) on delete set null,
  max_offline_duration_minutes integer not null default 120
    check (max_offline_duration_minutes between 15 and 720),
  max_pending_orders integer not null default 25
    check (max_pending_orders between 1 and 500),
  max_total_amount numeric(12, 2) not null default 10000
    check (max_total_amount >= 0),
  max_single_order_amount numeric(12, 2) not null default 2000
    check (max_single_order_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_policy_enabled_mode_check check (
    (offline_enabled and offline_write_mode <> 'DISABLED')
    or (not offline_enabled and offline_write_mode = 'DISABLED')
  ),
  constraint offline_policy_single_leader_check check (
    (offline_write_mode = 'DISABLED' and offline_leader_device_id is null)
    or (offline_write_mode = 'SINGLE_DEVICE_ONLY' and offline_leader_device_id is not null)
    or offline_write_mode = 'LOCAL_GATEWAY_FUTURE'
  ),
  constraint offline_policy_amount_check check (
    max_single_order_amount <= max_total_amount
  )
);

create index offline_policy_organization_enabled
  on public.offline_stall_runtime_policy (organization_id, offline_enabled);

create table public.menu_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  version integer not null
    check (version >= 1),
  content_hash text not null
    check (content_hash ~ '^[a-f0-9]{64}$'),
  public_content_hash text not null
    check (public_content_hash ~ '^[a-f0-9]{64}$'),
  public_object_path text not null
    check (
      char_length(public_object_path) between 1 and 1024
      and public_object_path !~ '(^|/)\.\.(/|$)'
      and public_object_path !~ '[[:cntrl:]]'
      and public_object_path ~ '^[0-9a-f/-]+\.json$'
    ),
  catalog_json jsonb not null
    check (
      jsonb_typeof(catalog_json) = 'object'
      and pg_column_size(catalog_json) <= 10485760
    ),
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (stall_id, version),
  unique (public_object_path),
  constraint menu_snapshots_expiry_check check (expires_at > generated_at)
);

create index menu_snapshots_organization_stall_generated
  on public.menu_snapshots (organization_id, stall_id, generated_at desc);

create index menu_snapshots_stall_content_hash
  on public.menu_snapshots (stall_id, content_hash);

create table public.offline_permits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  device_id uuid not null
    references public.client_devices(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  menu_snapshot_id uuid not null
    references public.menu_snapshots(id) on delete restrict,
  menu_snapshot_version integer not null
    check (menu_snapshot_version >= 1),
  token_hash text not null unique
    check (token_hash ~ '^[a-f0-9]{64}$'),
  roles_json jsonb not null
    check (jsonb_typeof(roles_json) = 'array'),
  allowed_actions_json jsonb not null
    check (jsonb_typeof(allowed_actions_json) = 'array'),
  promotion_epoch bigint not null
    check (promotion_epoch >= 1),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offline_permits_lifetime_check check (
    expires_at > issued_at
    and expires_at <= issued_at + interval '12 hours'
  ),
  constraint offline_permits_revocation_check check (
    (status = 'REVOKED' and revoked_at is not null)
    or status <> 'REVOKED'
  )
);

create index offline_permits_device_status_expiry
  on public.offline_permits (device_id, status, expires_at);

create unique index offline_permits_one_active_per_device
  on public.offline_permits (device_id)
  where status = 'ACTIVE';

create index offline_permits_stall_status
  on public.offline_permits (organization_id, stall_id, status);

alter table public.storage_object_manifest
  add column content_type text not null default 'application/octet-stream'
    check (content_type ~ '^[a-z0-9][a-z0-9.+-]+/[a-z0-9][a-z0-9.+-]+$');

update public.storage_object_manifest
set content_type = 'image/webp'
where bucket = 'product-images';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'offline-menu-snapshots',
  'offline-menu-snapshots',
  true,
  6291456,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists offline_menu_snapshots_public_read on storage.objects;
create policy offline_menu_snapshots_public_read on storage.objects
for select to public using (bucket_id = 'offline-menu-snapshots');

create or replace function app_private.touch_offline_foundation_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.validate_client_device_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.profile_id <> old.profile_id
    or new.installation_id <> old.installation_id
  ) then
    raise exception 'OFFLINE_DEVICE_SCOPE_IMMUTABLE'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.stalls
    where id = new.stall_id
      and organization_id = new.organization_id
  ) then
    raise exception 'OFFLINE_DEVICE_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if new.status in ('REVOKED', 'LOST', 'REPLACED', 'DISABLED') then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.profile_id
      and profile.is_active
      and (
        exists (
          select 1
          from public.organization_memberships membership
          where membership.organization_id = new.organization_id
            and membership.profile_id = new.profile_id
            and membership.is_active
            and membership.all_stalls
        )
        or exists (
          select 1
          from public.stall_memberships membership
          where membership.organization_id = new.organization_id
            and membership.stall_id = new.stall_id
            and membership.profile_id = new.profile_id
            and membership.is_active
        )
      )
  ) then
    raise exception 'OFFLINE_DEVICE_PROFILE_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_offline_policy_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if not exists (
    select 1
    from public.stalls
    where id = new.stall_id
      and organization_id = new.organization_id
  ) then
    raise exception 'OFFLINE_POLICY_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if new.offline_leader_device_id is not null and not exists (
    select 1
    from public.client_devices device
    where device.id = new.offline_leader_device_id
      and device.organization_id = new.organization_id
      and device.stall_id = new.stall_id
      and device.status = 'ACTIVE'
      and device.offline_enabled
      and device.offline_role = 'OFFLINE_LEADER'
  ) then
    raise exception 'OFFLINE_POLICY_LEADER_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_menu_snapshot_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if not exists (
    select 1
    from public.stalls
    where id = new.stall_id
      and organization_id = new.organization_id
  ) then
    raise exception 'MENU_SNAPSHOT_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_offline_permit_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.device_id <> old.device_id
    or new.profile_id <> old.profile_id
    or new.menu_snapshot_id <> old.menu_snapshot_id
    or new.menu_snapshot_version <> old.menu_snapshot_version
    or new.token_hash <> old.token_hash
    or new.promotion_epoch <> old.promotion_epoch
  ) then
    raise exception 'OFFLINE_PERMIT_SCOPE_IMMUTABLE'
      using errcode = '23514';
  end if;

  if new.status <> 'ACTIVE' then
    return new;
  end if;

  if not exists (
    select 1
    from public.client_devices device
    where device.id = new.device_id
      and device.organization_id = new.organization_id
      and device.stall_id = new.stall_id
      and device.profile_id = new.profile_id
      and device.status = 'ACTIVE'
      and device.offline_enabled
      and device.offline_role = 'OFFLINE_LEADER'
  ) then
    raise exception 'OFFLINE_PERMIT_DEVICE_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.menu_snapshots snapshot
    where snapshot.id = new.menu_snapshot_id
      and snapshot.organization_id = new.organization_id
      and snapshot.stall_id = new.stall_id
      and snapshot.version = new.menu_snapshot_version
      and snapshot.expires_at >= new.expires_at
  ) then
    raise exception 'OFFLINE_PERMIT_SNAPSHOT_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.offline_stall_runtime_policy policy
    where policy.organization_id = new.organization_id
      and policy.stall_id = new.stall_id
      and policy.offline_enabled
      and policy.offline_write_mode = 'SINGLE_DEVICE_ONLY'
      and policy.offline_leader_device_id = new.device_id
      and new.expires_at <= new.issued_at
        + make_interval(mins => policy.max_offline_duration_minutes)
  ) then
    raise exception 'OFFLINE_PERMIT_POLICY_MISMATCH'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.backend_runtime_state runtime
    where runtime.is_current
      and runtime.backend_role = 'ACTIVE_WRITER'
      and runtime.writes_enabled
      and runtime.promotion_epoch = new.promotion_epoch
  ) then
    raise exception 'OFFLINE_PERMIT_PROMOTION_EPOCH_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app_private.reject_menu_snapshot_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  raise exception 'MENU_SNAPSHOT_IMMUTABLE'
    using errcode = '55000';
end;
$$;

create trigger client_devices_validate_scope
before insert or update on public.client_devices
for each row execute function app_private.validate_client_device_scope();

create trigger client_devices_touch_updated_at
before update on public.client_devices
for each row execute function app_private.touch_offline_foundation_updated_at();

create trigger offline_policy_validate_scope
before insert or update on public.offline_stall_runtime_policy
for each row execute function app_private.validate_offline_policy_scope();

create trigger offline_policy_touch_updated_at
before update on public.offline_stall_runtime_policy
for each row execute function app_private.touch_offline_foundation_updated_at();

create trigger menu_snapshots_validate_scope
before insert or update on public.menu_snapshots
for each row execute function app_private.validate_menu_snapshot_scope();

create trigger menu_snapshots_reject_update
before update on public.menu_snapshots
for each row execute function app_private.reject_menu_snapshot_update();

create trigger offline_permits_validate_scope
before insert or update on public.offline_permits
for each row execute function app_private.validate_offline_permit_scope();

create trigger offline_permits_touch_updated_at
before update on public.offline_permits
for each row execute function app_private.touch_offline_foundation_updated_at();

select app_private.install_backend_writable_guard('public.client_devices'::regclass);
select app_private.install_backend_writable_guard('public.offline_stall_runtime_policy'::regclass);
select app_private.install_backend_writable_guard('public.menu_snapshots'::regclass);
select app_private.install_backend_writable_guard('public.offline_permits'::regclass);

alter table public.client_devices enable row level security;
alter table public.client_devices force row level security;
alter table public.offline_stall_runtime_policy enable row level security;
alter table public.offline_stall_runtime_policy force row level security;
alter table public.menu_snapshots enable row level security;
alter table public.menu_snapshots force row level security;
alter table public.offline_permits enable row level security;
alter table public.offline_permits force row level security;

revoke all on table public.client_devices from public, anon, authenticated;
revoke all on table public.offline_stall_runtime_policy from public, anon, authenticated;
revoke all on table public.menu_snapshots from public, anon, authenticated;
revoke all on table public.offline_permits from public, anon, authenticated;

grant select, insert, update on table public.client_devices to service_role;
grant select, insert, update on table public.offline_stall_runtime_policy to service_role;
grant select, insert on table public.menu_snapshots to service_role;
grant select, insert, update on table public.offline_permits to service_role;

revoke all on function app_private.touch_offline_foundation_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_client_device_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_offline_policy_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_menu_snapshot_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_offline_permit_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.reject_menu_snapshot_update()
  from public, anon, authenticated, service_role;

comment on table public.client_devices is
  'Approved browser installations for bounded offline operation. Passwords and provider tokens are prohibited.';
comment on table public.offline_stall_runtime_policy is
  'Fail-closed per-Stall offline write policy; SINGLE_DEVICE_ONLY is the only supported write mode in this phase.';
comment on table public.menu_snapshots is
  'Immutable bounded menu snapshots used to preserve exact offline price and availability evidence.';
comment on table public.offline_permits is
  'Server-issued device-bound offline authorizations. Only SHA-256 token hashes are persisted.';
