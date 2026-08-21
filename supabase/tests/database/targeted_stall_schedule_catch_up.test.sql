begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select ok(
  to_regprocedure(
    'app_private.process_stall_schedules_for_stall(uuid,timestamp with time zone)'
  ) is not null,
  'targeted stall schedule catch-up exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'app_private.process_stall_schedules_for_stall(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'app_private.process_stall_schedules_for_stall(uuid,timestamp with time zone)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'app_private.process_stall_schedules_for_stall(uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'only the trusted service role can execute targeted catch-up'
);

select is(
  pg_get_function_identity_arguments(
    'public.issue_idempotent_order_session_with_schedule_targeted(text,text,text,text,text,text,text,text)'::regprocedure
  ),
  'p_qr_token text, p_session_token_hash text, p_ip_hash text, p_device_hash text, p_qr_token_hash text, p_behavior_hash text, p_request_id text, p_ordering_mode text',
  'targeted session entry preserves the current trusted RPC parameter contract'
);

select is(
  pg_get_function_identity_arguments(
    'public.create_public_order_with_fulfillment_time_targeted(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamp with time zone,uuid)'::regprocedure
  ),
  'p_order_id uuid, p_qr_token text, p_session_token_hash text, p_device_hash text, p_ip_hash text, p_qr_token_hash text, p_behavior_hash text, p_idempotency_key uuid, p_idempotency_hash text, p_customer_name text, p_customer_phone text, p_delivery_address text, p_customer_note text, p_items jsonb, p_tracking_token_hash text, p_pickup_code_hash text, p_request_id text, p_wait_acknowledged boolean, p_requested_fulfillment_at timestamp with time zone, p_lottery_draw_id uuid',
  'targeted order entry preserves the current trusted RPC parameter contract'
);

select ok(
  to_regprocedure(
    'public.issue_idempotent_order_session_with_schedule(text,text,text,text,text,text,text,text)'
  ) is not null
  and to_regprocedure(
    'public.create_public_order_with_fulfillment_time(uuid,text,text,text,text,text,text,uuid,text,text,text,text,text,jsonb,text,text,text,boolean,timestamp with time zone,uuid)'
  ) is not null,
  'the existing public RPC signatures remain available and untouched'
);

update public.stall_schedules
set status = 'CANCELLED'::public.stall_schedule_status
where status in (
  'SCHEDULED'::public.stall_schedule_status,
  'OPEN'::public.stall_schedule_status,
  'DELAYED'::public.stall_schedule_status
);

insert into public.stalls (
  id, organization_id, name, slug, code, address, location,
  is_active, is_sold_out, business_status, ordering_enabled, ordering_state
) values
  (
    'a4100000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Targeted close stall', 'targeted-schedule-close-stall', 'TARGET-CLOSE',
    'Local database only', 'Local database only',
    true, false, 'OPEN', true, 'OPEN'
  ),
  (
    'a4100000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Targeted open stall', 'targeted-schedule-open-stall', 'TARGET-OPEN',
    'Local database only', 'Local database only',
    true, false, 'OPEN', true, 'CLOSED'
  );

update public.stall_capacity_settings
set pause_source = 'NONE', auto_pause_enabled = false, auto_resume_enabled = false
where stall_id in (
  'a4100000-0000-4000-8000-000000000001',
  'a4100000-0000-4000-8000-000000000002'
);

insert into public.stall_locations (
  id, organization_id, stall_id, name, address
) values
  (
    'a4200000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'a4100000-0000-4000-8000-000000000001',
    'Targeted close location', 'Local database only'
  ),
  (
    'a4200000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'a4100000-0000-4000-8000-000000000002',
    'Targeted open location', 'Local database only'
  );

insert into public.stall_schedules (
  id, organization_id, stall_id, location_id,
  starts_at, ends_at, ordering_opens_at, ordering_closes_at,
  status, auto_open_enabled, auto_close_enabled
) values
  (
    'a4300000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'a4100000-0000-4000-8000-000000000001',
    'a4200000-0000-4000-8000-000000000001',
    '2099-01-01 09:00:00+00', '2099-01-01 11:00:00+00',
    '2099-01-01 09:00:00+00', '2099-01-01 11:00:00+00',
    'OPEN', true, true
  ),
  (
    'a4300000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'a4100000-0000-4000-8000-000000000002',
    'a4200000-0000-4000-8000-000000000002',
    '2099-01-01 11:30:00+00', '2099-01-01 13:00:00+00',
    '2099-01-01 11:30:00+00', '2099-01-01 13:00:00+00',
    'SCHEDULED', true, true
  );

create temporary table pg_temp.targeted_schedule_results (
  name text primary key,
  value jsonb not null
) on commit drop;

insert into pg_temp.targeted_schedule_results values (
  'target_close',
  app_private.process_stall_schedules_for_stall(
    'a4100000-0000-4000-8000-000000000001',
    '2099-01-01 12:00:00+00'
  )
);

select is(
  (select (value->>'closed')::integer from pg_temp.targeted_schedule_results where name = 'target_close'),
  1,
  'targeted catch-up closes the due target schedule'
);
select is(
  (select status::text from public.stall_schedules where id = 'a4300000-0000-4000-8000-000000000001'),
  'COMPLETED',
  'targeted close updates the target schedule'
);
select is(
  (select ordering_state::text from public.stalls where id = 'a4100000-0000-4000-8000-000000000001'),
  'CLOSED',
  'targeted close updates the target stall'
);
select is(
  (select status::text from public.stall_schedules where id = 'a4300000-0000-4000-8000-000000000002'),
  'SCHEDULED',
  'targeted close leaves the other stall schedule untouched'
);
select is(
  (select ordering_state::text from public.stalls where id = 'a4100000-0000-4000-8000-000000000002'),
  'CLOSED',
  'targeted close leaves the other stall ordering state untouched'
);
select is(
  (
    select count(*)::integer
    from public.audit_logs
    where entity_id = 'a4300000-0000-4000-8000-000000000002'
      and action like 'STALL_SCHEDULE_AUTOMATIC_%'
  ),
  0,
  'targeted close emits no audit event for the other stall'
);

insert into pg_temp.targeted_schedule_results values (
  'target_open',
  app_private.process_stall_schedules_for_stall(
    'a4100000-0000-4000-8000-000000000002',
    '2099-01-01 12:00:00+00'
  )
);

select is(
  (select (value->>'opened')::integer from pg_temp.targeted_schedule_results where name = 'target_open'),
  1,
  'targeted catch-up opens the due second schedule when explicitly requested'
);
select is(
  (select ordering_state::text from public.stalls where id = 'a4100000-0000-4000-8000-000000000002'),
  'OPEN',
  'explicitly targeting the second stall opens its ordering state'
);

insert into pg_temp.targeted_schedule_results
select 'target_state', jsonb_agg(jsonb_build_object(
  'scheduleId', schedule.id,
  'scheduleStatus', schedule.status,
  'orderingState', stall.ordering_state,
  'orderingEnabled', stall.ordering_enabled
) order by schedule.id)
from public.stall_schedules schedule
join public.stalls stall on stall.id = schedule.stall_id
where schedule.id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
);

insert into pg_temp.targeted_schedule_results
select 'target_audits', coalesce(jsonb_agg(jsonb_build_object(
  'entityId', audit.entity_id,
  'action', audit.action,
  'outcome', audit.outcome
) order by audit.entity_id), '[]'::jsonb)
from public.audit_logs audit
where audit.entity_id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
)
and audit.action like 'STALL_SCHEDULE_AUTOMATIC_%';

update public.stall_schedules
set status = case id
  when 'a4300000-0000-4000-8000-000000000001'::uuid
    then 'OPEN'::public.stall_schedule_status
  else 'SCHEDULED'::public.stall_schedule_status
end
where id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
);
update public.stalls
set ordering_state = case id
  when 'a4100000-0000-4000-8000-000000000001'::uuid
    then 'OPEN'::public.stall_ordering_state
  else 'CLOSED'::public.stall_ordering_state
end,
ordering_enabled = true
where id in (
  'a4100000-0000-4000-8000-000000000001',
  'a4100000-0000-4000-8000-000000000002'
);
delete from public.audit_logs
where entity_id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
)
and action like 'STALL_SCHEDULE_AUTOMATIC_%';

insert into pg_temp.targeted_schedule_results values (
  'global',
  app_private.process_stall_schedules('2099-01-01 12:00:00+00')
);

select is(
  (select value from pg_temp.targeted_schedule_results where name = 'global'),
  jsonb_build_object(
    'opened', 1,
    'closed', 1,
    'missed', 0,
    'processedAt', '2099-01-01 12:00:00+00'::timestamptz
  ),
  'global cron catch-up aggregates the same results as both targeted calls'
);

insert into pg_temp.targeted_schedule_results
select 'global_state', jsonb_agg(jsonb_build_object(
  'scheduleId', schedule.id,
  'scheduleStatus', schedule.status,
  'orderingState', stall.ordering_state,
  'orderingEnabled', stall.ordering_enabled
) order by schedule.id)
from public.stall_schedules schedule
join public.stalls stall on stall.id = schedule.stall_id
where schedule.id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
);

select is(
  (select value from pg_temp.targeted_schedule_results where name = 'global_state'),
  (select value from pg_temp.targeted_schedule_results where name = 'target_state'),
  'global and targeted catch-up produce the same authoritative stall and schedule state'
);

insert into pg_temp.targeted_schedule_results
select 'global_audits', coalesce(jsonb_agg(jsonb_build_object(
  'entityId', audit.entity_id,
  'action', audit.action,
  'outcome', audit.outcome
) order by audit.entity_id), '[]'::jsonb)
from public.audit_logs audit
where audit.entity_id in (
  'a4300000-0000-4000-8000-000000000001',
  'a4300000-0000-4000-8000-000000000002'
)
and audit.action like 'STALL_SCHEDULE_AUTOMATIC_%';

select is(
  (select value from pg_temp.targeted_schedule_results where name = 'global_audits'),
  (select value from pg_temp.targeted_schedule_results where name = 'target_audits'),
  'global and targeted catch-up emit equivalent audit outcomes'
);

select is(
  (
    select count(*)::integer
    from public.stall_schedules
    where stall_id not in (
      'a4100000-0000-4000-8000-000000000001',
      'a4100000-0000-4000-8000-000000000002'
    )
      and status <> 'CANCELLED'::public.stall_schedule_status
  ),
  0,
  'the equivalence fixture keeps unrelated schedules outside the due set'
);

select * from finish();
rollback;
