-- Immediate customer intake uses one server-clock calendar on both circuits.
-- No table/data changes; existing authorization, replay and POS rules remain.
set lock_timeout = '5s';
set statement_timeout = '2min';

create function public.public_order_calendar_code(p_qr_token text, p_now timestamptz default now())
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_qr public.qr_codes%rowtype;
  v_stall public.stalls%rowtype;
  v_local timestamp;
  v_window record;
  v_schedule public.stall_schedules%rowtype;
  v_event public.market_events%rowtype;
begin
  select * into v_qr from public.qr_codes where token = p_qr_token;
  if not found then return 'QR_NOT_FOUND'; end if;
  select * into v_stall from public.stalls where id = v_qr.stall_id;
  if not found or not v_stall.is_active then return 'STALL_CLOSED'; end if;
  if v_stall.business_status = 'PAUSED' or v_stall.ordering_state = 'PAUSED' then return 'ORDERING_PAUSED'; end if;
  if v_stall.is_sold_out or v_stall.business_status = 'SOLD_OUT' then return 'STALL_SOLD_OUT'; end if;
  if v_stall.business_status = 'CLOSED' or v_stall.ordering_state = 'CLOSED'
     or not v_stall.ordering_enabled then return 'STALL_CLOSED'; end if;
  v_local := p_now at time zone v_stall.timezone;

  -- Special windows remain same-day (enforced by the existing CHECK/API).
  -- A full closed date overrides even yesterday's weekly overnight tail.
  if exists (select 1 from public.stall_special_closures c
    where c.stall_id = v_stall.id and v_local::date between c.starts_on and c.ends_on
      and (c.opens_at is null or v_local::time < c.opens_at::time or v_local::time >= c.closes_at::time)) then
    return 'STALL_SPECIAL_CLOSURE';
  end if;
  if exists (select 1 from public.stall_special_closures c
    where c.stall_id = v_stall.id and v_local::date between c.starts_on and c.ends_on
      and c.last_order_at is not null and v_local::time >= c.last_order_at::time) then
    return 'QR_LAST_ORDER_PASSED';
  end if;

  -- Explicit schedules/events retain their own ordering window authority.
  -- validate_ordering_schedule_context is still called by the intake wrappers.
  -- Recheck the existing context/status/window rules at wall time after locks.
  if v_qr.stall_schedule_id is not null then
    select * into v_schedule from public.stall_schedules
    where id = v_qr.stall_schedule_id;
    if not found or v_schedule.organization_id <> v_qr.organization_id
       or v_schedule.stall_id <> v_qr.stall_id
       or v_schedule.location_id is distinct from v_qr.location_id
       or v_schedule.market_event_id is distinct from v_qr.market_event_id then
      return 'SCHEDULE_CONTEXT_MISMATCH';
    end if;
    if v_schedule.status in (
      'CANCELLED'::public.stall_schedule_status,
      'COMPLETED'::public.stall_schedule_status
    ) or coalesce(v_schedule.ordering_closes_at, v_schedule.ends_at) <= p_now then
      return 'SCHEDULE_CLOSED';
    end if;
    if v_schedule.status <> 'OPEN'::public.stall_schedule_status
       or coalesce(v_schedule.ordering_opens_at, v_schedule.starts_at) > p_now then
      return 'SCHEDULE_NOT_ACTIVE';
    end if;
  end if;

  if v_qr.market_event_id is not null then
    select * into v_event from public.market_events where id = v_qr.market_event_id;
    if not found or v_event.organization_id <> v_qr.organization_id then
      return 'EVENT_NOT_ACTIVE';
    end if;
    if v_event.ends_at <= p_now then return 'EVENT_EXPIRED'; end if;
    if v_qr.stall_schedule_id is null and v_event.starts_at > p_now then
      return 'EVENT_NOT_ACTIVE';
    end if;
  end if;

  if v_qr.stall_schedule_id is not null or v_qr.market_event_id is not null then return null; end if;

  -- Preserve legacy no-calendar behavior; configured closed/missing days deny.
  if not exists (select 1 from public.stall_business_hours h where h.stall_id = v_stall.id)
     and not exists (select 1 from public.stall_special_closures c
       where c.stall_id = v_stall.id and v_local::date between c.starts_on and c.ends_on) then
    return null;
  end if;
  select w.* into v_window
  from generate_series(-1, 0) d
  cross join lateral app_private.stall_ordering_window(v_stall.id, v_local::date + d) w
  where v_local >= w.opens_at and v_local < w.closes_at
  order by w.opens_at desc limit 1;
  if not found then return 'STALL_CLOSED'; end if;
  if v_window.last_order_at is not null and v_local >= v_window.last_order_at then return 'QR_LAST_ORDER_PASSED'; end if;
  return null;
end;
$$;
revoke all on function public.public_order_calendar_code(text,timestamptz) from public, anon, authenticated;
grant execute on function public.public_order_calendar_code(text,timestamptz) to service_role;

-- Amend exact established denial points instead of replacing auth/tenant bodies.
do $migration$
declare
  v_oid regprocedure := 'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text := replace(pg_get_functiondef(v_oid), chr(13), '');
  v_old text := E'  if v_schedule_code is null and v_ordering_mode = ''DEFAULT'' and public.qr_last_order_reached(v_qr.stall_id, now()) then\n    v_schedule_code := ''QR_LAST_ORDER_PASSED'';\n  end if;';
begin
  if (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old) <> 1 then
    raise exception 'PUBLIC_CALENDAR_PREFLIGHT_ANCHOR_MISSING_OR_AMBIGUOUS';
  end if;
  execute replace(v_source,v_old,E'  if v_schedule_code is null and v_ordering_mode in (''DEFAULT'', ''DELIVERY'') then\n    v_schedule_code := public.public_order_calendar_code(p_qr_token, clock_timestamp());\n  end if;');
end;
$migration$;

-- JSON null is not SQL NULL. Only an actual replay/resume object bypasses closure.
do $migration$
declare
  v_oid regprocedure := 'public.public_order_preflight_with_special_closure(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text := replace(pg_get_functiondef(v_oid), chr(13), '');
  v_anchor text;
begin
  foreach v_anchor in array array['v_result->''resumable_order'' is not null','v_result->''idempotent_order'' is not null'] loop
    if (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor) <> 1 then
      raise exception 'PUBLIC_CALENDAR_REPLAY_ANCHOR_MISSING_OR_AMBIGUOUS';
    end if;
    v_source := replace(v_source,v_anchor,'jsonb_typeof(' || split_part(v_anchor, ' is not null', 1) || ') = ''object''');
  end loop;
  execute v_source;
end;
$migration$;

-- The established STALL -> SESSION locks and idempotent replay run before this
-- innermost creation guard. Check wall time again after acquiring those locks.
do $migration$
declare
  v_oid regprocedure := 'public.create_public_order_legacy(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure;
  v_source text := replace(pg_get_functiondef(v_oid), chr(13), '');
  v_anchor text := '  if jsonb_typeof(p_items) <> ''array'' or jsonb_array_length(p_items) = 0 then';
  v_guard text := $guard$  if v_session.ordering_mode in ('DEFAULT', 'DELIVERY') then
    declare
      v_calendar_code text := public.public_order_calendar_code(p_qr_token, clock_timestamp());
    begin
      if v_calendar_code is not null then
        perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', v_calendar_code,
          v_session.tenant_id, v_session.stall_id, v_session.qr_code_id, v_session.id,
          p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
        return jsonb_build_object('ok', false, 'code', v_calendar_code);
      end if;
    end;
  end if;

$guard$;
begin
  if (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'PUBLIC_CALENDAR_CREATE_ANCHOR_MISSING_OR_AMBIGUOUS';
  end if;
  execute replace(v_source,v_anchor,v_guard || v_anchor);
end;
$migration$;
