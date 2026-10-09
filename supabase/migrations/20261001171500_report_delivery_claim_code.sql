begin;
do $$
begin
  if not exists (select 1 from pg_proc p where p.oid='app_private.claim_report_deliveries(integer,uuid)'::regprocedure
    and not p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
    and p.proconfig=ARRAY['search_path=""']::text[]
    and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
    and encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')='ebeb01c629e176e4ed11ec32b8e4cfd83bdc14e8f129003b611cb05232580205')
  then raise exception 'REPORT_PRIOR_CLAIM_DEFINITION_MISMATCH'; end if;
end;
$$;
CREATE OR REPLACE FUNCTION app_private.claim_report_deliveries(p_limit integer DEFAULT 20, p_delivery_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF public.report_deliveries
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_org uuid; v_id uuid; v_count integer := 0; v_constraint text; v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then raise exception 'REPORT_BATCH_LIMIT_INVALID'; end if;
  for v_org in
    select o.id from public.organizations o
    where exists(select 1 from public.report_deliveries d where d.organization_id=o.id
      and d.status='PROCESSING' and d.intent_json is not null and d.effect_state in ('NOT_STARTED','REJECTED')
      and d.lease_token is null and d.attempt_count<5 and d.next_attempt_at<=v_now
      and (p_delivery_id is null or d.id=p_delivery_id))
    and not exists(select 1 from public.report_deliveries a where a.organization_id=o.id and a.status='PROCESSING' and a.lease_token is not null)
    order by (select min(d.created_at) from public.report_deliveries d where d.organization_id=o.id and d.status='PROCESSING'),o.id
    limit p_limit
    for update of o skip locked
  loop
    exit when v_count >= p_limit;
    if exists(select 1 from public.report_deliveries d where d.organization_id=v_org and d.status='PROCESSING' and d.lease_token is not null) then continue; end if;
    v_id := null;
    select d.id into v_id from public.report_deliveries d
    where d.organization_id=v_org and d.status='PROCESSING' and d.intent_json is not null
      and d.effect_state in ('NOT_STARTED','REJECTED') and d.lease_token is null
      and d.attempt_count<5 and d.next_attempt_at<=v_now and (p_delivery_id is null or d.id=p_delivery_id)
    order by d.created_at,d.id limit 1 for update skip locked;
    if v_id is null then continue; end if;
    return query update public.report_deliveries set
      lease_token=gen_random_uuid(),lease_expires_at=v_now+interval '90 seconds',next_attempt_at=null,
      effect_state='NOT_STARTED',attempt_count=attempt_count+1,execution_version=execution_version+1,
      started_at=v_now,updated_at=v_now
    where id=v_id returning *;
    v_count:=v_count+1;
  end loop;
exception when unique_violation then
  get stacked diagnostics v_constraint = CONSTRAINT_NAME;
  if v_constraint = 'report_execution_one_org' then
    raise exception using errcode = 'P4B01', message = 'REPORT_ONE_ORG_CONFLICT';
  end if;
  raise;
end;
$function$;
commit;
