-- Local catalog operations: shared calendar windows and QR intake cutoff.
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.stall_business_hours add column last_order_at text;
alter table public.stall_special_closures add column last_order_at text;

create or replace function app_private.valid_last_order_time(p_opens text, p_closes text, p_last text)
returns boolean language sql immutable set search_path = '' as $$
  select p_last is null or (
    p_opens is not null and p_closes is not null
    and p_last ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and case when p_opens < p_closes then p_last between p_opens and p_closes
      when p_opens = p_closes then true
      else p_last >= p_opens or p_last <= p_closes end
  );
$$;
revoke all on function app_private.valid_last_order_time(text,text,text) from public, anon, authenticated;
grant execute on function app_private.valid_last_order_time(text,text,text) to service_role;
alter table public.stall_business_hours add constraint stall_business_hours_last_order_check
  check (app_private.valid_last_order_time(opens_at, closes_at, last_order_at));
alter table public.stall_special_closures add constraint stall_special_closures_last_order_check
  check (app_private.valid_last_order_time(opens_at, closes_at, last_order_at));

-- One local-date window resolver for QR cutoff and all pickup calendars.
-- A special date overrides the weekly rule, including a normally closed weekday.
create or replace function app_private.stall_ordering_window(p_stall_id uuid, p_date date)
returns table(opens_at timestamp, closes_at timestamp, last_order_at timestamp)
language sql stable security definer set search_path = '' as $$
  with special as (
    select c.opens_at, c.closes_at, c.last_order_at from public.stall_special_closures c
    where c.stall_id = p_stall_id and p_date between c.starts_on and c.ends_on
    order by c.starts_on, c.id limit 1
  ), selected as (
    select * from special
    union all
    select h.opens_at, h.closes_at, h.last_order_at from public.stall_business_hours h
    where h.stall_id = p_stall_id and h.day_of_week = extract(dow from p_date)::integer
      and not h.is_closed and not exists (select 1 from special)
  )
  select p_date + s.opens_at::time,
    p_date + s.closes_at::time + case when s.closes_at <= s.opens_at then interval '1 day' else interval '0' end,
    case when s.last_order_at is null then null
      else p_date + s.last_order_at::time + case when s.last_order_at < s.opens_at then interval '1 day' else interval '0' end end
  from selected s where s.opens_at is not null and s.closes_at is not null;
$$;
revoke all on function app_private.stall_ordering_window(uuid,date) from public, anon, authenticated;
grant execute on function app_private.stall_ordering_window(uuid,date) to service_role;

create or replace function public.qr_last_order_reached(p_stall_id uuid, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = '' as $$
  with local_clock as (
    select p_now at time zone s.timezone as local_now from public.stalls s where s.id = p_stall_id
  )
  select coalesce((
    select w.last_order_at is not null and c.local_now >= w.last_order_at
    from local_clock c cross join generate_series(-1,0) offset_day
    cross join lateral app_private.stall_ordering_window(p_stall_id, c.local_now::date + offset_day) w
    where c.local_now >= w.opens_at
    order by w.opens_at desc limit 1
  ), false);
$$;
revoke all on function public.qr_last_order_reached(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.qr_last_order_reached(uuid,timestamptz) to service_role;

create or replace function public.get_fulfillment_time_slots_raw(p_stall_id uuid, p_now timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_settings public.stall_ordering_settings%rowtype;
  v_stall public.stalls%rowtype;
  v_slots jsonb;
begin
  select * into v_settings from public.stall_ordering_settings where stall_id = p_stall_id;
  if not found then return '[]'::jsonb; end if;
  select * into v_stall from public.stalls where id = p_stall_id;
  if not found then return '[]'::jsonb; end if;
  with local_days as (
    select (p_now at time zone v_stall.timezone)::date + day_offset as local_date
    from generate_series(-1, v_settings.preorder_max_days) day_offset
  ), business_windows as (
    select w.* from local_days d
    cross join lateral app_private.stall_ordering_window(p_stall_id, d.local_date) w
  ), candidate_slots as (
    select slot_local, slot_local at time zone v_stall.timezone as scheduled_at
    from business_windows w cross join lateral generate_series(
      w.opens_at + make_interval(mins => (5 - extract(minute from w.opens_at)::integer % 5) % 5),
      w.closes_at - make_interval(mins => v_settings.preorder_slot_minutes),
      make_interval(mins => v_settings.preorder_slot_minutes)
    ) slot_local
  ), valid_slots as (
    select distinct scheduled_at from candidate_slots
    where scheduled_at >= p_now + make_interval(mins => v_settings.preorder_min_lead_minutes)
      and slot_local::date <= (p_now at time zone v_stall.timezone)::date + v_settings.preorder_max_days
      -- A closed/special date must also constrain the previous day's overnight tail.
      and not exists (
        select 1 from public.stall_special_closures c where c.stall_id = p_stall_id
          and slot_local::date between c.starts_on and c.ends_on
          and (c.opens_at is null or slot_local::time < c.opens_at::time or slot_local::time >= c.closes_at::time)
      )
    order by scheduled_at limit 8928
  ) select coalesce(jsonb_agg(scheduled_at order by scheduled_at), '[]'::jsonb) into v_slots from valid_slots;
  return v_slots;
end;
$$;
revoke all on function public.get_fulfillment_time_slots_raw(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.get_fulfillment_time_slots_raw(uuid,timestamptz) to service_role;

-- Preserve the canonical auth/idempotency/tenant policy verbatim. Extend its
-- existing schedule denial point rather than wrapping or bypassing those gates.
do $migration$
declare
  v_oid regprocedure := 'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text;
  v_anchor text := '  v_schedule_code := public.validate_ordering_schedule_context(v_qr.id, v_ordering_mode);';
begin
  v_source := pg_get_functiondef(v_oid);
  if strpos(v_source, v_anchor) = 0 then raise exception 'CANONICAL_PREFLIGHT_CUTOFF_ANCHOR_MISSING'; end if;
  execute replace(v_source, v_anchor, v_anchor || E'\n'
    || '  if v_schedule_code is null and v_ordering_mode = ''DEFAULT'' and public.qr_last_order_reached(v_qr.stall_id, now()) then' || E'\n'
    || '    v_schedule_code := ''QR_LAST_ORDER_PASSED'';' || E'\n'
    || '  end if;');
end;
$migration$;
-- Special opening hours override the weekly window on both API circuits.
do $migration$
declare
  v_oid regprocedure := 'public.public_order_preflight_with_special_closure(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text;
  v_anchor text := '      and v_target_date between closure.starts_on and closure.ends_on';
begin
  v_source := pg_get_functiondef(v_oid);
  if strpos(v_source, v_anchor) = 0 then raise exception 'SPECIAL_HOURS_PREFLIGHT_ANCHOR_MISSING'; end if;
  execute replace(v_source, v_anchor, v_anchor || E'\n'
    || '      and (closure.opens_at is null' || E'\n'
    || '        or (coalesce(p_requested_fulfillment_at, now()) at time zone coalesce(v_timezone, ''Asia/Taipei''))::time < closure.opens_at::time' || E'\n'
    || '        or (coalesce(p_requested_fulfillment_at, now()) at time zone coalesce(v_timezone, ''Asia/Taipei''))::time >= closure.closes_at::time)');
end;
$migration$;
