-- Successful token/device-bound polling has its own budget. Unknown bindings
-- retain the existing global abuse gate; this gate never authorizes order data.
create or replace function public.check_public_order_tracking_gate(
  p_tracking_token_hash text,
  p_ip_hash text,
  p_device_hash text,
  p_behavior_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_gate jsonb;
  v_retry_after integer;
begin
  if not exists (
    select 1 from public.orders
    where tracking_token_hash = p_tracking_token_hash
      and device_hash = p_device_hash
  ) then
    v_gate := public.check_global_public_request_gate(
      'TRACKING', p_ip_hash, p_device_hash, p_behavior_hash, p_request_id
    );
    if not coalesce((v_gate->>'ok')::boolean, false) then
      return v_gate || jsonb_build_object('retryAfterSeconds', 300);
    end if;
    return v_gate;
  end if;

  -- One canonical order/device binding: three-second polling uses 20/minute.
  -- The 60/minute bound includes tabs, manual refreshes and either intake circuit.
  v_key := encode(extensions.digest(
    'PUBLIC|TRACKING_AUTHENTICATED|' || p_tracking_token_hash || '|' || p_device_hash,
    'sha256'
  ), 'hex');
  if public.consume_global_rate_limit(v_key, 60, 60) then
    return jsonb_build_object('ok', true);
  end if;

  select greatest(1, least(60, ceil(extract(epoch from (expires_at - clock_timestamp())))::integer))
    into v_retry_after
    from public.rate_limit_buckets where key = v_key;
  perform public.record_public_order_attempt(
    p_request_id, 'TRACKING_AUTHENTICATED_GATE', 'DENIED', 'RATE_LIMITED',
    null, null, null, null, p_ip_hash, p_device_hash, null, null, p_behavior_hash, null
  );
  return jsonb_build_object(
    'ok', false, 'code', 'RATE_LIMITED', 'retryAfterSeconds', coalesce(v_retry_after, 60)
  );
end;
$$;

revoke all on function public.check_public_order_tracking_gate(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.check_public_order_tracking_gate(text,text,text,text,text) to service_role;
