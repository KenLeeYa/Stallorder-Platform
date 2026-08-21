-- Environments that applied the original 20260821193000 body already expose
-- the closure-aware preflight under public_order_preflight. Add the versioned
-- entrypoint without renaming or dropping either existing function, and add
-- the write fence that was absent from that original migration body.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger existing_trigger
    where existing_trigger.tgrelid = 'public.stall_special_closures'::regclass
      and existing_trigger.tgname = 'backend_writable_guard'
      and not existing_trigger.tgisinternal
  ) then
    create trigger backend_writable_guard
    before insert or update or delete on public.stall_special_closures
    for each statement execute function app_private.enforce_backend_writable();
  end if;
end;
$migration$;

create or replace function public.public_order_preflight_with_special_closure(
  p_scope text,
  p_qr_token text,
  p_ordering_mode text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_request_id text,
  p_session_token_hash text default null,
  p_idempotency_key uuid default null,
  p_idempotency_hash text default null,
  p_requested_fulfillment_at timestamptz default null,
  p_lottery_draw_id uuid default null,
  p_items jsonb default '[]'::jsonb,
  p_wait_acknowledged boolean default false,
  p_intake_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_stall_id uuid;
  v_timezone text;
  v_target_date date;
begin
  v_result := public.public_order_preflight(
    p_scope,
    p_qr_token,
    p_ordering_mode,
    p_device_hash,
    p_ip_hash,
    p_qr_token_hash,
    p_behavior_hash,
    p_request_id,
    p_session_token_hash,
    p_idempotency_key,
    p_idempotency_hash,
    p_requested_fulfillment_at,
    p_lottery_draw_id,
    p_items,
    p_wait_acknowledged,
    p_intake_code
  );

  if not coalesce((v_result->>'ok')::boolean, false)
     or v_result->'resumable_order' is not null
     or v_result->'idempotent_order' is not null
     or (upper(coalesce(trim(p_scope), '')) = 'SESSION'
       and upper(coalesce(trim(p_ordering_mode), '')) = 'PREORDER') then
    return v_result;
  end if;

  v_stall_id := nullif(v_result #>> '{qr_context,stall_id}', '')::uuid;
  select stall.timezone into v_timezone
  from public.stalls stall
  where stall.id = v_stall_id;
  v_target_date := (
    coalesce(p_requested_fulfillment_at, now())
    at time zone coalesce(v_timezone, 'Asia/Taipei')
  )::date;

  if exists (
    select 1
    from public.stall_special_closures closure
    where closure.stall_id = v_stall_id
      and v_target_date between closure.starts_on and closure.ends_on
  ) then
    perform public.record_public_order_attempt(
      p_request_id,
      case when upper(coalesce(trim(p_scope), '')) = 'SESSION'
        then 'SESSION_ISSUE'
        else 'ORDER_SUBMIT'
      end,
      'DENIED',
      'STALL_SPECIAL_CLOSURE',
      nullif(v_result #>> '{qr_context,tenant_id}', '')::uuid,
      v_stall_id,
      nullif(v_result #>> '{qr_context,qr_code_id}', '')::uuid,
      null,
      p_ip_hash,
      p_device_hash,
      p_qr_token_hash,
      p_session_token_hash,
      p_behavior_hash,
      p_idempotency_hash
    );
    return v_result || jsonb_build_object(
      'ok', false,
      'code', 'STALL_SPECIAL_CLOSURE'
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.public_order_preflight_with_special_closure(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) from public, anon, authenticated;
grant execute on function public.public_order_preflight_with_special_closure(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) to service_role;

comment on function public.public_order_preflight_with_special_closure(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) is
  'Canonical trusted public-order preflight with stall-local special-closure enforcement.';
