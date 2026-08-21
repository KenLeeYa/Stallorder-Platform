create extension if not exists btree_gist with schema extensions;

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
      code,
      description,
      default_enabled,
      is_emergency
    )
    values (
      'RESERVATION_PREORDER_ENABLED',
      'Local-only reservation-linked preorder foundation. Keep disabled until policy and rollout approval.',
      false,
      false
    )
    on conflict (code) do nothing;
  end if;
end;
$$;

create unique index if not exists dining_tables_id_stall_organization_key
  on public.dining_tables (id, stall_id, organization_id);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  dining_table_id uuid not null,
  public_token_hash text not null unique,
  status text not null default 'CONFIRMED',
  party_size smallint not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  local_business_date date not null,
  preorder_opens_at timestamptz not null,
  preorder_cutoff_at timestamptz not null,
  modification_cutoff_at timestamptz not null,
  cancellation_cutoff_at timestamptz not null,
  late_grace_until timestamptz not null,
  no_show_eligible_at timestamptz not null,
  deposit_amount integer not null default 0,
  deposit_status text not null default 'NOT_REQUIRED',
  refund_status text not null default 'NOT_APPLICABLE',
  cancellation_reason_code text,
  cancelled_at timestamptz,
  version integer not null default 1,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_scope_key unique (id, organization_id, stall_id),
  constraint reservations_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint reservations_table_scope_fkey
    foreign key (dining_table_id, stall_id, organization_id)
    references public.dining_tables(id, stall_id, organization_id) on delete restrict,
  constraint reservations_public_token_hash_check
    check (public_token_hash ~ '^[0-9a-f]{64}$'),
  constraint reservations_status_check
    check (status in ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  constraint reservations_party_size_check
    check (party_size between 1 and 20),
  constraint reservations_time_range_check
    check (ends_at > starts_at and ends_at <= starts_at + interval '6 hours'),
  constraint reservations_policy_time_order_check check (
    preorder_opens_at < preorder_cutoff_at
    and preorder_cutoff_at <= starts_at
    and modification_cutoff_at <= starts_at
    and cancellation_cutoff_at <= starts_at
    and late_grace_until >= starts_at
    and no_show_eligible_at >= late_grace_until
  ),
  constraint reservations_deposit_amount_check check (deposit_amount = 0),
  constraint reservations_deposit_status_check check (deposit_status = 'NOT_REQUIRED'),
  constraint reservations_refund_status_check check (refund_status = 'NOT_APPLICABLE'),
  constraint reservations_cancel_state_check check (
    (status = 'CANCELLED') = (cancelled_at is not null)
    and (
      status <> 'CANCELLED'
      or cancellation_reason_code ~ '^[A-Z][A-Z0-9_]{2,39}$'
    )
  ),
  constraint reservations_version_check check (version >= 1),
  constraint reservations_confirmed_table_time_excl
    exclude using gist (
      dining_table_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    )
    where (status = 'CONFIRMED')
);

create index reservations_stall_business_date_status_idx
  on public.reservations (stall_id, local_business_date, status, starts_at);
create index reservations_organization_created_at_idx
  on public.reservations (organization_id, created_at desc);

create table public.reservation_preorder_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stall_id uuid not null,
  reservation_id uuid not null,
  reservation_version integer not null,
  session_request_id uuid not null,
  token_hash text not null unique,
  device_hash text not null,
  status text not null default 'ACTIVE',
  scheduled_for timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservation_preorder_sessions_reservation_scope_fkey
    foreign key (reservation_id, organization_id, stall_id)
    references public.reservations(id, organization_id, stall_id) on delete cascade,
  constraint reservation_preorder_sessions_request_key
    unique (reservation_id, session_request_id),
  constraint reservation_preorder_sessions_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint reservation_preorder_sessions_device_hash_check
    check (device_hash ~ '^[0-9a-f]{64}$'),
  constraint reservation_preorder_sessions_status_check
    check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  constraint reservation_preorder_sessions_version_check
    check (reservation_version >= 1),
  constraint reservation_preorder_sessions_expiry_check
    check (expires_at <= scheduled_for),
  constraint reservation_preorder_sessions_revoked_check check (
    (status = 'REVOKED' and revoked_at is not null)
    or (status <> 'REVOKED' and revoked_at is null)
  )
);

create unique index reservation_preorder_sessions_one_active_per_reservation
  on public.reservation_preorder_sessions (reservation_id)
  where status = 'ACTIVE';
create index reservation_preorder_sessions_stall_status_expiry_idx
  on public.reservation_preorder_sessions (stall_id, status, expires_at);

create function app_private.prepare_reservation_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.public_token_hash <> old.public_token_hash
    or new.created_at <> old.created_at
  ) then
    raise exception 'RESERVATION_IMMUTABLE_SCOPE'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_record
    where timezone_record.name = new.timezone
  ) then
    raise exception 'RESERVATION_TIMEZONE_INVALID'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT'
    or new.starts_at is distinct from old.starts_at
    or new.timezone is distinct from old.timezone then
    new.local_business_date := (new.starts_at at time zone new.timezone)::date;
    new.preorder_opens_at := new.starts_at - interval '24 hours';
    new.preorder_cutoff_at := new.starts_at - interval '30 minutes';
    new.modification_cutoff_at := new.starts_at - interval '2 hours';
    new.cancellation_cutoff_at := new.starts_at - interval '2 hours';
    new.late_grace_until := new.starts_at + interval '15 minutes';
    new.no_show_eligible_at := new.starts_at + interval '30 minutes';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger reservations_prepare_row
before insert or update on public.reservations
for each row execute function app_private.prepare_reservation_row();

create trigger backend_writable_guard
before insert or update or delete on public.reservations
for each statement execute function app_private.enforce_backend_writable();

create function app_private.touch_reservation_preorder_session()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.stall_id <> old.stall_id
    or new.reservation_id <> old.reservation_id
    or new.reservation_version <> old.reservation_version
    or new.session_request_id <> old.session_request_id
    or new.token_hash <> old.token_hash
    or new.device_hash <> old.device_hash
    or new.scheduled_for <> old.scheduled_for
    or new.expires_at <> old.expires_at
    or new.created_at <> old.created_at then
    raise exception 'RESERVATION_PREORDER_SESSION_IMMUTABLE'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger reservation_preorder_sessions_touch
before update on public.reservation_preorder_sessions
for each row execute function app_private.touch_reservation_preorder_session();

create trigger backend_writable_guard
before insert or update or delete on public.reservation_preorder_sessions
for each statement execute function app_private.enforce_backend_writable();

create function app_private.lock_reservation_table_capacity(
  p_dining_table_id uuid
)
returns void
language sql
volatile
set search_path = pg_catalog
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('reservation-table:' || p_dining_table_id::text, 0)
  );
$$;

create function app_private.record_reservation_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid,
  p_stall_id uuid,
  p_actor_profile_id uuid,
  p_request_id text,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, app_private
as $$
begin
  insert into public.audit_logs (
    id,
    organization_id,
    stall_id,
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    outcome,
    request_id,
    before_json,
    after_json
  ) values (
    gen_random_uuid(),
    p_organization_id,
    p_stall_id,
    p_actor_profile_id,
    p_action,
    p_entity_type,
    p_entity_id,
    'SUCCESS'::public.audit_outcome,
    left(coalesce(nullif(btrim(p_request_id), ''), 'reservation-system'), 200),
    p_before,
    p_after
  );
end;
$$;

create function app_private.create_reservation(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_public_token_hash text,
  p_party_size smallint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_request_id text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_reservation public.reservations%rowtype;
begin
  if p_public_token_hash is null
    or p_public_token_hash !~ '^[0-9a-f]{64}$'
    or p_party_size not between 1 and 20
    or p_ends_at <= p_starts_at
    or p_ends_at > p_starts_at + interval '6 hours'
    or p_request_id is null
    or char_length(btrim(p_request_id)) not between 1 and 200
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_record
      where timezone_record.name = p_timezone
    ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID_INPUT');
  end if;

  if not app_private.evaluate_resilience_feature_flag(
    'RESERVATION_PREORDER_ENABLED',
    p_organization_id,
    p_stall_id,
    null,
    p_stall_id::text
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_FEATURE_DISABLED');
  end if;

  if p_starts_at <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_BOOKING_CLOSED');
  end if;

  if not exists (
    select 1
    from public.dining_tables table_record
    join public.stalls stall
      on stall.id = table_record.stall_id
      and stall.organization_id = table_record.organization_id
    where table_record.id = p_dining_table_id
      and table_record.stall_id = p_stall_id
      and table_record.organization_id = p_organization_id
      and table_record.is_active
      and stall.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_SCOPE_INVALID');
  end if;

  perform app_private.lock_reservation_table_capacity(p_dining_table_id);

  begin
    insert into public.reservations (
      organization_id,
      stall_id,
      dining_table_id,
      public_token_hash,
      party_size,
      starts_at,
      ends_at,
      timezone,
      local_business_date,
      preorder_opens_at,
      preorder_cutoff_at,
      modification_cutoff_at,
      cancellation_cutoff_at,
      late_grace_until,
      no_show_eligible_at,
      created_by_profile_id,
      updated_by_profile_id
    ) values (
      p_organization_id,
      p_stall_id,
      p_dining_table_id,
      p_public_token_hash,
      p_party_size,
      p_starts_at,
      p_ends_at,
      p_timezone,
      p_starts_at::date,
      p_starts_at - interval '24 hours',
      p_starts_at - interval '30 minutes',
      p_starts_at - interval '2 hours',
      p_starts_at - interval '2 hours',
      p_starts_at + interval '15 minutes',
      p_starts_at + interval '30 minutes',
      p_actor_profile_id,
      p_actor_profile_id
    )
    returning * into v_reservation;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'code', 'RESERVATION_CAPACITY_UNAVAILABLE');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'RESERVATION_TOKEN_CONFLICT');
  end;

  perform app_private.record_reservation_audit(
    'RESERVATION_CREATED',
    'RESERVATION',
    v_reservation.id,
    v_reservation.organization_id,
    v_reservation.stall_id,
    p_actor_profile_id,
    p_request_id,
    null,
    jsonb_build_object(
      'status', v_reservation.status,
      'tableId', v_reservation.dining_table_id,
      'partySize', v_reservation.party_size,
      'startsAt', v_reservation.starts_at,
      'endsAt', v_reservation.ends_at,
      'timezone', v_reservation.timezone,
      'version', v_reservation.version
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'version', v_reservation.version,
    'startsAt', v_reservation.starts_at,
    'endsAt', v_reservation.ends_at,
    'preorderOpensAt', v_reservation.preorder_opens_at,
    'preorderCutoffAt', v_reservation.preorder_cutoff_at
  );
end;
$$;

create function app_private.modify_reservation(
  p_reservation_id uuid,
  p_organization_id uuid,
  p_stall_id uuid,
  p_expected_version integer,
  p_dining_table_id uuid,
  p_party_size smallint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_request_id text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_initial_table_id uuid;
  v_before_reservation public.reservations%rowtype;
  v_reservation public.reservations%rowtype;
  v_before jsonb;
begin
  if p_expected_version < 1
    or p_party_size not between 1 and 20
    or p_ends_at <= p_starts_at
    or p_ends_at > p_starts_at + interval '6 hours'
    or p_request_id is null
    or char_length(btrim(p_request_id)) not between 1 and 200
    or not exists (
      select 1
      from pg_catalog.pg_timezone_names timezone_record
      where timezone_record.name = p_timezone
    ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID_INPUT');
  end if;

  select reservation.dining_table_id
  into v_initial_table_id
  from public.reservations reservation
  where reservation.id = p_reservation_id
    and reservation.organization_id = p_organization_id
    and reservation.stall_id = p_stall_id;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID');
  end if;

  if v_initial_table_id = p_dining_table_id then
    perform app_private.lock_reservation_table_capacity(p_dining_table_id);
  elsif v_initial_table_id::text < p_dining_table_id::text then
    perform app_private.lock_reservation_table_capacity(v_initial_table_id);
    perform app_private.lock_reservation_table_capacity(p_dining_table_id);
  else
    perform app_private.lock_reservation_table_capacity(p_dining_table_id);
    perform app_private.lock_reservation_table_capacity(v_initial_table_id);
  end if;

  select reservation.*
  into v_before_reservation
  from public.reservations reservation
  where reservation.id = p_reservation_id
    and reservation.organization_id = p_organization_id
    and reservation.stall_id = p_stall_id
  for update of reservation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID');
  end if;
  if v_before_reservation.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID_STATE');
  end if;
  if v_before_reservation.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_VERSION_CONFLICT');
  end if;

  if not app_private.evaluate_resilience_feature_flag(
    'RESERVATION_PREORDER_ENABLED',
    v_before_reservation.organization_id,
    v_before_reservation.stall_id,
    null,
    v_before_reservation.stall_id::text
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_FEATURE_DISABLED');
  end if;

  if now() >= v_before_reservation.modification_cutoff_at
    or p_starts_at <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_MODIFICATION_CUTOFF_REACHED');
  end if;

  if not exists (
    select 1
    from public.dining_tables table_record
    join public.stalls stall
      on stall.id = table_record.stall_id
      and stall.organization_id = table_record.organization_id
    where table_record.id = p_dining_table_id
      and table_record.stall_id = v_before_reservation.stall_id
      and table_record.organization_id = v_before_reservation.organization_id
      and table_record.is_active
      and stall.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_SCOPE_INVALID');
  end if;

  v_before := jsonb_build_object(
    'status', v_before_reservation.status,
    'tableId', v_before_reservation.dining_table_id,
    'partySize', v_before_reservation.party_size,
    'startsAt', v_before_reservation.starts_at,
    'endsAt', v_before_reservation.ends_at,
    'timezone', v_before_reservation.timezone,
    'version', v_before_reservation.version
  );

  begin
    update public.reservations reservation
    set dining_table_id = p_dining_table_id,
        party_size = p_party_size,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        timezone = p_timezone,
        version = reservation.version + 1,
        updated_by_profile_id = p_actor_profile_id
    where reservation.id = v_before_reservation.id
    returning reservation.* into v_reservation;
  exception
    when exclusion_violation then
      return jsonb_build_object('ok', false, 'code', 'RESERVATION_CAPACITY_UNAVAILABLE');
  end;

  update public.reservation_preorder_sessions session
  set status = 'REVOKED',
      revoked_at = now()
  where session.reservation_id = v_reservation.id
    and session.status = 'ACTIVE';

  perform app_private.record_reservation_audit(
    'RESERVATION_MODIFIED',
    'RESERVATION',
    v_reservation.id,
    v_reservation.organization_id,
    v_reservation.stall_id,
    p_actor_profile_id,
    p_request_id,
    v_before,
    jsonb_build_object(
      'status', v_reservation.status,
      'tableId', v_reservation.dining_table_id,
      'partySize', v_reservation.party_size,
      'startsAt', v_reservation.starts_at,
      'endsAt', v_reservation.ends_at,
      'timezone', v_reservation.timezone,
      'version', v_reservation.version
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'version', v_reservation.version,
    'startsAt', v_reservation.starts_at,
    'endsAt', v_reservation.ends_at
  );
end;
$$;

create function app_private.cancel_reservation(
  p_reservation_id uuid,
  p_organization_id uuid,
  p_stall_id uuid,
  p_expected_version integer,
  p_reason_code text,
  p_request_id text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_before_reservation public.reservations%rowtype;
  v_reservation public.reservations%rowtype;
begin
  if p_expected_version < 1
    or p_reason_code is null
    or p_reason_code !~ '^[A-Z][A-Z0-9_]{2,39}$'
    or p_request_id is null
    or char_length(btrim(p_request_id)) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID_INPUT');
  end if;

  select reservation.*
  into v_before_reservation
  from public.reservations reservation
  where reservation.id = p_reservation_id
    and reservation.organization_id = p_organization_id
    and reservation.stall_id = p_stall_id
  for update of reservation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID');
  end if;
  if v_before_reservation.status = 'CANCELLED' then
    return jsonb_build_object(
      'ok', true,
      'reservationId', v_before_reservation.id,
      'status', v_before_reservation.status,
      'version', v_before_reservation.version,
      'idempotentReplay', true
    );
  end if;
  if v_before_reservation.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID_STATE');
  end if;
  if v_before_reservation.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_VERSION_CONFLICT');
  end if;
  if now() >= v_before_reservation.cancellation_cutoff_at then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_CANCELLATION_CUTOFF_REACHED');
  end if;

  update public.reservations reservation
  set status = 'CANCELLED',
      cancellation_reason_code = p_reason_code,
      cancelled_at = now(),
      version = reservation.version + 1,
      updated_by_profile_id = p_actor_profile_id
  where reservation.id = v_before_reservation.id
  returning reservation.* into v_reservation;

  update public.reservation_preorder_sessions session
  set status = 'REVOKED',
      revoked_at = now()
  where session.reservation_id = v_reservation.id
    and session.status = 'ACTIVE';

  perform app_private.record_reservation_audit(
    'RESERVATION_CANCELLED',
    'RESERVATION',
    v_reservation.id,
    v_reservation.organization_id,
    v_reservation.stall_id,
    p_actor_profile_id,
    p_request_id,
    jsonb_build_object(
      'status', v_before_reservation.status,
      'version', v_before_reservation.version
    ),
    jsonb_build_object(
      'status', v_reservation.status,
      'reasonCode', v_reservation.cancellation_reason_code,
      'version', v_reservation.version,
      'refundStatus', v_reservation.refund_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'version', v_reservation.version,
    'refundStatus', v_reservation.refund_status,
    'idempotentReplay', false
  );
end;
$$;

create function app_private.issue_reservation_preorder_session(
  p_reservation_token_hash text,
  p_session_token_hash text,
  p_device_hash text,
  p_session_request_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_reservation public.reservations%rowtype;
  v_session public.reservation_preorder_sessions%rowtype;
begin
  if p_reservation_token_hash is null
    or p_reservation_token_hash !~ '^[0-9a-f]{64}$'
    or p_session_token_hash is null
    or p_session_token_hash !~ '^[0-9a-f]{64}$'
    or p_device_hash is null
    or p_device_hash !~ '^[0-9a-f]{64}$'
    or p_request_id is null
    or char_length(btrim(p_request_id)) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID');
  end if;

  select reservation.*
  into v_reservation
  from public.reservations reservation
  join public.dining_tables table_record
    on table_record.id = reservation.dining_table_id
    and table_record.stall_id = reservation.stall_id
    and table_record.organization_id = reservation.organization_id
  join public.stalls stall
    on stall.id = reservation.stall_id
    and stall.organization_id = reservation.organization_id
  where reservation.public_token_hash = p_reservation_token_hash
    and reservation.status = 'CONFIRMED'
    and table_record.is_active
    and stall.is_active
  for update of reservation;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_INVALID');
  end if;

  if not app_private.evaluate_resilience_feature_flag(
    'RESERVATION_PREORDER_ENABLED',
    v_reservation.organization_id,
    v_reservation.stall_id,
    null,
    p_device_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_FEATURE_DISABLED');
  end if;

  if now() < v_reservation.preorder_opens_at then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_PREORDER_NOT_OPEN');
  end if;
  if now() >= v_reservation.preorder_cutoff_at then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_PREORDER_CUTOFF_REACHED');
  end if;

  update public.reservation_preorder_sessions session
  set status = 'EXPIRED'
  where session.reservation_id = v_reservation.id
    and session.status = 'ACTIVE'
    and session.expires_at <= now();

  select session.*
  into v_session
  from public.reservation_preorder_sessions session
  where session.reservation_id = v_reservation.id
    and session.session_request_id = p_session_request_id;

  if found then
    if v_session.status = 'ACTIVE'
      and v_session.expires_at > now()
      and v_session.token_hash = p_session_token_hash
      and v_session.device_hash = p_device_hash then
      return jsonb_build_object(
        'ok', true,
        'sessionId', v_session.id,
        'reservationId', v_session.reservation_id,
        'reservationVersion', v_session.reservation_version,
        'scheduledFor', v_session.scheduled_for,
        'expiresAt', v_session.expires_at,
        'idempotentReplay', true
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_SESSION_REQUEST_CONFLICT');
  end if;

  if exists (
    select 1
    from public.reservation_preorder_sessions session
    where session.reservation_id = v_reservation.id
      and session.status = 'ACTIVE'
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVATION_PREORDER_SESSION_EXISTS');
  end if;

  begin
    insert into public.reservation_preorder_sessions (
      organization_id,
      stall_id,
      reservation_id,
      reservation_version,
      session_request_id,
      token_hash,
      device_hash,
      scheduled_for,
      expires_at
    ) values (
      v_reservation.organization_id,
      v_reservation.stall_id,
      v_reservation.id,
      v_reservation.version,
      p_session_request_id,
      p_session_token_hash,
      p_device_hash,
      v_reservation.starts_at,
      v_reservation.preorder_cutoff_at
    )
    returning * into v_session;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'RESERVATION_PREORDER_SESSION_EXISTS');
  end;

  perform app_private.record_reservation_audit(
    'RESERVATION_PREORDER_SESSION_ISSUED',
    'RESERVATION_PREORDER_SESSION',
    v_session.id,
    v_session.organization_id,
    v_session.stall_id,
    null,
    p_request_id,
    null,
    jsonb_build_object(
      'reservationId', v_session.reservation_id,
      'reservationVersion', v_session.reservation_version,
      'status', v_session.status,
      'scheduledFor', v_session.scheduled_for,
      'expiresAt', v_session.expires_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'reservationId', v_session.reservation_id,
    'reservationVersion', v_session.reservation_version,
    'scheduledFor', v_session.scheduled_for,
    'expiresAt', v_session.expires_at,
    'idempotentReplay', false
  );
end;
$$;

alter table public.reservations enable row level security;
alter table public.reservations force row level security;
alter table public.reservation_preorder_sessions enable row level security;
alter table public.reservation_preorder_sessions force row level security;

create policy reservations_staff_select
on public.reservations
for select to authenticated
using (
  app_private.has_stall_role(
    stall_id,
    array[
      'STALL_MANAGER'::public.user_role,
      'STAFF'::public.user_role
    ]
  )
);

create policy reservation_preorder_sessions_staff_select
on public.reservation_preorder_sessions
for select to authenticated
using (
  app_private.has_stall_role(
    stall_id,
    array[
      'STALL_MANAGER'::public.user_role,
      'STAFF'::public.user_role
    ]
  )
);

revoke all on table public.reservations
from public, anon, authenticated;
revoke all on table public.reservation_preorder_sessions
from public, anon, authenticated;

grant select (
  id,
  organization_id,
  stall_id,
  dining_table_id,
  status,
  party_size,
  starts_at,
  ends_at,
  timezone,
  local_business_date,
  preorder_opens_at,
  preorder_cutoff_at,
  modification_cutoff_at,
  cancellation_cutoff_at,
  late_grace_until,
  no_show_eligible_at,
  deposit_amount,
  deposit_status,
  refund_status,
  cancellation_reason_code,
  cancelled_at,
  version,
  created_at,
  updated_at
) on table public.reservations to authenticated;
grant select (
  id,
  organization_id,
  stall_id,
  reservation_id,
  reservation_version,
  status,
  scheduled_for,
  expires_at,
  revoked_at,
  created_at,
  updated_at
) on table public.reservation_preorder_sessions to authenticated;
grant select, insert, update, delete on table public.reservations to service_role;
grant select, insert, update, delete on table public.reservation_preorder_sessions to service_role;

revoke all on function app_private.prepare_reservation_row()
from public, anon, authenticated, service_role;
revoke all on function app_private.touch_reservation_preorder_session()
from public, anon, authenticated, service_role;
revoke all on function app_private.lock_reservation_table_capacity(uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.record_reservation_audit(
  text, text, uuid, uuid, uuid, uuid, text, jsonb, jsonb
)
from public, anon, authenticated, service_role;

revoke all on function app_private.create_reservation(
  uuid, uuid, uuid, text, smallint, timestamptz, timestamptz, text, text, uuid
)
from public, anon, authenticated;
revoke all on function app_private.modify_reservation(
  uuid, uuid, uuid, integer, uuid, smallint, timestamptz, timestamptz, text, text, uuid
)
from public, anon, authenticated;
revoke all on function app_private.cancel_reservation(
  uuid, uuid, uuid, integer, text, text, uuid
)
from public, anon, authenticated;
revoke all on function app_private.issue_reservation_preorder_session(
  text, text, text, uuid, text
)
from public, anon, authenticated;

grant execute on function app_private.create_reservation(
  uuid, uuid, uuid, text, smallint, timestamptz, timestamptz, text, text, uuid
)
to service_role;
grant execute on function app_private.modify_reservation(
  uuid, uuid, uuid, integer, uuid, smallint, timestamptz, timestamptz, text, text, uuid
)
to service_role;
grant execute on function app_private.cancel_reservation(
  uuid, uuid, uuid, integer, text, text, uuid
)
to service_role;
grant execute on function app_private.issue_reservation_preorder_session(
  text, text, text, uuid, text
)
to service_role;

comment on table public.reservations is
  'Provisional local reservation authority. One confirmed row owns one dining table time range.';
comment on table public.reservation_preorder_sessions is
  'Short-lived preorder capability explicitly linked to a valid reservation; not an ordinary order_session.';
comment on function app_private.issue_reservation_preorder_session(text, text, text, uuid, text) is
  'Trusted, feature-gated issuance. Invalid reservations cannot receive a reserved table/time-slot session.';
