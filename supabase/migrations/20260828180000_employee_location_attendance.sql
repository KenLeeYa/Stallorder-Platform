create table public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null unique
    references public.stalls(id) on delete cascade,
  enabled boolean not null default false,
  latitude numeric(9, 6),
  longitude numeric(10, 6),
  radius_meters smallint not null default 150
    check (radius_meters between 50 and 500),
  max_accuracy_meters smallint not null default 80
    check (max_accuracy_meters between 20 and 200),
  require_rotating_code boolean not null default true,
  location_evidence_days smallint not null default 90
    check (location_evidence_days between 7 and 365),
  updated_by_profile_id uuid
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (not enabled or (latitude is not null and longitude is not null)),
  check (require_rotating_code)
);

create index attendance_policies_organization_enabled
  on public.attendance_policies (organization_id, enabled);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete restrict,
  session_id uuid
    references public.auth_sessions(id) on delete set null,
  device_id uuid,
  event_type varchar(20) not null
    check (event_type in ('CLOCK_IN', 'CLOCK_OUT')),
  decision varchar(24) not null
    check (decision in ('ACCEPTED', 'REJECTED', 'REVIEW_REQUIRED')),
  latitude numeric(9, 4),
  longitude numeric(10, 4),
  accuracy_meters numeric(8, 2),
  distance_meters numeric(10, 2),
  client_captured_at timestamptz,
  risk_codes text[] not null default '{}',
  rotating_code_verified boolean not null default false,
  challenge_nonce_hash text not null unique,
  review_note varchar(500),
  reviewed_by_profile_id uuid
    references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  evidence_purge_at timestamptz not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (accuracy_meters is null or accuracy_meters between 0 and 10000),
  check (distance_meters is null or distance_meters between 0 and 40075000)
);

create index attendance_events_stall_profile_time
  on public.attendance_events (stall_id, profile_id, occurred_at desc);

create index attendance_events_organization_time
  on public.attendance_events (organization_id, occurred_at desc);

create index attendance_events_decision_time
  on public.attendance_events (decision, occurred_at desc);

create index attendance_events_evidence_purge
  on public.attendance_events (evidence_purge_at)
  where latitude is not null;

create trigger attendance_policies_touch_updated_at
before update on public.attendance_policies
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger backend_writable_guard
before insert or update or delete on public.attendance_policies
for each statement execute function app_private.enforce_backend_writable();

create trigger backend_writable_guard
before insert or update or delete on public.attendance_events
for each statement execute function app_private.enforce_backend_writable();

alter table public.attendance_policies enable row level security;
alter table public.attendance_policies force row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_events force row level security;

revoke all on table public.attendance_policies from public, anon, authenticated;
revoke all on table public.attendance_events from public, anon, authenticated;

grant select, insert, update, delete on table public.attendance_policies to service_role;
grant select, insert, update on table public.attendance_events to service_role;

comment on table public.attendance_policies is
  'Server-authoritative geofence settings. Web high-assurance mode combines location evidence with an on-site rotating code.';

comment on table public.attendance_events is
  'Immutable attendance attempts retained as employment records; precise location evidence is minimized and purged separately.';

create function public.purge_expired_attendance_location_evidence(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer := 0;
begin
  if p_limit < 1 or p_limit > 2000 then
    raise exception 'INVALID_PURGE_LIMIT';
  end if;

  with expired as (
    select id
    from public.attendance_events
    where evidence_purge_at <= now()
      and latitude is not null
    order by evidence_purge_at asc
    limit p_limit
    for update skip locked
  )
  update public.attendance_events event
  set
    latitude = null,
    longitude = null,
    accuracy_meters = null,
    distance_meters = null,
    client_captured_at = null,
    device_id = null,
    session_id = null
  from expired
  where event.id = expired.id;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.purge_expired_attendance_location_evidence(integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_attendance_location_evidence(integer)
  to service_role;
