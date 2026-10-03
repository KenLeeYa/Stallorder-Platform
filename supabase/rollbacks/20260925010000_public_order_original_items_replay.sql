-- Targeted DOWN: restore the two prior RPC bodies, preserving all other changes
-- and all original digest data. Keep the nullable column, format constraint and
-- immutable helper/trigger: old application code ignores them safely.
-- Capture pg_get_functiondef for these two functions BEFORE rollback so the
-- exact reviewed patched definitions can be restored without replaying ADD COLUMN.
-- Do not automatically execute this against Production.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $rollback$
declare
  v_oid regprocedure := 'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure;
  v_source text;
  v_anchor text := $anchor$      or (v_idempotent_order->>'lottery_draw_id')::uuid is distinct from p_lottery_draw_id
      -- ORIGINAL_ITEMS_PREFLIGHT_V1_BEGIN
      or (v_session.original_items_digest is not null
          and v_session.original_items_digest is distinct from app_private.public_order_items_digest_v1(p_items))
      -- ORIGINAL_ITEMS_PREFLIGHT_V1_END
    then$anchor$;
begin
  v_source := replace(pg_get_functiondef(v_oid), chr(13), '');
  if (length(v_source) - length(replace(v_source, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'ORIGINAL_ITEMS_ROLLBACK_PREFLIGHT_ANCHOR_MISSING_OR_AMBIGUOUS';
  end if;
  execute replace(v_source, v_anchor, '      or (v_idempotent_order->>''lottery_draw_id'')::uuid is distinct from p_lottery_draw_id then');
end;
$rollback$;
do $rollback$
declare
  v_oid regprocedure := 'public.create_public_order_with_daily_pickup_code_targeted(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamptz,uuid)'::regprocedure;
  v_source text;
  v_marker text;
  v_begin text;
  v_end text;
  v_start integer;
  v_finish integer;
begin
  v_source := replace(pg_get_functiondef(v_oid), chr(13), '');
  foreach v_marker in array array['DECLARE', 'LOCK', 'BIND'] loop
    v_begin := '  -- ORIGINAL_ITEMS_' || v_marker || E'_V1_BEGIN\n';
    v_end := '  -- ORIGINAL_ITEMS_' || v_marker || E'_V1_END\n';
    if (length(v_source) - length(replace(v_source, v_begin, ''))) / length(v_begin) <> 1
       or (length(v_source) - length(replace(v_source, v_end, ''))) / length(v_end) <> 1 then
      raise exception 'ORIGINAL_ITEMS_ROLLBACK_CREATE_ANCHOR_MISSING_OR_AMBIGUOUS: %', v_marker;
    end if;
    v_start := strpos(v_source, v_begin);
    v_finish := strpos(v_source, v_end) + length(v_end);
    if v_finish <= v_start then raise exception 'ORIGINAL_ITEMS_ROLLBACK_MARKER_ORDER: %', v_marker; end if;
    v_source := substr(v_source, 1, v_start - 1) || substr(v_source, v_finish);
  end loop;
  execute v_source;
end;
$rollback$;
commit;
