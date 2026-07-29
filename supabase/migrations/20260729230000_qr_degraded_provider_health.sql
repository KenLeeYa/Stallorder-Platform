create or replace function app_private.evaluate_resilience_feature_flag(
  p_code text,
  p_organization_id uuid default null,
  p_stall_id uuid default null,
  p_device_id uuid default null,
  p_rollout_key text default null
)
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_flag_id uuid;
  v_default_enabled boolean;
  v_override_enabled boolean;
  v_rollout_percentage smallint;
  v_rollout_key text;
  v_digest bytea;
  v_bucket integer;
begin
  select flag.id, flag.default_enabled
  into v_flag_id, v_default_enabled
  from public.resilience_feature_flags flag
  where flag.code = p_code;

  if not found then
    return false;
  end if;

  select override.enabled
  into v_override_enabled
  from public.resilience_feature_flag_overrides override
  where override.flag_id = v_flag_id
    and (override.expires_at is null or override.expires_at > now())
    and (
      (
        override.scope_type = 'DEVICE'
        and p_device_id is not null
        and override.organization_id = p_organization_id
        and override.stall_id = p_stall_id
        and override.device_id = p_device_id
      )
      or (
        override.scope_type = 'STALL'
        and p_stall_id is not null
        and override.organization_id = p_organization_id
        and override.stall_id = p_stall_id
      )
      or (
        override.scope_type = 'ORGANIZATION'
        and p_organization_id is not null
        and override.organization_id = p_organization_id
      )
      or override.scope_type = 'GLOBAL'
    )
  order by case override.scope_type
    when 'DEVICE' then 1
    when 'STALL' then 2
    when 'ORGANIZATION' then 3
    when 'GLOBAL' then 4
    else 5
  end
  limit 1;

  if found then
    return v_override_enabled;
  end if;

  select override.enabled, override.rollout_percentage
  into v_override_enabled, v_rollout_percentage
  from public.resilience_feature_flag_overrides override
  where override.flag_id = v_flag_id
    and override.scope_type = 'PERCENTAGE'
    and (override.expires_at is null or override.expires_at > now())
  limit 1;

  v_rollout_key := coalesce(
    nullif(btrim(p_rollout_key), ''),
    p_device_id::text,
    p_stall_id::text,
    p_organization_id::text
  );
  if found and v_rollout_key is not null and v_rollout_percentage is not null then
    v_digest := extensions.digest(p_code || ':' || v_rollout_key, 'sha256');
    v_bucket := (
      get_byte(v_digest, 0)::bigint * 16777216
      + get_byte(v_digest, 1)::bigint * 65536
      + get_byte(v_digest, 2)::bigint * 256
      + get_byte(v_digest, 3)::bigint
    ) % 100;
    if v_bucket < v_rollout_percentage then
      return v_override_enabled;
    end if;
  end if;

  return v_default_enabled;
end;
$$;

create or replace function public.check_public_order_intake_availability(
  p_qr_token text,
  p_device_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions, app_private
as $$
declare
  v_runtime public.backend_runtime_state%rowtype;
  v_organization_id uuid;
  v_stall_id uuid;
begin
  select *
  into v_runtime
  from public.backend_runtime_state runtime
  where runtime.is_current;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'QR_ORDERING_UNAVAILABLE'
    );
  end if;

  if v_runtime.enforcement_enabled
    and (
      v_runtime.backend_role <> 'ACTIVE_WRITER'
      or not v_runtime.writes_enabled
    ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'QR_ORDERING_UNAVAILABLE'
    );
  end if;

  select qr.organization_id, qr.stall_id
  into v_organization_id, v_stall_id
  from public.qr_codes qr
  where qr.token = p_qr_token;

  if not found then
    return jsonb_build_object('ok', true);
  end if;

  if app_private.evaluate_resilience_feature_flag(
    'EMERGENCY_QR_DEGRADED_MODE',
    v_organization_id,
    v_stall_id,
    p_device_id,
    p_device_id::text
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'QR_ORDERING_DEGRADED'
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function app_private.evaluate_resilience_feature_flag(
  text,
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function app_private.evaluate_resilience_feature_flag(
  text,
  uuid,
  uuid,
  uuid,
  text
) to service_role;

revoke all on function public.check_public_order_intake_availability(text, uuid)
  from public, anon, authenticated;
grant execute on function public.check_public_order_intake_availability(text, uuid)
  to service_role;

comment on function app_private.evaluate_resilience_feature_flag(
  text,
  uuid,
  uuid,
  uuid,
  text
) is
  'Server-only flag evaluation with Device, Stall, Organization, Global and deterministic percentage precedence.';
comment on function public.check_public_order_intake_availability(text, uuid) is
  'Trusted preflight that blocks new public order writes on a sealed backend or during emergency QR degraded mode.';
