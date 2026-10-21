-- Preserve the original public intake and all its stock/session/tenant gates.
-- Its legacy catch-all must not hide a serialization rollback
-- error from the caller, which can then retry the same immutable order identity.
do $migration$
declare
  v_oid regprocedure := 'public.create_public_order_legacy(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure;
  v_source text;
  v_anchor text := '  when others then';
  v_replacement text := E'  when serialization_failure then\n    raise;\n  when others then';
begin
  v_source := pg_get_functiondef(v_oid);
  if strpos(v_source, v_anchor) = 0 or strpos(v_source, 'when serialization_failure then') > 0 then
    raise exception 'PUBLIC_INTAKE_ERROR_CLASSIFICATION_ANCHOR_MISSING';
  end if;
  execute replace(v_source, v_anchor, v_replacement);
end;
$migration$;
