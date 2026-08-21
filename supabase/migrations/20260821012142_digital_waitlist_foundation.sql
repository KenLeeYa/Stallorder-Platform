-- QR-P3-01: tenant-scoped digital waitlist foundation.
-- Production activation remains blocked by ADR-003 Product and Legal approval.

create type public.digital_waitlist_status as enum (
  'WAITING',
  'NOTIFIED',
  'SEATED',
  'CANCELLED',
  'NO_SHOW'
);

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
      'DIGITAL_WAITLIST_FOUNDATION_ENABLED',
      'Provisional QR-P3-01 digital waitlist foundation. Product and Legal approval is required before Production activation.',
      false,
      false
    )
    on conflict (code) do nothing;
  end if;
end;
$$;

create table public.digital_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  public_token_hash text not null unique
    check (public_token_hash ~ '^[0-9a-f]{64}$'),
  duplicate_key_hash text not null
    check (duplicate_key_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 80),
  party_size integer not null
    check (party_size between 1 and 20),
  status public.digital_waitlist_status not null default 'WAITING',
  state_version integer not null default 1
    check (state_version > 0),
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  hold_expires_at timestamptz,
  seated_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  assigned_dining_table_id uuid
    references public.dining_tables(id) on delete restrict,
  seating_exchange_token_hash text unique
    check (
      seating_exchange_token_hash is null
      or seating_exchange_token_hash ~ '^[0-9a-f]{64}$'
    ),
  seating_exchange_expires_at timestamptz,
  seating_exchange_consumed_at timestamptz,
  retention_expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_waitlist_entries_stall_organization_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint digital_waitlist_entries_id_scope_key
    unique (id, organization_id, stall_id),
  constraint digital_waitlist_entries_retention_bounded check (
    retention_expires_at > created_at
    and retention_expires_at <= created_at + interval '30 days'
  ),
  constraint digital_waitlist_entries_state_shape check (
    (
      status = 'WAITING'
      and notified_at is null
      and hold_expires_at is null
      and seated_at is null
      and cancelled_at is null
      and no_show_at is null
      and assigned_dining_table_id is null
      and seating_exchange_token_hash is null
      and seating_exchange_expires_at is null
      and seating_exchange_consumed_at is null
    )
    or (
      status = 'NOTIFIED'
      and notified_at is not null
      and hold_expires_at is not null
      and seated_at is null
      and cancelled_at is null
      and no_show_at is null
      and assigned_dining_table_id is null
      and seating_exchange_token_hash is null
      and seating_exchange_expires_at is null
      and seating_exchange_consumed_at is null
    )
    or (
      status = 'SEATED'
      and notified_at is not null
      and hold_expires_at is not null
      and seated_at is not null
      and cancelled_at is null
      and no_show_at is null
      and assigned_dining_table_id is not null
      and seating_exchange_token_hash is not null
      and seating_exchange_expires_at is not null
    )
    or (
      status = 'CANCELLED'
      and seated_at is null
      and cancelled_at is not null
      and no_show_at is null
      and assigned_dining_table_id is null
      and seating_exchange_token_hash is null
      and seating_exchange_expires_at is null
      and seating_exchange_consumed_at is null
    )
    or (
      status = 'NO_SHOW'
      and notified_at is not null
      and hold_expires_at is not null
      and seated_at is null
      and cancelled_at is null
      and no_show_at is not null
      and assigned_dining_table_id is null
      and seating_exchange_token_hash is null
      and seating_exchange_expires_at is null
      and seating_exchange_consumed_at is null
    )
  )
);

create unique index digital_waitlist_entries_one_active_duplicate
  on public.digital_waitlist_entries (stall_id, duplicate_key_hash)
  where status in ('WAITING', 'NOTIFIED');
create index digital_waitlist_entries_queue_idx
  on public.digital_waitlist_entries (organization_id, stall_id, status, joined_at, id);
create index digital_waitlist_entries_retention_idx
  on public.digital_waitlist_entries (retention_expires_at);

create table public.digital_waitlist_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  entry_id uuid not null,
  channel text not null default 'IN_APP'
    check (channel = 'IN_APP'),
  delivery_state text not null default 'MOCK_RECORDED'
    check (delivery_state = 'MOCK_RECORDED'),
  template_code text not null default 'WAITLIST_READY'
    check (template_code = 'WAITLIST_READY'),
  mock_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(mock_payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint digital_waitlist_notifications_entry_scope_fkey
    foreign key (entry_id, organization_id, stall_id)
    references public.digital_waitlist_entries(id, organization_id, stall_id)
    on delete cascade,
  constraint digital_waitlist_notifications_stall_organization_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade
);

create index digital_waitlist_notifications_entry_idx
  on public.digital_waitlist_notifications (entry_id, created_at desc);
create index digital_waitlist_notifications_scope_idx
  on public.digital_waitlist_notifications (organization_id, stall_id, created_at desc);

create function app_private.digital_waitlist_enabled(
  p_organization_id uuid,
  p_stall_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag_id uuid;
  v_default boolean;
  v_override boolean;
begin
  select flag.id, flag.default_enabled
  into v_flag_id, v_default
  from public.resilience_feature_flags flag
  where flag.code = 'DIGITAL_WAITLIST_FOUNDATION_ENABLED';

  if not found then
    return false;
  end if;

  select override.enabled
  into v_override
  from public.resilience_feature_flag_overrides override
  where override.flag_id = v_flag_id
    and (override.expires_at is null or override.expires_at > now())
    and (
      (
        override.scope_type = 'STALL'
        and override.organization_id = p_organization_id
        and override.stall_id = p_stall_id
      )
      or (
        override.scope_type = 'ORGANIZATION'
        and override.organization_id = p_organization_id
      )
      or override.scope_type = 'GLOBAL'
    )
  order by case override.scope_type
    when 'STALL' then 1
    when 'ORGANIZATION' then 2
    when 'GLOBAL' then 3
    else 4
  end
  limit 1;

  return coalesce(v_override, v_default, false);
end;
$$;

create function app_private.record_digital_waitlist_audit(
  p_organization_id uuid,
  p_stall_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_entry_id uuid,
  p_outcome public.audit_outcome,
  p_request_id text,
  p_ip_hash text,
  p_metadata jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    id, tenant_id, organization_id, stall_id, actor_profile_id,
    action, entity_type, entity_id, outcome, request_id,
    ip_hash, metadata, created_at
  ) values (
    gen_random_uuid(), p_organization_id, p_organization_id, p_stall_id,
    p_actor_profile_id, left(p_action, 80), 'DIGITAL_WAITLIST_ENTRY',
    p_entry_id, p_outcome, left(p_request_id, 100), p_ip_hash,
    coalesce(p_metadata, '{}'::jsonb)::text, now()
  );
$$;

create function app_private.enforce_digital_waitlist_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.stall_id is distinct from old.stall_id
     or new.public_token_hash is distinct from old.public_token_hash
     or new.duplicate_key_hash is distinct from old.duplicate_key_hash
     or new.joined_at is distinct from old.joined_at
     or new.created_at is distinct from old.created_at
     or new.retention_expires_at is distinct from old.retention_expires_at then
    raise exception 'WAITLIST_IMMUTABLE_FIELD_CHANGED' using errcode = '23514';
  end if;

  if new.state_version <> old.state_version + 1 then
    raise exception 'WAITLIST_STATE_VERSION_INVALID' using errcode = '23514';
  end if;

  if old.status = 'WAITING' and new.status in ('NOTIFIED', 'CANCELLED') then
    null;
  elsif old.status = 'NOTIFIED' and new.status in ('SEATED', 'CANCELLED') then
    null;
  elsif old.status = 'NOTIFIED' and new.status = 'NO_SHOW' then
    if old.hold_expires_at is null or old.hold_expires_at > now() then
      raise exception 'WAITLIST_HOLD_ACTIVE' using errcode = '23514';
    end if;
  elsif old.status = 'SEATED' and new.status = 'SEATED'
        and old.seating_exchange_consumed_at is null
        and new.seating_exchange_consumed_at is not null then
    null;
  else
    raise exception 'WAITLIST_STATE_TRANSITION_INVALID' using errcode = '23514';
  end if;

  if new.status = 'SEATED' and (
    new.assigned_dining_table_id is null
    or new.seating_exchange_token_hash is null
    or new.seating_exchange_expires_at is null
  ) then
    raise exception 'WAITLIST_SEATING_CONTRACT_REQUIRED' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger digital_waitlist_entries_transition_guard
before update on public.digital_waitlist_entries
for each row execute function app_private.enforce_digital_waitlist_transition();

create trigger backend_writable_guard
before insert or update or delete on public.digital_waitlist_entries
for each statement execute function app_private.enforce_backend_writable();

create trigger backend_writable_guard
before insert or update or delete on public.digital_waitlist_notifications
for each statement execute function app_private.enforce_backend_writable();

create function public.join_digital_waitlist(
  p_stall_id uuid,
  p_party_size integer,
  p_display_name text,
  p_public_token_hash text,
  p_duplicate_key_hash text,
  p_ip_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_entry_id uuid;
  v_joined_at timestamptz;
  v_position integer;
  v_ip_allowed boolean;
  v_device_allowed boolean;
begin
  select stall.organization_id
  into v_organization_id
  from public.stalls stall
  where stall.id = p_stall_id
    and stall.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_STALL_NOT_FOUND');
  end if;

  if not app_private.digital_waitlist_enabled(v_organization_id, p_stall_id) then
    return jsonb_build_object('ok', false, 'code', 'DIGITAL_WAITLIST_DISABLED');
  end if;

  if p_party_size not between 1 and 20
     or char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80
     or p_public_token_hash !~ '^[0-9a-f]{64}$'
     or p_duplicate_key_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash !~ '^[0-9a-f]{64}$'
     or char_length(btrim(coalesce(p_request_id, ''))) not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_INVALID_INPUT');
  end if;

  v_ip_allowed := public.consume_public_rate_limit(
    p_stall_id, 'WAITLIST_IP', p_ip_hash, 10, 600
  );
  v_device_allowed := public.consume_public_rate_limit(
    p_stall_id, 'WAITLIST_DEVICE', p_duplicate_key_hash, 10, 600
  );
  if not (v_ip_allowed and v_device_allowed) then
    perform app_private.record_digital_waitlist_audit(
      v_organization_id, p_stall_id, null, 'DIGITAL_WAITLIST_RATE_LIMITED',
      null, 'DENIED', p_request_id, p_ip_hash,
      jsonb_build_object('reason', 'RATE_LIMITED')
    );
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_RATE_LIMITED');
  end if;

  if exists (
    select 1
    from public.digital_waitlist_entries entry
    where entry.stall_id = p_stall_id
      and entry.duplicate_key_hash = p_duplicate_key_hash
      and entry.status in ('WAITING', 'NOTIFIED')
  ) then
    perform app_private.record_digital_waitlist_audit(
      v_organization_id, p_stall_id, null, 'DIGITAL_WAITLIST_DUPLICATE_REJECTED',
      null, 'DENIED', p_request_id, p_ip_hash,
      jsonb_build_object('reason', 'ACTIVE_ENTRY_EXISTS')
    );
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_ALREADY_ACTIVE');
  end if;

  insert into public.digital_waitlist_entries (
    organization_id, stall_id, public_token_hash, duplicate_key_hash,
    display_name, party_size
  ) values (
    v_organization_id, p_stall_id, p_public_token_hash,
    p_duplicate_key_hash, btrim(p_display_name), p_party_size
  )
  on conflict do nothing
  returning id, joined_at into v_entry_id, v_joined_at;

  if v_entry_id is null then
    if exists (
      select 1
      from public.digital_waitlist_entries entry
      where entry.stall_id = p_stall_id
        and entry.duplicate_key_hash = p_duplicate_key_hash
        and entry.status in ('WAITING', 'NOTIFIED')
    ) then
      perform app_private.record_digital_waitlist_audit(
        v_organization_id, p_stall_id, null, 'DIGITAL_WAITLIST_DUPLICATE_REJECTED',
        null, 'DENIED', p_request_id, p_ip_hash,
        jsonb_build_object('reason', 'CONCURRENT_ACTIVE_ENTRY_EXISTS')
      );
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_ALREADY_ACTIVE');
    end if;
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_TOKEN_COLLISION');
  end if;

  select count(*)::integer
  into v_position
  from public.digital_waitlist_entries entry
  where entry.stall_id = p_stall_id
    and entry.status in ('WAITING', 'NOTIFIED')
    and (entry.joined_at, entry.id) <= (v_joined_at, v_entry_id);

  perform app_private.record_digital_waitlist_audit(
    v_organization_id, p_stall_id, null, 'DIGITAL_WAITLIST_JOINED',
    v_entry_id, 'SUCCESS', p_request_id, p_ip_hash,
    jsonb_build_object('partySize', p_party_size, 'position', v_position)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'WAITLIST_JOINED',
    'entry_id', v_entry_id,
    'status', 'WAITING',
    'position', v_position,
    'joined_at', v_joined_at
  );
end;
$$;

create function public.get_digital_waitlist_status(
  p_public_token_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.digital_waitlist_entries%rowtype;
  v_position integer;
  v_table_label text;
begin
  if p_public_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_NOT_FOUND');
  end if;

  select * into v_entry
  from public.digital_waitlist_entries entry
  where entry.public_token_hash = p_public_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_NOT_FOUND');
  end if;

  if not app_private.digital_waitlist_enabled(
    v_entry.organization_id, v_entry.stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'DIGITAL_WAITLIST_DISABLED');
  end if;

  if v_entry.status in ('WAITING', 'NOTIFIED') then
    select count(*)::integer into v_position
    from public.digital_waitlist_entries entry
    where entry.stall_id = v_entry.stall_id
      and entry.status in ('WAITING', 'NOTIFIED')
      and (entry.joined_at, entry.id) <= (v_entry.joined_at, v_entry.id);
  end if;

  if v_entry.assigned_dining_table_id is not null then
    select table_record.label into v_table_label
    from public.dining_tables table_record
    where table_record.id = v_entry.assigned_dining_table_id
      and table_record.stall_id = v_entry.stall_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'WAITLIST_STATUS',
    'entry_id', v_entry.id,
    'stall_id', v_entry.stall_id,
    'display_name', v_entry.display_name,
    'party_size', v_entry.party_size,
    'status', v_entry.status,
    'state_version', v_entry.state_version,
    'position', v_position,
    'hold_expires_at', v_entry.hold_expires_at,
    'table_label', v_table_label,
    'updated_at', v_entry.updated_at
  );
end;
$$;

create function public.transition_digital_waitlist_entry(
  p_organization_id uuid,
  p_stall_id uuid,
  p_entry_id uuid,
  p_expected_version integer,
  p_operation text,
  p_dining_table_id uuid,
  p_seating_token_hash text,
  p_actor_profile_id uuid,
  p_ip_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.digital_waitlist_entries%rowtype;
  v_now timestamptz := now();
  v_operation text := upper(btrim(coalesce(p_operation, '')));
begin
  if not app_private.digital_waitlist_enabled(p_organization_id, p_stall_id) then
    return jsonb_build_object('ok', false, 'code', 'DIGITAL_WAITLIST_DISABLED');
  end if;

  select * into v_entry
  from public.digital_waitlist_entries entry
  where entry.id = p_entry_id
    and entry.organization_id = p_organization_id
    and entry.stall_id = p_stall_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_NOT_FOUND');
  end if;
  if v_entry.state_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_VERSION_CONFLICT');
  end if;

  if v_operation = 'NOTIFY' then
    if v_entry.status <> 'WAITING' then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_TRANSITION_INVALID');
    end if;
    update public.digital_waitlist_entries
    set status = 'NOTIFIED',
        state_version = state_version + 1,
        notified_at = v_now,
        hold_expires_at = v_now + interval '10 minutes'
    where id = v_entry.id
    returning * into v_entry;

    insert into public.digital_waitlist_notifications (
      organization_id, stall_id, entry_id, channel, delivery_state,
      template_code, mock_payload
    ) values (
      v_entry.organization_id, v_entry.stall_id, v_entry.id,
      'IN_APP', 'MOCK_RECORDED', 'WAITLIST_READY',
      jsonb_build_object(
        'entryId', v_entry.id,
        'holdExpiresAt', v_entry.hold_expires_at,
        'mock', true
      )
    );
  elsif v_operation = 'CANCEL' then
    if v_entry.status not in ('WAITING', 'NOTIFIED') then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_TRANSITION_INVALID');
    end if;
    update public.digital_waitlist_entries
    set status = 'CANCELLED',
        state_version = state_version + 1,
        cancelled_at = v_now
    where id = v_entry.id
    returning * into v_entry;
  elsif v_operation = 'MARK_NO_SHOW' then
    if v_entry.status <> 'NOTIFIED' then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_TRANSITION_INVALID');
    end if;
    if v_entry.hold_expires_at is null or v_entry.hold_expires_at > v_now then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_HOLD_ACTIVE');
    end if;
    update public.digital_waitlist_entries
    set status = 'NO_SHOW',
        state_version = state_version + 1,
        no_show_at = v_now
    where id = v_entry.id
    returning * into v_entry;
  elsif v_operation = 'SEAT' then
    if v_entry.status <> 'NOTIFIED' then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_TRANSITION_INVALID');
    end if;
    if p_seating_token_hash !~ '^[0-9a-f]{64}$'
       or not exists (
         select 1
         from public.dining_tables table_record
         where table_record.id = p_dining_table_id
           and table_record.organization_id = p_organization_id
           and table_record.stall_id = p_stall_id
           and table_record.is_active
       )
       or not exists (
         select 1
         from public.qr_codes qr
         where qr.organization_id = p_organization_id
           and qr.stall_id = p_stall_id
           and qr.dining_table_id = p_dining_table_id
           and qr.state = 'ACTIVE'
           and (qr.expires_at is null or qr.expires_at > v_now)
       ) then
      return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_CONTRACT_INVALID');
    end if;
    update public.digital_waitlist_entries
    set status = 'SEATED',
        state_version = state_version + 1,
        seated_at = v_now,
        assigned_dining_table_id = p_dining_table_id,
        seating_exchange_token_hash = p_seating_token_hash,
        seating_exchange_expires_at = v_now + interval '15 minutes'
    where id = v_entry.id
    returning * into v_entry;
  else
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_OPERATION_INVALID');
  end if;

  perform app_private.record_digital_waitlist_audit(
    v_entry.organization_id, v_entry.stall_id, p_actor_profile_id,
    'DIGITAL_WAITLIST_STATE_CHANGED', v_entry.id, 'SUCCESS',
    p_request_id, p_ip_hash,
    jsonb_build_object(
      'operation', v_operation,
      'status', v_entry.status,
      'stateVersion', v_entry.state_version,
      'diningTableId', v_entry.assigned_dining_table_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'WAITLIST_STATE_CHANGED',
    'entry_id', v_entry.id,
    'status', v_entry.status,
    'state_version', v_entry.state_version,
    'hold_expires_at', v_entry.hold_expires_at,
    'seating_exchange_expires_at', v_entry.seating_exchange_expires_at,
    'assigned_dining_table_id', v_entry.assigned_dining_table_id
  );
end;
$$;

create function public.exchange_digital_waitlist_seating(
  p_public_token_hash text,
  p_seating_token_hash text,
  p_session_token_hash text,
  p_device_hash text,
  p_ip_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.digital_waitlist_entries%rowtype;
  v_qr public.qr_codes%rowtype;
  v_tenant_id uuid;
  v_ttl_seconds integer;
  v_session_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_expires_at timestamptz;
begin
  select * into v_entry
  from public.digital_waitlist_entries entry
  where entry.public_token_hash = p_public_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_TOKEN_INVALID');
  end if;
  if not app_private.digital_waitlist_enabled(
    v_entry.organization_id, v_entry.stall_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'DIGITAL_WAITLIST_DISABLED');
  end if;
  if v_entry.status <> 'SEATED'
     or v_entry.seating_exchange_token_hash is distinct from p_seating_token_hash then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_TOKEN_INVALID');
  end if;
  if v_entry.seating_exchange_consumed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_TOKEN_USED');
  end if;
  if v_entry.seating_exchange_expires_at is null
     or v_entry.seating_exchange_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_TOKEN_EXPIRED');
  end if;
  if p_session_token_hash !~ '^[0-9a-f]{64}$'
     or p_device_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_SEATING_INPUT_INVALID');
  end if;

  select qr.* into v_qr
  from public.qr_codes qr
  join public.dining_tables table_record
    on table_record.id = qr.dining_table_id
   and table_record.organization_id = qr.organization_id
   and table_record.stall_id = qr.stall_id
  where qr.organization_id = v_entry.organization_id
    and qr.stall_id = v_entry.stall_id
    and qr.dining_table_id = v_entry.assigned_dining_table_id
    and qr.state = 'ACTIVE'
    and (qr.expires_at is null or qr.expires_at > v_now)
    and table_record.is_active
  order by qr.created_at desc, qr.id
  limit 1
  for update of qr;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_DINE_IN_QR_UNAVAILABLE');
  end if;

  select stall.tenant_id, settings.order_session_ttl_seconds
  into v_tenant_id, v_ttl_seconds
  from public.stalls stall
  join public.stall_ordering_settings settings on settings.stall_id = stall.id
  where stall.id = v_entry.stall_id
    and stall.organization_id = v_entry.organization_id
    and stall.is_active
    and settings.dine_in_enabled;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WAITLIST_DINE_IN_UNAVAILABLE');
  end if;

  v_expires_at := v_now + make_interval(secs => v_ttl_seconds);
  insert into public.order_sessions (
    id, tenant_id, organization_id, stall_id, qr_code_id, token_hash,
    device_hash, ip_hash, status, expires_at, ordering_mode,
    location_id, market_event_id, stall_schedule_id,
    fulfillment_type_context, created_at
  ) values (
    v_session_id, v_tenant_id, v_entry.organization_id, v_entry.stall_id,
    v_qr.id, p_session_token_hash, p_device_hash, p_ip_hash,
    'ACTIVE', v_expires_at, 'DEFAULT', v_qr.location_id,
    v_qr.market_event_id, v_qr.stall_schedule_id,
    v_qr.fulfillment_type_context, v_now
  );

  update public.digital_waitlist_entries entry
  set state_version = entry.state_version + 1,
      seating_exchange_consumed_at = v_now
  where entry.id = v_entry.id;

  perform app_private.record_digital_waitlist_audit(
    v_entry.organization_id, v_entry.stall_id, null,
    'DIGITAL_WAITLIST_SEATING_EXCHANGED', v_entry.id, 'SUCCESS',
    p_request_id, p_ip_hash,
    jsonb_build_object(
      'orderSessionId', v_session_id,
      'diningTableId', v_entry.assigned_dining_table_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'DINE_IN_SESSION_ISSUED',
    'organization_id', v_entry.organization_id,
    'stall_id', v_entry.stall_id,
    'qr_code_id', v_qr.id,
    'dining_table_id', v_entry.assigned_dining_table_id,
    'order_session_id', v_session_id,
    'ordering_mode', 'DEFAULT',
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'SESSION_TOKEN_COLLISION');
end;
$$;

create function public.purge_expired_digital_waitlist_entries(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.digital_waitlist_entries
  where retention_expires_at <= p_now;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.digital_waitlist_entries enable row level security;
alter table public.digital_waitlist_entries force row level security;
alter table public.digital_waitlist_notifications enable row level security;
alter table public.digital_waitlist_notifications force row level security;

create policy digital_waitlist_entries_member_select
on public.digital_waitlist_entries
for select to authenticated
using (app_private.has_stall_role(stall_id, null::public.user_role[]));

create policy digital_waitlist_notifications_member_select
on public.digital_waitlist_notifications
for select to authenticated
using (app_private.has_stall_role(stall_id, null::public.user_role[]));

revoke all on table public.digital_waitlist_entries
from public, anon, authenticated;
revoke all on table public.digital_waitlist_notifications
from public, anon, authenticated;
grant select (
  id, organization_id, stall_id, display_name, party_size, status,
  state_version, joined_at, notified_at, hold_expires_at, seated_at,
  cancelled_at, no_show_at, assigned_dining_table_id,
  seating_exchange_expires_at, seating_exchange_consumed_at,
  retention_expires_at, created_at, updated_at
) on table public.digital_waitlist_entries to authenticated;
grant select (
  id, organization_id, stall_id, entry_id, channel, delivery_state,
  template_code, created_at
) on table public.digital_waitlist_notifications to authenticated;
grant select, insert, update, delete
on table public.digital_waitlist_entries to service_role;
grant select, insert, delete
on table public.digital_waitlist_notifications to service_role;

revoke all on function app_private.digital_waitlist_enabled(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function app_private.record_digital_waitlist_audit(
  uuid, uuid, uuid, text, uuid, public.audit_outcome, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_digital_waitlist_transition()
from public, anon, authenticated, service_role;

revoke all on function public.join_digital_waitlist(
  uuid, integer, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.join_digital_waitlist(
  uuid, integer, text, text, text, text, text
) to service_role;

revoke all on function public.get_digital_waitlist_status(text)
from public, anon, authenticated;
grant execute on function public.get_digital_waitlist_status(text)
to service_role;

revoke all on function public.transition_digital_waitlist_entry(
  uuid, uuid, uuid, integer, text, uuid, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.transition_digital_waitlist_entry(
  uuid, uuid, uuid, integer, text, uuid, text, uuid, text, text
) to service_role;

revoke all on function public.exchange_digital_waitlist_seating(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exchange_digital_waitlist_seating(
  text, text, text, text, text, text
) to service_role;

revoke all on function public.purge_expired_digital_waitlist_entries(timestamptz)
from public, anon, authenticated;
grant execute on function public.purge_expired_digital_waitlist_entries(timestamptz)
to service_role;

comment on table public.digital_waitlist_entries is
  'QR-P3-01 tenant-scoped waitlist entries. Tokens are hashes and are not ordering credentials.';
comment on table public.digital_waitlist_notifications is
  'IN_APP MOCK_RECORDED events only. This table does not represent external delivery.';
