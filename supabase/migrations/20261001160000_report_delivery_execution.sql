begin;

alter table public.report_deliveries
  add column execution_version integer not null default 1,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz,
  add column effect_state text,
  add column intent_json jsonb,
  add column snapshot_json jsonb,
  add column snapshot_hash text,
  add column first_request_at timestamptz,
  add column idempotency_valid_until timestamptz,
  add column origin_request_id uuid,
  add column reconciled_at timestamptz,
  add column reconciled_by uuid references public.profiles(id) on delete restrict,
  add column reconciliation_evidence jsonb,
  add constraint report_execution_version_positive check (execution_version > 0),
  add constraint report_execution_lease_pair check ((lease_token is null) = (lease_expires_at is null)),
  add constraint report_execution_effect check (effect_state in ('NOT_STARTED','IN_FLIGHT','UNKNOWN','ACCEPTED','REJECTED','SUPPRESSED')),
  add constraint report_execution_snapshot_pair check (coalesce((
    (snapshot_json is null and snapshot_hash is null) or
    (jsonb_typeof(snapshot_json) = 'object' and snapshot_hash ~ '^[0-9a-f]{64}$' and payload is not null)
  ),false)),
  add constraint report_execution_contract check (intent_json is null or coalesce((
    jsonb_typeof(intent_json) = 'object' and intent_json->>'version' = '1'
    and jsonb_typeof(intent_json->'stallIds') = 'array' and jsonb_array_length(intent_json->'stallIds') > 0
    and intent_json->>'binding' is not null and origin_request_id is not null
    and attempt_count between 0 and 5 and effect_state is not null
    and ((status = 'PROCESSING' and effect_state in ('NOT_STARTED','REJECTED','IN_FLIGHT'))
      or (status = 'FAILURE' and effect_state in ('UNKNOWN','REJECTED','SUPPRESSED'))
      or (status in ('SENT','SIMULATED') and effect_state = 'ACCEPTED'))
    and (lease_token is null or status = 'PROCESSING')
    and (effect_state <> 'IN_FLIGHT' or (lease_token is not null and snapshot_json is not null and first_request_at is not null))
    and (status = 'PROCESSING' or next_attempt_at is null)
    and (effect_state not in ('IN_FLIGHT','ACCEPTED') or snapshot_json is not null)
    and (status not in ('SENT','SIMULATED') or sent_at is not null)
  ),false));

create index report_execution_ready on public.report_deliveries(next_attempt_at,created_at)
  where status = 'PROCESSING' and lease_token is null and intent_json is not null;
create index report_execution_expiry on public.report_deliveries(lease_expires_at)
  where status = 'PROCESSING' and lease_token is not null;
create unique index report_execution_one_org on public.report_deliveries(organization_id)
  where status = 'PROCESSING' and lease_token is not null;

create function app_private.guard_report_execution()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.intent_json is not null and
      row(new.id,new.organization_id,new.report_schedule_id,new.report_type,new.scheduled_for,new.period_start,new.period_end,new.recipients,new.subject,new.intent_json,new.origin_request_id)
      is distinct from row(old.id,old.organization_id,old.report_schedule_id,old.report_type,old.scheduled_for,old.period_start,old.period_end,old.recipients,old.subject,old.intent_json,old.origin_request_id)
    then raise exception 'REPORT_INTENT_IMMUTABLE'; end if;
    if old.snapshot_json is not null and
      row(new.snapshot_json,new.snapshot_hash,new.payload) is distinct from row(old.snapshot_json,old.snapshot_hash,old.payload)
    then raise exception 'REPORT_SNAPSHOT_IMMUTABLE'; end if;
    if old.intent_json is not null and (new.attempt_count < old.attempt_count or new.execution_version < old.execution_version)
    then raise exception 'REPORT_EXECUTION_MONOTONIC'; end if;
    if old.first_request_at is not null and new.first_request_at is distinct from old.first_request_at
    then raise exception 'REPORT_FIRST_REQUEST_IMMUTABLE'; end if;
    if old.idempotency_valid_until is not null and new.idempotency_valid_until is distinct from old.idempotency_valid_until
    then raise exception 'REPORT_REPLAY_WINDOW_IMMUTABLE'; end if;
    if old.intent_json is null and new.intent_json is not null then raise exception 'REPORT_LEGACY_INTENT_UNPROVEN'; end if;
  end if;
  if new.snapshot_json is not null and (
    new.snapshot_hash is distinct from encode(extensions.digest(new.snapshot_json::text,'sha256'),'hex')
    or new.snapshot_json->'intent' is distinct from new.intent_json
    or new.snapshot_json->'payload' is distinct from new.payload
  ) then raise exception 'REPORT_SNAPSHOT_BINDING_INVALID'; end if;
  return new;
end;
$$;
revoke all on function app_private.guard_report_execution() from public,anon,authenticated;
create trigger report_execution_immutable before insert or update on public.report_deliveries
  for each row execute function app_private.guard_report_execution();

create function app_private.claim_report_deliveries(p_limit integer default 20, p_delivery_id uuid default null)
returns setof public.report_deliveries language plpgsql set search_path = '' as $$
declare v_org uuid; v_id uuid; v_count integer := 0; v_now timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_limit > 20 then raise exception 'REPORT_BATCH_LIMIT_INVALID'; end if;
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
end;
$$;

create function app_private.recover_report_deliveries()
returns integer language plpgsql set search_path = '' as $$
declare v_count integer; v_now timestamptz := clock_timestamp();
begin
  with expired as (
    select id from public.report_deliveries
    where (status='PROCESSING' and lease_expires_at<=v_now)
       or (status in ('PROCESSING','FAILURE') and intent_json is null and effect_state is null)
    order by created_at,id limit 20 for update skip locked
  )
  update public.report_deliveries d set
    status=case when d.intent_json is not null and d.effect_state='NOT_STARTED' and d.attempt_count<5 then 'PROCESSING'::public.report_delivery_status else 'FAILURE'::public.report_delivery_status end,
    effect_state=case when d.intent_json is null or d.effect_state='IN_FLIGHT' then 'UNKNOWN' when d.attempt_count>=5 then 'REJECTED' else 'NOT_STARTED' end,
    error_code=case when d.intent_json is null then 'LEGACY_UNPROVEN' when d.effect_state='IN_FLIGHT' then 'EFFECT_OUTCOME_UNKNOWN' when d.attempt_count>=5 then 'WORKER_ATTEMPTS_EXHAUSTED' else 'LEASE_EXPIRED_BEFORE_EFFECT' end,
    next_attempt_at=case when d.intent_json is not null and d.effect_state='NOT_STARTED' and d.attempt_count<5 then v_now else null end,
    lease_token=null,lease_expires_at=null,execution_version=d.execution_version+1,updated_at=v_now
  from expired where d.id=expired.id;
  get diagnostics v_count = row_count; return v_count;
end;
$$;

create function app_private.authorize_report_effect(p_id uuid,p_token uuid,p_version integer,p_hash text)
returns setof public.report_deliveries language sql set search_path = '' as $$
  update public.report_deliveries set effect_state='IN_FLIGHT',first_request_at=coalesce(first_request_at,clock_timestamp()),
    execution_version=execution_version+1,updated_at=clock_timestamp()
  where id=p_id and lease_token=p_token and execution_version=p_version and lease_expires_at>clock_timestamp()
    and status='PROCESSING' and effect_state='NOT_STARTED' and snapshot_json is not null and snapshot_hash=p_hash
    and snapshot_hash=encode(extensions.digest(snapshot_json::text,'sha256'),'hex')
  returning *;
$$;

revoke all on function app_private.claim_report_deliveries(integer,uuid) from public,anon,authenticated;
revoke all on function app_private.recover_report_deliveries() from public,anon,authenticated;
revoke all on function app_private.authorize_report_effect(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function app_private.claim_report_deliveries(integer,uuid) to service_role;
grant execute on function app_private.recover_report_deliveries() to service_role;
grant execute on function app_private.authorize_report_effect(uuid,uuid,integer,text) to service_role;

commit;
