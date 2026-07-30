create or replace function public.issue_idempotent_order_session_with_schedule(
  p_qr_token text,
  p_session_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text,
  p_ordering_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.order_sessions%rowtype;
  v_qr public.qr_codes%rowtype;
  v_capacity jsonb;
  v_result jsonb;
  v_code text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_session_token_hash, 0)
  );

  select *
  into v_session
  from public.order_sessions
  where token_hash = p_session_token_hash
  for update;

  if found then
    select * into v_qr
    from public.qr_codes
    where id = v_session.qr_code_id;

    if not found
       or v_qr.token <> p_qr_token
       or v_session.device_hash <> p_device_hash then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'ERROR', 'SESSION_TOKEN_COLLISION',
        v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', 'SESSION_TOKEN_COLLISION');
    end if;

    if v_session.status = 'CONSUMED'::public.order_session_status then
      v_code := 'SESSION_REPLAYED';
    elsif v_session.status <> 'ACTIVE'::public.order_session_status then
      v_code := 'SESSION_NOT_FOUND';
    elsif v_session.expires_at <= now() then
      v_code := 'SESSION_EXPIRED';
    elsif v_session.ordering_mode <> p_ordering_mode then
      v_code := 'ORDER_MODE_CONFLICT';
    else
      perform app_private.process_stall_schedules(now());
      if v_qr.location_id is distinct from v_session.location_id
         or v_qr.market_event_id is distinct from v_session.market_event_id
         or v_qr.stall_schedule_id is distinct from v_session.stall_schedule_id
         or v_qr.fulfillment_type_context is distinct from v_session.fulfillment_type_context then
        v_code := 'SCHEDULE_CONTEXT_MISMATCH';
      else
        v_code := public.validate_ordering_schedule_context(v_qr.id, p_ordering_mode);
      end if;
    end if;

    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
        v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
        p_session_token_hash, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;

    v_capacity := public.calculate_stall_capacity(v_session.stall_id, '[]'::jsonb);
    perform public.record_public_order_attempt(
      p_request_id, 'SESSION_ISSUE', 'ALLOWED', 'SESSION_IDEMPOTENT_REPLAY',
      v_session.organization_id, v_session.stall_id, v_session.qr_code_id,
      v_session.id, p_ip_hash, p_device_hash, p_qr_token_hash,
      p_session_token_hash, p_behavior_hash, null
    );
    return jsonb_build_object(
      'ok', true,
      'organization_id', v_session.organization_id,
      'stall_id', v_session.stall_id,
      'qr_code_id', v_session.qr_code_id,
      'order_session_id', v_session.id,
      'expires_at', v_session.expires_at,
      'capacity', v_capacity,
      'idempotent_replay', true
    );
  end if;

  v_result := public.issue_order_session_with_schedule(
    p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
    p_qr_token_hash, p_behavior_hash, p_request_id, p_ordering_mode
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    update public.order_sessions
    set ordering_mode = p_ordering_mode
    where id = (v_result->>'order_session_id')::uuid
      and token_hash = p_session_token_hash
      and status = 'ACTIVE'::public.order_session_status;
    v_result := v_result || jsonb_build_object('idempotent_replay', false);
  end if;

  return v_result;
end;
$$;

revoke all on function public.issue_idempotent_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.issue_idempotent_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) to service_role;

comment on function public.issue_idempotent_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) is
  'Issues one short-lived order session for a deterministic cross-circuit token hash and safely replays the same active session.';
