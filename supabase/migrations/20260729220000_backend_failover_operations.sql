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
  select *
  into runtime_state
  from public.backend_runtime_state
  where is_current
  for share;

  if not found then
    raise exception 'BACKEND_FENCING_NOT_CONFIGURED'
      using errcode = '55000';
  end if;

  if not runtime_state.enforcement_enabled then
    return coalesce(expected_promotion_epoch, 0);
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

create or replace function app_private.transition_backend_runtime(
  expected_backend_code text,
  expected_promotion_epoch bigint,
  target_backend_code text,
  target_backend_role text,
  target_promotion_epoch bigint,
  transition_reason text,
  actor_profile_id uuid default null
)
returns table (
  backend_code text,
  backend_role text,
  promotion_epoch bigint,
  writes_enabled boolean,
  enforcement_enabled boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  current_state public.backend_runtime_state%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('stallorder:backend-runtime-transition', 0)
  );

  select *
  into current_state
  from public.backend_runtime_state runtime
  where runtime.is_current
  for update;

  if not found then
    raise exception 'BACKEND_RUNTIME_STATE_MISSING'
      using errcode = '55000';
  end if;

  if current_state.backend_code <> expected_backend_code
    or current_state.promotion_epoch <> expected_promotion_epoch then
    raise exception 'BACKEND_RUNTIME_STATE_CHANGED'
      using errcode = '40001';
  end if;

  if target_backend_code not in ('PRIMARY', 'DR') then
    raise exception 'BACKEND_TARGET_INVALID'
      using errcode = '22023';
  end if;

  if target_backend_role not in (
    'ACTIVE_WRITER',
    'READ_ONLY_STANDBY',
    'SEALED',
    'DISABLED'
  ) then
    raise exception 'BACKEND_ROLE_INVALID'
      using errcode = '22023';
  end if;

  if target_promotion_epoch < current_state.promotion_epoch then
    raise exception 'BACKEND_PROMOTION_EPOCH_REGRESSION'
      using errcode = '22023';
  end if;

  if char_length(btrim(transition_reason)) not between 10 and 1000 then
    raise exception 'BACKEND_TRANSITION_REASON_INVALID'
      using errcode = '22023';
  end if;

  if target_backend_code <> current_state.backend_code then
    if current_state.enforcement_enabled then
      raise exception 'BACKEND_LOCAL_IDENTITY_ALREADY_FENCED'
        using errcode = '55000';
    end if;
    if target_backend_role <> 'READ_ONLY_STANDBY' then
      raise exception 'BACKEND_INITIAL_TARGET_MUST_BE_STANDBY'
        using errcode = '22023';
    end if;

    update public.backend_runtime_state
    set
      backend_role = 'DISABLED',
      writes_enabled = false,
      enforcement_enabled = false,
      is_current = false,
      demoted_at = now(),
      reason = transition_reason,
      updated_by_profile_id = actor_profile_id
    where backend_runtime_state.backend_code = current_state.backend_code;
  elsif current_state.enforcement_enabled
    and not (
      (current_state.backend_role = 'ACTIVE_WRITER'
        and target_backend_role in ('ACTIVE_WRITER', 'SEALED'))
      or (current_state.backend_role = 'SEALED'
        and target_backend_role in ('SEALED', 'ACTIVE_WRITER', 'READ_ONLY_STANDBY'))
      or (current_state.backend_role = 'READ_ONLY_STANDBY'
        and target_backend_role in ('READ_ONLY_STANDBY', 'ACTIVE_WRITER', 'DISABLED'))
      or (current_state.backend_role = 'DISABLED'
        and target_backend_role in ('DISABLED', 'READ_ONLY_STANDBY'))
    ) then
    raise exception 'BACKEND_TRANSITION_INVALID'
      using errcode = '22023';
  end if;

  if current_state.backend_role = 'READ_ONLY_STANDBY'
    and target_backend_role = 'ACTIVE_WRITER'
    and target_promotion_epoch <= current_state.promotion_epoch then
    raise exception 'BACKEND_PROMOTION_EPOCH_NOT_ADVANCED'
      using errcode = '22023';
  end if;

  update public.backend_runtime_state
  set
    backend_role = target_backend_role,
    promotion_epoch = target_promotion_epoch,
    writes_enabled = target_backend_role = 'ACTIVE_WRITER',
    enforcement_enabled = true,
    is_current = true,
    promoted_at = case
      when target_backend_role = 'ACTIVE_WRITER' then now()
      else backend_runtime_state.promoted_at
    end,
    demoted_at = case
      when target_backend_role = 'ACTIVE_WRITER' then null
      else now()
    end,
    reason = transition_reason,
    updated_by_profile_id = actor_profile_id
  where backend_runtime_state.backend_code = target_backend_code;

  if not found then
    raise exception 'BACKEND_TARGET_STATE_MISSING'
      using errcode = '55000';
  end if;

  return query
  select
    runtime.backend_code,
    runtime.backend_role,
    runtime.promotion_epoch,
    runtime.writes_enabled,
    runtime.enforcement_enabled
  from public.backend_runtime_state runtime
  where runtime.is_current;
end;
$$;

revoke all on function app_private.transition_backend_runtime(
  text,
  bigint,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated, service_role;

comment on function app_private.assert_backend_writable(bigint) is
  'Fail-closed backend fencing check controlled by the environment-local runtime row.';
comment on function app_private.transition_backend_runtime(
  text,
  bigint,
  text,
  text,
  bigint,
  text,
  uuid
) is
  'Direct-administration-only, advisory-locked transition for one environment-local backend state.';
