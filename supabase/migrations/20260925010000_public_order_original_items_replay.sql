-- Bind the original, unexpanded public cart to its consumed session. Existing
-- sessions stay NULL: mutable order items cannot reconstruct their original cart.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.order_sessions add column original_items_digest text;
alter table public.order_sessions add constraint order_sessions_original_items_digest_format
  check (original_items_digest is null or original_items_digest ~ '^v1:[0-9a-f]{64}$');

create function app_private.public_order_items_digest_v1(p_items jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_canonical jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then return null; end if;
  select coalesce(jsonb_agg(line order by line::text collate "C"), '[]'::jsonb)
  into v_canonical
  from (
    select jsonb_build_object(
      'product_id', (item->>'product_id')::uuid,
      'quantity', (item->>'quantity')::integer,
      'note', btrim(coalesce(item->>'note', '')),
      'modifier_option_ids', (
        select coalesce(jsonb_agg(option.value::uuid order by option.value::uuid), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) option(value)
      ),
      'bundle_choice_ids', (
        select coalesce(jsonb_agg(choice.value::uuid order by choice.value::uuid), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(item->'bundle_choice_ids', '[]'::jsonb)) choice(value)
      )
    ) as line
    from jsonb_array_elements(p_items) item
  ) canonical_lines;
  return 'v1:' || encode(extensions.digest(v_canonical::text, 'sha256'), 'hex');
exception
  -- Validation remains with the existing RPCs. A malformed replay cannot match
  -- a digest saved from a valid cart and must not turn a 409 into a SQL error.
  when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    return null;
end;
$$;
revoke all on function app_private.public_order_items_digest_v1(jsonb)
  from public, anon, authenticated, service_role;

create function app_private.keep_public_order_items_digest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.original_items_digest is not null
     and new.original_items_digest is distinct from old.original_items_digest then
    raise exception 'ORIGINAL_ITEMS_DIGEST_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.keep_public_order_items_digest()
  from public, anon, authenticated, service_role;
create trigger order_sessions_original_items_digest_immutable
  before update of original_items_digest on public.order_sessions
  for each row execute function app_private.keep_public_order_items_digest();

-- This write runs only when the order RPC is called, never during migration.
create function app_private.bind_original_public_order_items(p_session_id uuid, p_order_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_digest text := app_private.public_order_items_digest_v1(p_items);
begin
  if v_digest is null then
    raise exception 'ORIGINAL_ITEMS_DIGEST_INVALID' using errcode = '23514';
  end if;
  update public.order_sessions
  set original_items_digest = v_digest
  where id = p_session_id and order_id = p_order_id and original_items_digest is null;
  if not found then
    raise exception 'ORIGINAL_ITEMS_DIGEST_BIND_FAILED' using errcode = '23514';
  end if;
end;
$$;
revoke all on function app_private.bind_original_public_order_items(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Preserve the canonical preflight and its existing denied-attempt audit. This
-- edits only its established idempotency conflict predicate, including tenant
-- compatibility aliases in whichever installed definition is current.
do $migration$
declare
  v_oid regprocedure := 'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text;
  v_anchor text := '      or (v_idempotent_order->>''lottery_draw_id'')::uuid is distinct from p_lottery_draw_id then';
begin
  v_source := replace(pg_get_functiondef(v_oid), chr(13), '');
  if (length(v_source) - length(replace(v_source, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'ORIGINAL_ITEMS_PREFLIGHT_ANCHOR_MISSING_OR_AMBIGUOUS';
  end if;
  execute replace(v_source, v_anchor, $replacement$      or (v_idempotent_order->>'lottery_draw_id')::uuid is distinct from p_lottery_draw_id
      -- ORIGINAL_ITEMS_PREFLIGHT_V1_BEGIN
      or (v_session.original_items_digest is not null
          and v_session.original_items_digest is distinct from app_private.public_order_items_digest_v1(p_items))
      -- ORIGINAL_ITEMS_PREFLIGHT_V1_END
    then$replacement$);
end;
$migration$;

-- The outer daily-pickup RPC sees the customer's original cart before bundle,
-- modifier and lottery expansion. Take the established STALL -> SESSION locks
-- before reading the binding so two requests that both passed preflight cannot
-- race past this check. Keep the existing inner creation/validation call intact.
do $migration$
declare
  v_oid regprocedure := 'public.create_public_order_with_daily_pickup_code_targeted(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamptz,uuid)'::regprocedure;
  v_source text;
  v_declare text := E'  v_pickup_code text;\nbegin';
  v_call text := '  v_result := public.create_public_order_with_free_lottery_reward_targeted(';
  v_bind text := '  v_order_id := (v_result #>> ''{order,order_id}'')::uuid;';
begin
  v_source := replace(pg_get_functiondef(v_oid), chr(13), '');
  if (length(v_source) - length(replace(v_source, v_declare, ''))) / length(v_declare) <> 1
     or (length(v_source) - length(replace(v_source, v_call, ''))) / length(v_call) <> 1
     or (length(v_source) - length(replace(v_source, v_bind, ''))) / length(v_bind) <> 1 then
    raise exception 'ORIGINAL_ITEMS_CREATE_ANCHOR_MISSING_OR_AMBIGUOUS';
  end if;
  v_source := replace(v_source, v_declare, $replacement$  v_pickup_code text;
  -- ORIGINAL_ITEMS_DECLARE_V1_BEGIN
  v_original_session record;
  -- ORIGINAL_ITEMS_DECLARE_V1_END
begin$replacement$);
  v_source := replace(v_source, v_call, $replacement$  -- ORIGINAL_ITEMS_LOCK_V1_BEGIN
  perform stall.id
  from public.order_sessions session_record
  join public.stalls stall on stall.id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash
  for update of stall;

  select session_record.id, session_record.organization_id, session_record.stall_id,
         session_record.qr_code_id, session_record.device_hash, session_record.order_id,
         session_record.original_items_digest
  into v_original_session
  from public.order_sessions session_record
  where session_record.token_hash = p_session_token_hash
  for update;

  if v_original_session.original_items_digest is not null
     and v_original_session.device_hash = p_device_hash
     and exists (select 1 from public.qr_codes qr
                 where qr.id = v_original_session.qr_code_id and qr.token = p_qr_token)
     and exists (select 1 from public.orders order_record
                 where order_record.id = v_original_session.order_id
                   and order_record.idempotency_key = p_idempotency_key)
     and v_original_session.original_items_digest is distinct from app_private.public_order_items_digest_v1(p_items) then
    perform public.record_public_order_attempt(
      p_request_id, 'ORDER_SUBMIT', 'DENIED', 'IDEMPOTENCY_CONFLICT',
      v_original_session.organization_id, v_original_session.stall_id,
      v_original_session.qr_code_id, v_original_session.id,
      p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash,
      p_behavior_hash, p_idempotency_hash
    );
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;
  -- ORIGINAL_ITEMS_LOCK_V1_END
  v_result := public.create_public_order_with_free_lottery_reward_targeted($replacement$);
  v_source := replace(v_source, v_bind, v_bind || E'\n' || $replacement$  -- ORIGINAL_ITEMS_BIND_V1_BEGIN
  if v_original_session.id is not null and v_original_session.order_id is null
     and not coalesce((v_result->>'idempotent_replay')::boolean, false) then
    perform app_private.bind_original_public_order_items(v_original_session.id, v_order_id, p_items);
  end if;
  -- ORIGINAL_ITEMS_BIND_V1_END$replacement$);
  execute v_source;
end;
$migration$;

comment on column public.order_sessions.original_items_digest is
  'Immutable v1 SHA-256 of original successful public cart, before expansion/amendment. NULL means legacy/unbound; never backfill from a replay.';
commit;
