create table public.backend_runtime_state (
  backend_code text primary key
    check (backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  backend_role text not null
    check (backend_role in ('ACTIVE_WRITER', 'READ_ONLY_STANDBY', 'SEALED', 'DISABLED')),
  region text not null
    check (char_length(btrim(region)) between 2 and 64),
  promotion_epoch bigint not null default 1
    check (promotion_epoch >= 1),
  writes_enabled boolean not null default false,
  enforcement_enabled boolean not null default false,
  is_current boolean not null default false,
  promoted_at timestamptz,
  demoted_at timestamptz,
  reason text not null
    check (char_length(btrim(reason)) between 5 and 500),
  updated_by_profile_id uuid
    references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint backend_runtime_state_write_role_check check (
    not writes_enabled or backend_role = 'ACTIVE_WRITER'
  )
);

create unique index backend_runtime_state_one_current
  on public.backend_runtime_state (is_current)
  where is_current;

create index backend_runtime_state_writable
  on public.backend_runtime_state (is_current, writes_enabled);

insert into public.backend_runtime_state (
  backend_code,
  backend_role,
  region,
  promotion_epoch,
  writes_enabled,
  enforcement_enabled,
  is_current,
  promoted_at,
  reason
)
values
  (
    'PRIMARY',
    'ACTIVE_WRITER',
    'ap-northeast-1',
    1,
    true,
    false,
    true,
    now(),
    'Initial backward-compatible Primary state; fencing remains disabled until reviewed activation.'
  ),
  (
    'DR',
    'READ_ONLY_STANDBY',
    'ap-northeast-1',
    1,
    false,
    false,
    false,
    null,
    'Initial DR standby definition; project conversion and enforcement require explicit approval.'
  );

create table public.backend_failover_events (
  id uuid primary key default gen_random_uuid(),
  state text not null
    check (state in (
      'NORMAL_PRIMARY',
      'PRIMARY_DEGRADED',
      'FAILOVER_ASSESSMENT',
      'PRIMARY_WRITE_FREEZE',
      'DR_PROMOTION_PENDING',
      'DR_ACTIVE',
      'FAILBACK_ASSESSMENT',
      'DR_WRITE_FREEZE',
      'PRIMARY_RESEEDING',
      'PRIMARY_ACTIVE',
      'INCIDENT_REVIEW'
    )),
  source_backend_code text not null
    check (source_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  target_backend_code text not null
    check (target_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  health_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(health_evidence) = 'object'),
  replication_lag_seconds numeric(12, 3)
    check (replication_lag_seconds is null or replication_lag_seconds >= 0),
  last_known_lsn text
    check (last_known_lsn is null or last_known_lsn ~ '^[0-9A-F]+/[0-9A-F]+$'),
  requested_by_profile_id uuid
    references public.profiles(id) on delete set null,
  approved_by_profile_id uuid
    references public.profiles(id) on delete set null,
  reason text not null
    check (char_length(btrim(reason)) between 10 and 1000),
  rpo_estimate_seconds integer
    check (rpo_estimate_seconds is null or rpo_estimate_seconds >= 0),
  split_brain_acknowledged boolean not null default false,
  assessment_started_at timestamptz not null default now(),
  transition_completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index backend_failover_events_state_created
  on public.backend_failover_events (state, created_at desc);

create index backend_failover_events_target_created
  on public.backend_failover_events (target_backend_code, created_at desc);

create table public.replication_health_snapshots (
  id bigint generated always as identity primary key,
  source_backend_code text not null
    check (source_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  target_backend_code text not null
    check (target_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  status text not null
    check (status in ('CONNECTED', 'DEGRADED', 'DISCONNECTED', 'UNKNOWN')),
  lag_seconds numeric(12, 3)
    check (lag_seconds is null or lag_seconds >= 0),
  slot_wal_bytes bigint
    check (slot_wal_bytes is null or slot_wal_bytes >= 0),
  received_lsn text
    check (received_lsn is null or received_lsn ~ '^[0-9A-F]+/[0-9A-F]+$'),
  replay_lsn text
    check (replay_lsn is null or replay_lsn ~ '^[0-9A-F]+/[0-9A-F]+$'),
  schema_compatible boolean not null default false,
  storage_mirror_healthy boolean not null default false,
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  observed_at timestamptz not null default now()
);

create index replication_health_target_observed
  on public.replication_health_snapshots (target_backend_code, observed_at desc);

create index replication_health_status_observed
  on public.replication_health_snapshots (status, observed_at desc);

create table public.profile_auth_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  auth_project_code text not null
    check (auth_project_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  auth_user_id uuid not null,
  provider text not null
    check (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  verified_email text not null
    check (
      verified_email = lower(btrim(verified_email))
      and verified_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
      and char_length(verified_email) <= 320
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_project_code, auth_user_id),
  unique (profile_id, auth_project_code, provider)
);

create index profile_auth_identities_email_project
  on public.profile_auth_identities (verified_email, auth_project_code);

insert into public.profile_auth_identities (
  profile_id,
  auth_project_code,
  auth_user_id,
  provider,
  verified_email
)
select
  id,
  'PRIMARY',
  auth_user_id,
  'GOOGLE',
  lower(btrim(email))
from public.profiles
where auth_user_id is not null
on conflict do nothing;

create table public.storage_object_manifest (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid
    references public.organizations(id) on delete cascade,
  bucket text not null
    check (bucket ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  object_path text not null
    check (
      char_length(object_path) between 1 and 1024
      and object_path !~ '(^|/)\.\.(/|$)'
      and object_path !~ '[[:cntrl:]]'
    ),
  primary_checksum text
    check (primary_checksum is null or primary_checksum ~ '^[a-f0-9]{64}$'),
  dr_checksum text
    check (dr_checksum is null or dr_checksum ~ '^[a-f0-9]{64}$'),
  primary_updated_at timestamptz,
  dr_updated_at timestamptz,
  replication_status text not null default 'PENDING'
    check (replication_status in ('PENDING', 'PROCESSING', 'MIRRORED', 'FAILED', 'DELETED')),
  retry_count integer not null default 0
    check (retry_count between 0 and 1000),
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create index storage_object_manifest_organization_status
  on public.storage_object_manifest (organization_id, replication_status);

create index storage_object_manifest_status_updated
  on public.storage_object_manifest (replication_status, updated_at);

create table public.storage_replication_jobs (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null
    references public.storage_object_manifest(id) on delete cascade,
  source_backend_code text not null
    check (source_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  target_backend_code text not null
    check (target_backend_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'MIRRORED', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 1000),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storage_replication_jobs_pending
  on public.storage_replication_jobs (status, next_attempt_at, created_at);

create index storage_replication_jobs_manifest
  on public.storage_replication_jobs (manifest_id, created_at desc);

create or replace function app_private.touch_resilience_foundation_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger backend_runtime_state_touch_updated_at
before update on public.backend_runtime_state
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger profile_auth_identities_touch_updated_at
before update on public.profile_auth_identities
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger storage_object_manifest_touch_updated_at
before update on public.storage_object_manifest
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger storage_replication_jobs_touch_updated_at
before update on public.storage_replication_jobs
for each row execute function app_private.touch_resilience_foundation_updated_at();

create or replace function app_private.assert_backend_writable(
  expected_promotion_epoch bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  runtime_state public.backend_runtime_state%rowtype;
begin
  if coalesce(current_setting('app.backend_fencing_enabled', true), 'off') <> 'on' then
    return coalesce(expected_promotion_epoch, 0);
  end if;

  select *
  into runtime_state
  from public.backend_runtime_state
  where is_current
  for share;

  if not found or not runtime_state.enforcement_enabled then
    raise exception 'BACKEND_FENCING_NOT_CONFIGURED'
      using errcode = '55000';
  end if;

  if runtime_state.backend_role <> 'ACTIVE_WRITER' or not runtime_state.writes_enabled then
    raise exception 'BACKEND_NOT_WRITABLE'
      using errcode = '55000';
  end if;

  if expected_promotion_epoch is not null
    and runtime_state.promotion_epoch <> expected_promotion_epoch then
    raise exception 'BACKEND_PROMOTION_EPOCH_MISMATCH'
      using errcode = '40001';
  end if;

  return runtime_state.promotion_epoch;
end;
$$;

create or replace function app_private.enforce_backend_writable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  perform app_private.assert_backend_writable();
  return null;
end;
$$;

create or replace function app_private.install_backend_writable_guard(target_table regclass)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  execute format('drop trigger if exists backend_writable_guard on %s', target_table);
  execute format(
    'create trigger backend_writable_guard before insert or update or delete on %s for each statement execute function app_private.enforce_backend_writable()',
    target_table
  );
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select format('%I.%I', table_schema, table_name)::regclass as relation
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name not in (
        'backend_runtime_state',
        'backend_failover_events',
        'replication_health_snapshots'
      )
  loop
    perform app_private.install_backend_writable_guard(target.relation);
  end loop;
end;
$$;

alter table public.backend_runtime_state enable row level security;
alter table public.backend_runtime_state force row level security;
alter table public.backend_failover_events enable row level security;
alter table public.backend_failover_events force row level security;
alter table public.replication_health_snapshots enable row level security;
alter table public.replication_health_snapshots force row level security;
alter table public.profile_auth_identities enable row level security;
alter table public.profile_auth_identities force row level security;
alter table public.storage_object_manifest enable row level security;
alter table public.storage_object_manifest force row level security;
alter table public.storage_replication_jobs enable row level security;
alter table public.storage_replication_jobs force row level security;

revoke all on table public.backend_runtime_state from public, anon, authenticated;
revoke all on table public.backend_failover_events from public, anon, authenticated;
revoke all on table public.replication_health_snapshots from public, anon, authenticated;
revoke all on table public.profile_auth_identities from public, anon, authenticated;
revoke all on table public.storage_object_manifest from public, anon, authenticated;
revoke all on table public.storage_replication_jobs from public, anon, authenticated;

grant select on table public.backend_runtime_state to service_role;
grant select, insert on table public.backend_failover_events to service_role;
grant select, insert on table public.replication_health_snapshots to service_role;
grant select, insert, update on table public.profile_auth_identities to service_role;
grant select, insert, update on table public.storage_object_manifest to service_role;
grant select, insert, update on table public.storage_replication_jobs to service_role;
grant usage, select on sequence public.replication_health_snapshots_id_seq to service_role;

revoke all on function app_private.touch_resilience_foundation_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function app_private.assert_backend_writable(bigint)
  from public, anon, authenticated;
grant execute on function app_private.assert_backend_writable(bigint)
  to service_role;
revoke all on function app_private.enforce_backend_writable()
  from public, anon, authenticated, service_role;
revoke all on function app_private.install_backend_writable_guard(regclass)
  from public, anon, authenticated, service_role;

comment on table public.backend_runtime_state is
  'Environment-local backend role and promotion epoch. Exclude this table from logical replication.';
comment on table public.replication_health_snapshots is
  'Environment-local sanitized replication observations. Exclude this table from logical replication.';
comment on function app_private.assert_backend_writable(bigint) is
  'Fail-closed backend fencing check after project-level app.backend_fencing_enabled is explicitly enabled.';
comment on table public.profile_auth_identities is
  'Maps one application profile to project-specific Supabase Auth identities without assuming user IDs are portable.';
comment on table public.storage_object_manifest is
  'Checksum manifest for asynchronous Primary-to-DR object replication; it contains no provider credentials.';
