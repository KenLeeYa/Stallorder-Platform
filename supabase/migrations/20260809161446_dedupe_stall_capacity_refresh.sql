create or replace function public.refresh_stall_capacity(
  p_stall_id uuid,
  p_apply_automation boolean default true,
  p_reason text default 'SYSTEM_RECALCULATION'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.stall_capacity_settings%rowtype;
  v_stall public.stalls%rowtype;
  v_snapshot jsonb;
  v_utilization numeric;
  v_quote integer;
  v_window_start timestamptz;
  v_action text;
begin
  perform 1 from public.stalls where id = p_stall_id for update;
  select * into v_settings from public.stall_capacity_settings where stall_id = p_stall_id;
  select * into v_stall from public.stalls where id = p_stall_id;
  v_snapshot := public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);
  if v_settings.id is null or not v_settings.is_active then return v_snapshot; end if;

  v_utilization := coalesce((v_snapshot->>'utilization_percent')::numeric, 0);
  v_quote := coalesce((v_snapshot->>'quote_max_minutes')::integer, 0);
  v_window_start := coalesce((v_snapshot->>'window_start')::timestamptz, now());

  update public.stall_capacity_settings
  set last_calculated_at = now()
  where stall_id = p_stall_id;

  if v_utilization >= v_settings.warning_utilization_percent
     and not exists (
       select 1 from public.capacity_events event
       where event.stall_id = p_stall_id
         and event.event_type = 'CAPACITY_WARNING'
         and event.created_at >= v_window_start
     ) then
    insert into public.capacity_events (
      organization_id, stall_id, event_type, window_start, window_end,
      order_count, item_count, weighted_load, estimated_wait_minutes, reason
    ) values (
      v_stall.organization_id, p_stall_id, 'CAPACITY_WARNING', v_window_start, now(),
      coalesce((v_snapshot->>'order_count')::integer, 0),
      coalesce((v_snapshot->>'item_count')::integer, 0),
      coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
      left(coalesce(nullif(btrim(p_reason), ''), 'CAPACITY_THRESHOLD_REACHED'), 300)
    );
    insert into public.operational_alerts (
      organization_id, stall_id, alert_type, severity, message
    ) values (
      v_stall.organization_id, p_stall_id, 'CAPACITY_WARNING', 'WARNING',
      '目前產能使用率已達 ' || round(v_utilization)::text || '%。'
    ) on conflict (stall_id, alert_type)
      where status in ('ACTIVE', 'ACKNOWLEDGED')
      do update set severity = excluded.severity, message = excluded.message,
        status = 'ACTIVE', detected_at = now(), acknowledged_at = null,
        resolved_at = null, updated_at = now();
  end if;

  if p_apply_automation
     and v_settings.auto_pause_enabled
     and v_utilization >= v_settings.pause_utilization_percent
     and v_settings.pause_source <> 'MANUAL'
     and v_stall.business_status = 'OPEN'::public.stall_business_status then
    update public.stall_capacity_settings
    set pause_source = 'AUTO', last_calculated_at = now()
    where stall_id = p_stall_id and pause_source <> 'AUTO';
    if found then
      update public.stalls set ordering_state = 'PAUSED'::public.stall_ordering_state
      where id = p_stall_id;
      update public.qr_codes set state = 'PAUSED'::public.qr_code_state
      where stall_id = p_stall_id and state = 'ACTIVE'::public.qr_code_state;
      update public.order_sessions
      set status = 'REVOKED'::public.order_session_status, revoked_at = now()
      where stall_id = p_stall_id and status = 'ACTIVE'::public.order_session_status;
      insert into public.capacity_events (
        organization_id, stall_id, event_type, window_start, window_end,
        order_count, item_count, weighted_load, estimated_wait_minutes, reason
      ) values (
        v_stall.organization_id, p_stall_id, 'AUTO_PAUSED', v_window_start, now(),
        coalesce((v_snapshot->>'order_count')::integer, 0),
        coalesce((v_snapshot->>'item_count')::integer, 0),
        coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
        left(coalesce(nullif(btrim(p_reason), ''), 'AUTO_PAUSE_THRESHOLD_REACHED'), 300)
      );
      insert into public.operational_alerts (
        organization_id, stall_id, alert_type, severity, message
      ) values (
        v_stall.organization_id, p_stall_id, 'CAPACITY_AUTO_PAUSED', 'CRITICAL',
        '產能已達上限，公開 QR 點餐已自動暫停。'
      ) on conflict (stall_id, alert_type)
        where status in ('ACTIVE', 'ACKNOWLEDGED')
        do update set status = 'ACTIVE', detected_at = now(), resolved_at = null,
          updated_at = now();
      v_action := 'CAPACITY_AUTO_PAUSED';
    end if;
  elsif p_apply_automation
     and v_settings.auto_resume_enabled
     and v_settings.pause_source = 'AUTO'
     and v_utilization < v_settings.warning_utilization_percent then
    update public.stall_capacity_settings
    set pause_source = 'NONE', last_calculated_at = now()
    where stall_id = p_stall_id and pause_source = 'AUTO';
    if found then
      update public.stalls set ordering_state = 'OPEN'::public.stall_ordering_state
      where id = p_stall_id;
      update public.qr_codes set state = 'ACTIVE'::public.qr_code_state
      where stall_id = p_stall_id
        and state = 'PAUSED'::public.qr_code_state
        and (expires_at is null or expires_at > now());
      insert into public.capacity_events (
        organization_id, stall_id, event_type, window_start, window_end,
        order_count, item_count, weighted_load, estimated_wait_minutes, reason
      ) values (
        v_stall.organization_id, p_stall_id, 'AUTO_RESUMED', v_window_start, now(),
        coalesce((v_snapshot->>'order_count')::integer, 0),
        coalesce((v_snapshot->>'item_count')::integer, 0),
        coalesce((v_snapshot->>'weighted_load')::numeric, 0), v_quote,
        left(coalesce(nullif(btrim(p_reason), ''), 'CAPACITY_RECOVERED'), 300)
      );
      update public.operational_alerts
      set status = 'RESOLVED', resolved_at = now(), updated_at = now()
      where stall_id = p_stall_id
        and alert_type in ('CAPACITY_WARNING', 'CAPACITY_AUTO_PAUSED')
        and status in ('ACTIVE', 'ACKNOWLEDGED');
      v_action := 'CAPACITY_AUTO_RESUMED';
    end if;
  end if;

  if v_action is not null then
    insert into public.audit_logs (
      id, organization_id, stall_id, actor_profile_id, action, entity_type,
      entity_id, outcome, request_id, metadata
    ) values (
      gen_random_uuid(), v_stall.organization_id, p_stall_id, null, v_action, 'STALL', p_stall_id,
      'SUCCESS'::public.audit_outcome, 'capacity:' || gen_random_uuid()::text,
      jsonb_build_object(
        'utilizationPercent', round(v_utilization, 2),
        'estimatedWaitMinutes', v_quote,
        'reason', left(coalesce(p_reason, ''), 100)
      )::text
    );
  end if;

  if v_action is null then
    return v_snapshot;
  end if;

  return public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);
end;
$$;

revoke all on function public.refresh_stall_capacity(uuid, boolean, text)
from public, anon, authenticated;

grant execute on function public.refresh_stall_capacity(uuid, boolean, text)
to service_role;
