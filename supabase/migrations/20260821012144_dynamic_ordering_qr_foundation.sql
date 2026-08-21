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
      'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
      '短效內用 dynamic QR foundation；印刷 static QR 永遠保留為入口與復原路徑。',
      false,
      false
    )
    on conflict (code) do nothing;
  end if;
end;
$$;

create table public.dynamic_qr_service_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  dining_table_id uuid not null unique references public.dining_tables(id) on delete cascade,
  static_qr_code_id uuid not null unique references public.qr_codes(id) on delete restrict,
  state text not null default 'PAUSED'
    check (state in ('ACTIVE', 'PAUSED')),
  credential_version integer not null default 1
    check (credential_version between 1 and 2147483647),
  credential_ttl_seconds integer not null default 300
    check (credential_ttl_seconds between 60 and 900),
  max_redemptions smallint not null default 1
    check (max_redemptions between 1 and 3),
  device_binding_required boolean not null default true
    check (device_binding_required),
  paused_at timestamptz default now(),
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_qr_service_points_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade
);

create table public.dynamic_qr_credentials (
  id uuid primary key default gen_random_uuid(),
  service_point_id uuid not null
    references public.dynamic_qr_service_points(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  dining_table_id uuid not null references public.dining_tables(id) on delete cascade,
  static_qr_code_id uuid not null references public.qr_codes(id) on delete restrict,
  order_session_id uuid not null references public.order_sessions(id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text not null unique
    check (nonce_hash ~ '^[0-9a-f]{64}$'),
  device_hash text not null
    check (device_hash ~ '^[A-Za-z0-9_-]{32,128}$'),
  credential_version integer not null check (credential_version > 0),
  state text not null default 'ACTIVE'
    check (state in (
      'ACTIVE', 'CONSUMED', 'PAUSED', 'ROTATED', 'CHECKED_OUT', 'EXPIRED', 'REVOKED'
    )),
  max_redemptions smallint not null check (max_redemptions between 1 and 3),
  redemption_count smallint not null default 0,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_redeemed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_qr_credentials_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint dynamic_qr_credentials_redemption_count_check
    check (redemption_count between 0 and max_redemptions),
  constraint dynamic_qr_credentials_expiry_check
    check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes')
);

create unique index dynamic_qr_credentials_one_active_session_version
  on public.dynamic_qr_credentials (order_session_id, credential_version)
  where state = 'ACTIVE';
create index dynamic_qr_credentials_service_point_state_idx
  on public.dynamic_qr_credentials (service_point_id, state, expires_at);
create index dynamic_qr_credentials_session_state_idx
  on public.dynamic_qr_credentials (order_session_id, state, expires_at);
create index dynamic_qr_credentials_tenant_audit_idx
  on public.dynamic_qr_credentials (organization_id, stall_id, created_at desc);

create function app_private.touch_dynamic_qr_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function app_private.enforce_dynamic_qr_service_point_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_table public.dining_tables%rowtype;
  v_qr public.qr_codes%rowtype;
begin
  select * into v_table
  from public.dining_tables dining_table
  where dining_table.id = new.dining_table_id;
  select * into v_qr
  from public.qr_codes qr
  where qr.id = new.static_qr_code_id;

  if v_table.id is null
    or v_qr.id is null
    or v_table.organization_id <> new.organization_id
    or v_table.stall_id <> new.stall_id
    or v_qr.organization_id <> new.organization_id
    or v_qr.stall_id <> new.stall_id
    or v_qr.dining_table_id is distinct from new.dining_table_id then
    raise exception 'DYNAMIC_QR_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.stall_id is distinct from old.stall_id
      or new.dining_table_id is distinct from old.dining_table_id
      or new.static_qr_code_id is distinct from old.static_qr_code_id then
      raise exception 'DYNAMIC_QR_SERVICE_POINT_SCOPE_IMMUTABLE' using errcode = '23514';
    end if;
    if new.credential_version < old.credential_version
      or new.credential_version > old.credential_version + 1 then
      raise exception 'DYNAMIC_QR_VERSION_TRANSITION_INVALID' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create function app_private.enforce_dynamic_qr_credential_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_service_point public.dynamic_qr_service_points%rowtype;
  v_session public.order_sessions%rowtype;
begin
  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.id = new.service_point_id;
  select * into v_session
  from public.order_sessions session_record
  where session_record.id = new.order_session_id;

  if v_service_point.id is null
    or v_session.id is null
    or v_service_point.organization_id <> new.organization_id
    or v_service_point.stall_id <> new.stall_id
    or v_service_point.dining_table_id <> new.dining_table_id
    or v_service_point.static_qr_code_id <> new.static_qr_code_id
    or v_session.organization_id <> new.organization_id
    or v_session.stall_id <> new.stall_id
    or v_session.qr_code_id <> new.static_qr_code_id then
    raise exception 'DYNAMIC_QR_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    if new.service_point_id is distinct from old.service_point_id
      or new.organization_id is distinct from old.organization_id
      or new.stall_id is distinct from old.stall_id
      or new.dining_table_id is distinct from old.dining_table_id
      or new.static_qr_code_id is distinct from old.static_qr_code_id
      or new.order_session_id is distinct from old.order_session_id
      or new.token_hash is distinct from old.token_hash
      or new.nonce_hash is distinct from old.nonce_hash
      or new.device_hash is distinct from old.device_hash
      or new.credential_version is distinct from old.credential_version
      or new.max_redemptions is distinct from old.max_redemptions
      or new.issued_at is distinct from old.issued_at
      or new.expires_at is distinct from old.expires_at then
      raise exception 'DYNAMIC_QR_CREDENTIAL_SCOPE_IMMUTABLE' using errcode = '23514';
    end if;

    if new.state is distinct from old.state
      and not (
        old.state = 'ACTIVE'
        and new.state in (
          'CONSUMED', 'PAUSED', 'ROTATED', 'CHECKED_OUT', 'EXPIRED', 'REVOKED'
        )
      ) then
      raise exception 'DYNAMIC_QR_STATE_TRANSITION_INVALID' using errcode = '23514';
    end if;
    if new.redemption_count < old.redemption_count
      or new.redemption_count > old.redemption_count + 1 then
      raise exception 'DYNAMIC_QR_REDEMPTION_COUNT_INVALID' using errcode = '23514';
    end if;
  end if;

  if new.state = 'CONSUMED' and new.redemption_count <> new.max_redemptions then
    raise exception 'DYNAMIC_QR_CONSUMPTION_STATE_INVALID' using errcode = '23514';
  end if;
  if new.state = 'ACTIVE' and new.redemption_count >= new.max_redemptions then
    raise exception 'DYNAMIC_QR_ACTIVE_USAGE_INVALID' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger dynamic_qr_service_points_scope_guard
before insert or update on public.dynamic_qr_service_points
for each row execute function app_private.enforce_dynamic_qr_service_point_scope();
create trigger backend_writable_guard
before insert or update or delete on public.dynamic_qr_service_points
for each statement execute function app_private.enforce_backend_writable();
create trigger dynamic_qr_service_points_touch_updated_at
before update on public.dynamic_qr_service_points
for each row execute function app_private.touch_dynamic_qr_updated_at();
create trigger dynamic_qr_credentials_transition_guard
before insert or update on public.dynamic_qr_credentials
for each row execute function app_private.enforce_dynamic_qr_credential_transition();
create trigger backend_writable_guard
before insert or update or delete on public.dynamic_qr_credentials
for each statement execute function app_private.enforce_backend_writable();
create trigger dynamic_qr_credentials_touch_updated_at
before update on public.dynamic_qr_credentials
for each row execute function app_private.touch_dynamic_qr_updated_at();

create function app_private.dynamic_qr_static_fallback(p_reason_code text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'STATIC_QR_RECOVERY',
    'safe', true,
    'static_qr_remains_valid', true,
    'message_code', 'SCAN_PRINTED_STATIC_QR',
    'reason_code', left(coalesce(p_reason_code, 'DYNAMIC_QR_UNAVAILABLE'), 80)
  );
$$;

create function app_private.dynamic_qr_enabled(
  p_organization_id uuid,
  p_stall_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select app_private.evaluate_resilience_feature_flag(
    'DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED',
    p_organization_id,
    p_stall_id,
    null,
    p_stall_id::text
  );
$$;

create function app_private.record_dynamic_qr_audit(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_order_session_id uuid,
  p_credential_id uuid,
  p_action text,
  p_outcome public.audit_outcome,
  p_reason_code text,
  p_request_id text,
  p_ip_hash text default null,
  p_actor_profile_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    id, tenant_id, organization_id, stall_id, actor_profile_id,
    action, entity_type, entity_id, outcome, request_id, ip_hash,
    metadata, created_at
  ) values (
    gen_random_uuid(), p_organization_id, p_organization_id, p_stall_id,
    p_actor_profile_id,
    left(p_action, 100), 'DYNAMIC_QR_CREDENTIAL',
    coalesce(p_credential_id, p_order_session_id, p_dining_table_id),
    p_outcome, left(coalesce(nullif(btrim(p_request_id), ''), 'missing'), 100),
    p_ip_hash,
    jsonb_strip_nulls(jsonb_build_object(
      'reason_code', left(coalesce(p_reason_code, 'UNKNOWN'), 80),
      'dining_table_id', p_dining_table_id,
      'order_session_id', p_order_session_id,
      'credential_id', p_credential_id,
      'actor_profile_id', p_actor_profile_id
    ))::text,
    now()
  );
$$;

create function public.configure_dynamic_qr_service_point(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_static_qr_code_id uuid,
  p_credential_ttl_seconds integer,
  p_max_redemptions integer,
  p_actor_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table public.dining_tables%rowtype;
  v_qr public.qr_codes%rowtype;
  v_service_point public.dynamic_qr_service_points%rowtype;
begin
  if p_credential_ttl_seconds not between 60 and 900
    or p_max_redemptions not between 1 and 3 then
    return jsonb_build_object(
      'ok', false,
      'code', 'DYNAMIC_QR_POLICY_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_POLICY_INVALID')
    );
  end if;

  select * into v_table
  from public.dining_tables dining_table
  where dining_table.id = p_dining_table_id;
  select * into v_qr
  from public.qr_codes qr
  where qr.id = p_static_qr_code_id;

  if v_table.id is null
    or v_qr.id is null
    or v_table.organization_id <> p_organization_id
    or v_table.stall_id <> p_stall_id
    or v_qr.organization_id <> p_organization_id
    or v_qr.stall_id <> p_stall_id
    or v_qr.dining_table_id is distinct from p_dining_table_id then
    return jsonb_build_object(
      'ok', false,
      'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.dining_table_id = p_dining_table_id
  for update;

  if found and v_service_point.static_qr_code_id <> p_static_qr_code_id then
    perform app_private.record_dynamic_qr_audit(
      p_organization_id, p_stall_id, p_dining_table_id, null,
      null, 'DYNAMIC_QR_CONFIGURATION_DENIED', 'DENIED',
      'DYNAMIC_QR_SERVICE_POINT_MISMATCH', p_request_id, null, p_actor_profile_id
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  if v_service_point.id is null then
    insert into public.dynamic_qr_service_points (
      organization_id, stall_id, dining_table_id, static_qr_code_id,
      state, credential_ttl_seconds, max_redemptions, paused_at
    ) values (
      p_organization_id, p_stall_id, p_dining_table_id, p_static_qr_code_id,
      'PAUSED', p_credential_ttl_seconds, p_max_redemptions, now()
    ) returning * into v_service_point;
  else
    update public.dynamic_qr_service_points
    set credential_ttl_seconds = p_credential_ttl_seconds,
        max_redemptions = p_max_redemptions
    where id = v_service_point.id
    returning * into v_service_point;
  end if;

  perform app_private.record_dynamic_qr_audit(
    v_service_point.organization_id, v_service_point.stall_id,
    v_service_point.dining_table_id, null, null,
    'DYNAMIC_QR_SERVICE_POINT_CONFIGURED', 'SUCCESS', 'CONFIGURED',
    p_request_id, null, p_actor_profile_id
  );
  return jsonb_build_object(
    'ok', true,
    'code', 'DYNAMIC_QR_SERVICE_POINT_CONFIGURED',
    'service_point_id', v_service_point.id,
    'state', v_service_point.state,
    'credential_version', v_service_point.credential_version,
    'credential_ttl_seconds', v_service_point.credential_ttl_seconds,
    'max_redemptions', v_service_point.max_redemptions,
    'static_qr_remains_valid', true
  );
end;
$$;

create function public.set_dynamic_qr_service_point_state(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_state text,
  p_actor_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := upper(coalesce(btrim(p_state), ''));
  v_service_point public.dynamic_qr_service_points%rowtype;
begin
  if v_state not in ('ACTIVE', 'PAUSED') then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_STATE_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_STATE_INVALID')
    );
  end if;

  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.organization_id = p_organization_id
    and service_point.stall_id = p_stall_id
    and service_point.dining_table_id = p_dining_table_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  update public.dynamic_qr_service_points
  set state = v_state,
      paused_at = case when v_state = 'PAUSED' then now() else null end
  where id = v_service_point.id
  returning * into v_service_point;

  if v_state = 'PAUSED' then
    update public.dynamic_qr_credentials
    set state = 'PAUSED', invalidated_at = now(), invalidation_reason = 'SERVICE_POINT_PAUSED'
    where service_point_id = v_service_point.id and state = 'ACTIVE';
  end if;

  perform app_private.record_dynamic_qr_audit(
    v_service_point.organization_id, v_service_point.stall_id,
    v_service_point.dining_table_id, null, null,
    case when v_state = 'PAUSED' then 'DYNAMIC_QR_PAUSED' else 'DYNAMIC_QR_RESUMED' end,
    'SUCCESS', v_state, p_request_id, null, p_actor_profile_id
  );
  return jsonb_build_object(
    'ok', true,
    'code', case when v_state = 'PAUSED' then 'DYNAMIC_QR_PAUSED' else 'DYNAMIC_QR_ACTIVE' end,
    'service_point_id', v_service_point.id,
    'state', v_service_point.state,
    'credential_version', v_service_point.credential_version,
    'static_qr_remains_valid', true
  );
end;
$$;

create function public.rotate_dynamic_qr_service_point(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_actor_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_point public.dynamic_qr_service_points%rowtype;
begin
  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.organization_id = p_organization_id
    and service_point.stall_id = p_stall_id
    and service_point.dining_table_id = p_dining_table_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  update public.dynamic_qr_credentials
  set state = 'ROTATED', invalidated_at = now(), invalidation_reason = 'SERVICE_POINT_ROTATED'
  where service_point_id = v_service_point.id and state = 'ACTIVE';
  update public.dynamic_qr_service_points
  set credential_version = credential_version + 1,
      rotated_at = now()
  where id = v_service_point.id
  returning * into v_service_point;

  perform app_private.record_dynamic_qr_audit(
    v_service_point.organization_id, v_service_point.stall_id,
    v_service_point.dining_table_id, null, null,
    'DYNAMIC_QR_ROTATED', 'SUCCESS', 'ROTATED',
    p_request_id, null, p_actor_profile_id
  );
  return jsonb_build_object(
    'ok', true, 'code', 'DYNAMIC_QR_ROTATED',
    'service_point_id', v_service_point.id,
    'state', v_service_point.state,
    'credential_version', v_service_point.credential_version,
    'static_qr_remains_valid', true
  );
end;
$$;

create function public.issue_dynamic_qr_credential(
  p_organization_id uuid,
  p_stall_id uuid,
  p_dining_table_id uuid,
  p_static_qr_code_id uuid,
  p_order_session_id uuid,
  p_token_hash text,
  p_nonce_hash text,
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
  v_service_point public.dynamic_qr_service_points%rowtype;
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_table public.dining_tables%rowtype;
  v_credential public.dynamic_qr_credentials%rowtype;
  v_expires_at timestamptz;
  v_rate_allowed boolean;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_device_hash !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_ip_hash !~ '^[A-Za-z0-9_-]{32,128}$'
    or char_length(coalesce(p_request_id, '')) not between 1 and 100 then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_INVALID')
    );
  end if;

  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.organization_id = p_organization_id
    and service_point.stall_id = p_stall_id
    and service_point.dining_table_id = p_dining_table_id
    and service_point.static_qr_code_id = p_static_qr_code_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  if not app_private.dynamic_qr_enabled(p_organization_id, p_stall_id) then
    perform app_private.record_dynamic_qr_audit(
      p_organization_id, p_stall_id, p_dining_table_id, p_order_session_id,
      null, 'DYNAMIC_QR_ISSUE_DENIED', 'DENIED', 'DYNAMIC_QR_DISABLED',
      p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_DISABLED',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_DISABLED')
    );
  end if;
  if v_service_point.state <> 'ACTIVE' then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_PAUSED',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_PAUSED')
    );
  end if;

  select * into v_session
  from public.order_sessions session_record
  where session_record.id = p_order_session_id
  for update;
  select * into v_qr
  from public.qr_codes qr
  where qr.id = p_static_qr_code_id;
  select * into v_table
  from public.dining_tables dining_table
  where dining_table.id = p_dining_table_id;

  if v_session.id is null
    or v_qr.id is null
    or v_table.id is null
    or v_session.organization_id <> p_organization_id
    or v_session.stall_id <> p_stall_id
    or v_session.qr_code_id <> p_static_qr_code_id
    or v_qr.organization_id <> p_organization_id
    or v_qr.stall_id <> p_stall_id
    or v_qr.dining_table_id is distinct from p_dining_table_id
    or v_table.organization_id <> p_organization_id
    or v_table.stall_id <> p_stall_id then
    perform app_private.record_dynamic_qr_audit(
      p_organization_id, p_stall_id, p_dining_table_id, p_order_session_id,
      null, 'DYNAMIC_QR_ISSUE_DENIED', 'DENIED', 'DYNAMIC_QR_SCOPE_MISMATCH',
      p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SCOPE_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SCOPE_MISMATCH')
    );
  end if;
  if v_session.device_hash <> p_device_hash then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_DEVICE_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_DEVICE_MISMATCH')
    );
  end if;
  if v_session.status <> 'ACTIVE'::public.order_session_status
    or v_session.order_id is not null then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_CHECKED_OUT',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_CHECKED_OUT')
    );
  end if;
  if v_session.expires_at <= now() then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_EXPIRED',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_EXPIRED')
    );
  end if;
  if not v_table.is_active
    or v_qr.state <> 'ACTIVE'::public.qr_code_state
    or (v_qr.expires_at is not null and v_qr.expires_at <= now()) then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SERVICE_POINT_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SERVICE_POINT_MISMATCH')
    );
  end if;

  v_rate_allowed := public.consume_public_rate_limit(
    p_stall_id, 'DYNAMIC_QR_ISSUE_DEVICE', p_device_hash, 20, 60
  );
  if v_rate_allowed then
    v_rate_allowed := public.consume_public_rate_limit(
      p_stall_id, 'DYNAMIC_QR_ISSUE_SESSION', v_session.token_hash, 20, 60
    );
  end if;
  if not v_rate_allowed then
    perform app_private.record_dynamic_qr_audit(
      p_organization_id, p_stall_id, p_dining_table_id, p_order_session_id,
      null, 'DYNAMIC_QR_ISSUE_DENIED', 'DENIED', 'DYNAMIC_QR_RATE_LIMITED',
      p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_RATE_LIMITED',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_RATE_LIMITED')
    );
  end if;

  v_expires_at := least(
    v_session.expires_at,
    now() + make_interval(secs => v_service_point.credential_ttl_seconds)
  );
  begin
    insert into public.dynamic_qr_credentials (
      service_point_id, organization_id, stall_id, dining_table_id,
      static_qr_code_id, order_session_id, token_hash, nonce_hash,
      device_hash, credential_version, state, max_redemptions,
      redemption_count, issued_at, expires_at
    ) values (
      v_service_point.id, p_organization_id, p_stall_id, p_dining_table_id,
      p_static_qr_code_id, p_order_session_id, p_token_hash, p_nonce_hash,
      p_device_hash, v_service_point.credential_version, 'ACTIVE',
      v_service_point.max_redemptions, 0, now(), v_expires_at
    ) returning * into v_credential;
  exception
    when unique_violation then
      perform app_private.record_dynamic_qr_audit(
        p_organization_id, p_stall_id, p_dining_table_id, p_order_session_id,
        null, 'DYNAMIC_QR_ISSUE_DENIED', 'DENIED', 'DYNAMIC_QR_ALREADY_ACTIVE',
        p_request_id, p_ip_hash, null
      );
      return jsonb_build_object(
        'ok', false, 'code', 'DYNAMIC_QR_ALREADY_ACTIVE',
        'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_ALREADY_ACTIVE')
      );
  end;

  perform app_private.record_dynamic_qr_audit(
    p_organization_id, p_stall_id, p_dining_table_id, p_order_session_id,
    v_credential.id, 'DYNAMIC_QR_ISSUED', 'SUCCESS', 'ISSUED',
    p_request_id, p_ip_hash, null
  );
  return jsonb_build_object(
    'ok', true, 'code', 'DYNAMIC_QR_ISSUED',
    'credential_id', v_credential.id,
    'credential_version', v_credential.credential_version,
    'max_redemptions', v_credential.max_redemptions,
    'expires_at', v_credential.expires_at,
    'static_qr_remains_valid', true
  );
end;
$$;

create function public.redeem_dynamic_qr_credential(
  p_token_hash text,
  p_nonce_hash text,
  p_static_qr_token text,
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
  v_service_point_id uuid;
  v_service_point public.dynamic_qr_service_points%rowtype;
  v_credential public.dynamic_qr_credentials%rowtype;
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_table public.dining_tables%rowtype;
  v_preflight jsonb;
  v_code text;
  v_rate_allowed boolean;
  v_remaining integer;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_device_hash !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_ip_hash !~ '^[A-Za-z0-9_-]{32,128}$'
    or char_length(coalesce(p_static_qr_token, '')) not between 24 and 200
    or char_length(coalesce(p_request_id, '')) not between 1 and 100 then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_INVALID')
    );
  end if;

  select credential.service_point_id into v_service_point_id
  from public.dynamic_qr_credentials credential
  where credential.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_INVALID')
    );
  end if;

  select * into v_service_point
  from public.dynamic_qr_service_points service_point
  where service_point.id = v_service_point_id
  for update;
  select * into v_credential
  from public.dynamic_qr_credentials credential
  where credential.token_hash = p_token_hash
    and credential.service_point_id = v_service_point.id
  for update;
  if v_service_point.id is null or v_credential.id is null then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_INVALID',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_INVALID')
    );
  end if;

  v_rate_allowed := public.consume_public_rate_limit(
    v_credential.stall_id, 'DYNAMIC_QR_REDEEM_CREDENTIAL', p_token_hash, 6, 60
  );
  if v_rate_allowed then
    v_rate_allowed := public.consume_public_rate_limit(
      v_credential.stall_id, 'DYNAMIC_QR_REDEEM_DEVICE', p_device_hash, 60, 60
    );
  end if;
  if not v_rate_allowed then
    perform app_private.record_dynamic_qr_audit(
      v_credential.organization_id, v_credential.stall_id,
      v_credential.dining_table_id, v_credential.order_session_id,
      v_credential.id, 'DYNAMIC_QR_REDEEM_DENIED', 'DENIED',
      'DYNAMIC_QR_RATE_LIMITED', p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_RATE_LIMITED',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_RATE_LIMITED')
    );
  end if;

  if not app_private.dynamic_qr_enabled(
    v_credential.organization_id, v_credential.stall_id
  ) then
    v_code := 'DYNAMIC_QR_DISABLED';
  elsif v_service_point.state <> 'ACTIVE' or v_credential.state = 'PAUSED' then
    v_code := 'DYNAMIC_QR_PAUSED';
  elsif v_credential.state = 'CONSUMED' then
    v_code := 'DYNAMIC_QR_ALREADY_USED';
  elsif v_credential.state = 'ROTATED' then
    v_code := 'DYNAMIC_QR_ROTATED';
  elsif v_credential.state = 'CHECKED_OUT' then
    v_code := 'DYNAMIC_QR_CHECKED_OUT';
  elsif v_credential.state = 'EXPIRED' then
    v_code := 'DYNAMIC_QR_EXPIRED';
  elsif v_credential.state = 'REVOKED' then
    v_code := 'DYNAMIC_QR_INVALID';
  elsif v_credential.credential_version <> v_service_point.credential_version then
    update public.dynamic_qr_credentials
    set state = 'ROTATED', invalidated_at = now(), invalidation_reason = 'VERSION_MISMATCH'
    where id = v_credential.id;
    v_code := 'DYNAMIC_QR_ROTATED';
  elsif v_credential.expires_at <= now() then
    update public.dynamic_qr_credentials
    set state = 'EXPIRED', invalidated_at = now(), invalidation_reason = 'EXPIRED'
    where id = v_credential.id;
    v_code := 'DYNAMIC_QR_EXPIRED';
  end if;

  if v_code is not null then
    perform app_private.record_dynamic_qr_audit(
      v_credential.organization_id, v_credential.stall_id,
      v_credential.dining_table_id, v_credential.order_session_id,
      v_credential.id, 'DYNAMIC_QR_REDEEM_DENIED', 'DENIED',
      v_code, p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', v_code,
      'fallback', app_private.dynamic_qr_static_fallback(v_code)
    );
  end if;

  if v_credential.nonce_hash is distinct from p_nonce_hash then
    v_code := 'DYNAMIC_QR_INVALID';
  elsif v_credential.device_hash is distinct from p_device_hash then
    v_code := 'DYNAMIC_QR_DEVICE_MISMATCH';
  end if;
  if v_code is not null then
    perform app_private.record_dynamic_qr_audit(
      v_credential.organization_id, v_credential.stall_id,
      v_credential.dining_table_id, v_credential.order_session_id,
      v_credential.id, 'DYNAMIC_QR_REDEEM_DENIED', 'DENIED',
      v_code, p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', v_code,
      'fallback', app_private.dynamic_qr_static_fallback(v_code)
    );
  end if;

  select * into v_session
  from public.order_sessions session_record
  where session_record.id = v_credential.order_session_id
  for update;
  select * into v_qr
  from public.qr_codes qr
  where qr.id = v_credential.static_qr_code_id;
  select * into v_table
  from public.dining_tables dining_table
  where dining_table.id = v_credential.dining_table_id;

  if v_session.id is null
    or v_qr.id is null
    or v_table.id is null
    or v_session.id <> v_credential.order_session_id
    or v_session.qr_code_id <> v_credential.static_qr_code_id
    or v_session.organization_id <> v_credential.organization_id
    or v_session.stall_id <> v_credential.stall_id
    or v_qr.organization_id <> v_credential.organization_id
    or v_qr.stall_id <> v_credential.stall_id
    or v_qr.dining_table_id is distinct from v_credential.dining_table_id
    or v_qr.token is distinct from p_static_qr_token
    or v_table.organization_id <> v_credential.organization_id
    or v_table.stall_id <> v_credential.stall_id
    or not v_table.is_active
    or v_qr.state <> 'ACTIVE'::public.qr_code_state
    or (v_qr.expires_at is not null and v_qr.expires_at <= now()) then
    v_code := 'DYNAMIC_QR_SERVICE_POINT_MISMATCH';
  elsif v_session.device_hash is distinct from p_device_hash then
    v_code := 'DYNAMIC_QR_DEVICE_MISMATCH';
  elsif v_session.order_id is not null
    or v_session.status in (
      'CONSUMED'::public.order_session_status,
      'REVOKED'::public.order_session_status
    ) then
    update public.dynamic_qr_credentials
    set state = 'CHECKED_OUT', invalidated_at = now(), invalidation_reason = 'SESSION_CHECKED_OUT'
    where id = v_credential.id;
    v_code := 'DYNAMIC_QR_CHECKED_OUT';
  elsif v_session.expires_at <= now()
    or v_session.status = 'EXPIRED'::public.order_session_status then
    update public.dynamic_qr_credentials
    set state = 'EXPIRED', invalidated_at = now(), invalidation_reason = 'SESSION_EXPIRED'
    where id = v_credential.id;
    v_code := 'DYNAMIC_QR_EXPIRED';
  elsif v_session.status <> 'ACTIVE'::public.order_session_status then
    v_code := 'DYNAMIC_QR_INVALID';
  end if;

  if v_code is not null then
    perform app_private.record_dynamic_qr_audit(
      v_credential.organization_id, v_credential.stall_id,
      v_credential.dining_table_id, v_credential.order_session_id,
      v_credential.id, 'DYNAMIC_QR_REDEEM_DENIED', 'DENIED',
      v_code, p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false, 'code', v_code,
      'fallback', app_private.dynamic_qr_static_fallback(v_code)
    );
  end if;

  v_preflight := public.public_order_preflight(
    'ORDER',
    p_static_qr_token,
    v_session.ordering_mode,
    p_device_hash,
    p_ip_hash,
    encode(extensions.digest(p_static_qr_token, 'sha256'), 'hex'),
    p_token_hash,
    p_request_id,
    v_session.token_hash,
    null,
    null,
    null,
    null,
    '[]'::jsonb,
    false,
    null
  );
  if not coalesce((v_preflight->>'ok')::boolean, false) then
    perform app_private.record_dynamic_qr_audit(
      v_credential.organization_id, v_credential.stall_id,
      v_credential.dining_table_id, v_credential.order_session_id,
      v_credential.id, 'DYNAMIC_QR_REDEEM_DENIED', 'DENIED',
      'DYNAMIC_QR_CANONICAL_PREFLIGHT_DENIED', p_request_id, p_ip_hash, null
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'DYNAMIC_QR_CANONICAL_PREFLIGHT_DENIED',
      'canonical_code', v_preflight->>'code',
      'fallback', app_private.dynamic_qr_static_fallback(
        'DYNAMIC_QR_CANONICAL_PREFLIGHT_DENIED'
      )
    );
  end if;

  update public.dynamic_qr_credentials
  set redemption_count = v_credential.redemption_count + 1,
      last_redeemed_at = now(),
      state = case
        when v_credential.redemption_count + 1 >= v_credential.max_redemptions
          then 'CONSUMED'
        else 'ACTIVE'
      end,
      invalidated_at = case
        when v_credential.redemption_count + 1 >= v_credential.max_redemptions
          then now()
        else null
      end,
      invalidation_reason = case
        when v_credential.redemption_count + 1 >= v_credential.max_redemptions
          then 'MAX_REDEMPTIONS_REACHED'
        else null
      end
  where id = v_credential.id;
  v_remaining := greatest(
    v_credential.max_redemptions - v_credential.redemption_count - 1,
    0
  );

  perform app_private.record_dynamic_qr_audit(
    v_credential.organization_id, v_credential.stall_id,
    v_credential.dining_table_id, v_credential.order_session_id,
    v_credential.id, 'DYNAMIC_QR_REDEEMED', 'SUCCESS', 'REDEEMED',
    p_request_id, p_ip_hash, null
  );
  return jsonb_build_object(
    'ok', true,
    'code', 'DYNAMIC_QR_REDEEMED',
    'credential_id', v_credential.id,
    'order_session_id', v_credential.order_session_id,
    'remaining_redemptions', v_remaining,
    'canonical_preflight', v_preflight,
    'static_qr_remains_valid', true
  );
end;
$$;

create function public.invalidate_dynamic_qr_checkout(
  p_organization_id uuid,
  p_stall_id uuid,
  p_order_session_id uuid,
  p_actor_profile_id uuid,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_count integer;
  v_table_id uuid;
begin
  select * into v_session
  from public.order_sessions session_record
  where session_record.id = p_order_session_id
    and session_record.organization_id = p_organization_id
    and session_record.stall_id = p_stall_id
  for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'DYNAMIC_QR_SCOPE_MISMATCH',
      'fallback', app_private.dynamic_qr_static_fallback('DYNAMIC_QR_SCOPE_MISMATCH')
    );
  end if;

  select qr.dining_table_id into v_table_id
  from public.qr_codes qr
  where qr.id = v_session.qr_code_id;
  update public.dynamic_qr_credentials
  set state = 'CHECKED_OUT', invalidated_at = now(), invalidation_reason = 'CHECKOUT'
  where order_session_id = p_order_session_id
    and organization_id = p_organization_id
    and stall_id = p_stall_id
    and state = 'ACTIVE';
  get diagnostics v_count = row_count;

  perform app_private.record_dynamic_qr_audit(
    p_organization_id, p_stall_id, v_table_id, p_order_session_id,
    null, 'DYNAMIC_QR_CHECKOUT_INVALIDATED', 'SUCCESS', 'CHECKOUT',
    p_request_id, null, p_actor_profile_id
  );
  return jsonb_build_object(
    'ok', true,
    'code', 'DYNAMIC_QR_CHECKED_OUT',
    'order_session_id', p_order_session_id,
    'invalidated_count', v_count,
    'static_qr_remains_valid', true
  );
end;
$$;

alter table public.dynamic_qr_service_points enable row level security;
alter table public.dynamic_qr_service_points force row level security;
alter table public.dynamic_qr_credentials enable row level security;
alter table public.dynamic_qr_credentials force row level security;

revoke all on table public.dynamic_qr_service_points
  from public, anon, authenticated, service_role;
revoke all on table public.dynamic_qr_credentials
  from public, anon, authenticated, service_role;
grant select on table public.dynamic_qr_service_points to service_role;
grant select on table public.dynamic_qr_credentials to service_role;

revoke all on function app_private.touch_dynamic_qr_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_dynamic_qr_service_point_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_dynamic_qr_credential_transition()
  from public, anon, authenticated, service_role;
revoke all on function app_private.dynamic_qr_static_fallback(text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.dynamic_qr_enabled(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.record_dynamic_qr_audit(
  uuid, uuid, uuid, uuid, uuid, text, public.audit_outcome, text, text, text, uuid
) from public, anon, authenticated, service_role;

revoke all on function public.configure_dynamic_qr_service_point(
  uuid, uuid, uuid, uuid, integer, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.configure_dynamic_qr_service_point(
  uuid, uuid, uuid, uuid, integer, integer, uuid, text
) to service_role;

revoke all on function public.set_dynamic_qr_service_point_state(
  uuid, uuid, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_dynamic_qr_service_point_state(
  uuid, uuid, uuid, text, uuid, text
) to service_role;

revoke all on function public.rotate_dynamic_qr_service_point(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.rotate_dynamic_qr_service_point(
  uuid, uuid, uuid, uuid, text
) to service_role;

revoke all on function public.issue_dynamic_qr_credential(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.issue_dynamic_qr_credential(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text
) to service_role;

revoke all on function public.redeem_dynamic_qr_credential(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.redeem_dynamic_qr_credential(
  text, text, text, text, text, text
) to service_role;

revoke all on function public.invalidate_dynamic_qr_checkout(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.invalidate_dynamic_qr_checkout(
  uuid, uuid, uuid, uuid, text
) to service_role;

comment on table public.dynamic_qr_service_points is
  'Paused-by-default policy and credential version for a dine-in service point; the linked printed static QR remains the durable entry and recovery path.';
comment on table public.dynamic_qr_credentials is
  'Short-lived finite-use ordering capabilities. Only token and nonce hashes are persisted; scope is immutable and redemption still calls canonical public-order preflight.';
