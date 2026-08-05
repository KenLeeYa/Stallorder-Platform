create or replace function public.issue_order_session_with_schedule(
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
  v_qr public.qr_codes%rowtype;
  v_result jsonb;
  v_code text;
  v_session_id uuid;
  v_qr_found boolean := false;
begin
  perform app_private.process_stall_schedules(now());

  -- Capacity refreshes lock the stall before they can update its QR state.
  -- Use the same order here so concurrent sessions never hold QR share locks
  -- while waiting to upgrade behind the stall lock.
  perform stall.id
  from public.qr_codes qr
  join public.stalls stall on stall.id = qr.stall_id
  where qr.token = p_qr_token
  for update of stall;

  select * into v_qr from public.qr_codes where token = p_qr_token for share;
  v_qr_found := found;
  if found then
    v_code := public.validate_ordering_schedule_context(v_qr.id, p_ordering_mode);
    if v_code is not null then
      perform public.record_public_order_attempt(
        p_request_id, 'SESSION_ISSUE', 'DENIED', v_code,
        v_qr.tenant_id, v_qr.stall_id, v_qr.id, null, p_ip_hash,
        p_device_hash, p_qr_token_hash, null, p_behavior_hash, null
      );
      return jsonb_build_object('ok', false, 'code', v_code);
    end if;
  end if;

  if p_ordering_mode = 'PREORDER' then
    v_result := public.issue_preorder_order_session(
      p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
      p_qr_token_hash, p_behavior_hash, p_request_id
    );
  else
    v_result := public.issue_order_session_with_capacity(
      p_qr_token, p_session_token_hash, p_ip_hash, p_device_hash,
      p_qr_token_hash, p_behavior_hash, p_request_id
    );
  end if;

  if coalesce((v_result->>'ok')::boolean, false) and v_qr_found then
    v_session_id := (v_result->>'order_session_id')::uuid;
    update public.order_sessions
    set location_id = v_qr.location_id,
        market_event_id = v_qr.market_event_id,
        stall_schedule_id = v_qr.stall_schedule_id,
        fulfillment_type_context = v_qr.fulfillment_type_context,
        ordering_mode = p_ordering_mode
    where id = v_session_id
      and qr_code_id = v_qr.id
      and status = 'ACTIVE'::public.order_session_status;
  end if;
  return v_result;
end;
$$;

revoke all on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.issue_order_session_with_schedule(
  text, text, text, text, text, text, text, text
) to service_role;
