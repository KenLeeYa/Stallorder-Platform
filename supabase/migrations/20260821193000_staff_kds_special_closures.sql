alter table public.stall_ordering_settings
  add column if not exists kds_module_enabled boolean;

-- Existing stores keep their current production workflow. New stores opt in to KDS.
update public.stall_ordering_settings
set kds_module_enabled = true
where kds_module_enabled is null;

alter table public.stall_ordering_settings
  alter column kds_module_enabled set default false,
  alter column kds_module_enabled set not null;

-- A disabled KDS must not create hidden production work. Existing tasks still
-- follow the cancellation path below, so turning the module off never leaves
-- already-created work in an invalid state.
create or replace function public.route_confirmed_order_to_kds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED'::public.order_status
     and old.status is distinct from new.status
     and exists (
       select 1
       from public.stall_ordering_settings settings
       where settings.stall_id = new.stall_id
         and settings.kds_module_enabled
     ) then
    perform public.create_kds_tasks_for_order(new.id);
  end if;

  if new.status = 'CANCELLED'::public.order_status
     and old.status is distinct from new.status then
    update public.order_production_tasks task
    set status = 'CANCELLED'::public.kitchen_task_status,
        completed_at = coalesce(task.completed_at, now()),
        updated_at = now()
    where task.order_id = new.id
      and task.status in (
        'PENDING'::public.kitchen_task_status,
        'PREPARING'::public.kitchen_task_status
      );
    if found then
      insert into public.order_events (
        id, organization_id, stall_id, order_id, event_type,
        previous_status, new_status, created_at
      ) values (
        gen_random_uuid(), new.organization_id, new.stall_id, new.id,
        'PRODUCTION_TASK_UPDATED', old.status, new.status, now()
      );
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.route_new_order_item_to_kds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.orders orders
    join public.stall_ordering_settings settings
      on settings.stall_id = orders.stall_id
     and settings.kds_module_enabled
    where orders.id = new.order_id
      and orders.status in (
        'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status,
        'PACKING'::public.order_status,
        'READY'::public.order_status
      )
  ) then
    perform public.create_kds_tasks_for_order(new.order_id);
  end if;
  return null;
end;
$$;

create table if not exists public.stall_special_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  title text not null default '公休日',
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_special_closures_date_range_check check (ends_on >= starts_on),
  constraint stall_special_closures_title_length_check check (char_length(title) between 1 and 80),
  constraint stall_special_closures_message_length_check check (char_length(message) <= 240)
);

create index if not exists stall_special_closures_tenant_range_idx
  on public.stall_special_closures (organization_id, stall_id, starts_on, ends_on);
create index if not exists stall_special_closures_stall_end_idx
  on public.stall_special_closures (stall_id, ends_on);

alter table public.stall_special_closures enable row level security;
alter table public.stall_special_closures force row level security;
revoke all on table public.stall_special_closures from public, anon, authenticated;
grant select on table public.stall_special_closures to authenticated;
grant select, insert, update, delete on table public.stall_special_closures to service_role;

drop policy if exists stall_special_closures_authorized_select on public.stall_special_closures;
create policy stall_special_closures_authorized_select on public.stall_special_closures
for select to authenticated using (app_private.can_manage_stall(stall_id));

-- KDS orders still print on confirmation. Streamlined staff orders print at checkout.
create or replace function public.queue_confirmed_order_print_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_printer_id uuid;
begin
  if new.status <> 'CONFIRMED'::public.order_status
     or (tg_op = 'UPDATE' and old.status = 'CONFIRMED'::public.order_status)
     or not exists (
       select 1
       from public.stall_ordering_settings settings
       where settings.stall_id = new.stall_id
         and settings.print_module_enabled
         and settings.kds_module_enabled
     ) then
    return null;
  end if;

  select printer.id into v_printer_id
  from public.printers printer
  where printer.stall_id = new.stall_id
    and printer.organization_id = new.organization_id
    and printer.is_enabled
  order by (printer.last_seen_at >= now() - interval '90 seconds') desc,
    printer.last_seen_at desc nulls last, printer.created_at asc
  limit 1;

  insert into public.print_jobs (
    organization_id, stall_id, order_id, printer_id, status,
    queued_at, created_at, updated_at
  ) values (
    new.organization_id, new.stall_id, new.id, v_printer_id,
    'PENDING'::public.print_job_status, now(), now(), now()
  ) on conflict do nothing;
  return null;
end;
$$;

revoke all on function public.queue_confirmed_order_print_job() from public, anon, authenticated;
grant execute on function public.queue_confirmed_order_print_job() to service_role;

-- Keep the canonical preflight as the single trusted gate, then add the local-date
-- closure rule around it for both session issuance and final order submission.
alter function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) rename to public_order_preflight_without_special_closure;

create function public.public_order_preflight(
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
  v_result := public.public_order_preflight_without_special_closure(
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

revoke all on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) from public, anon, authenticated;
grant execute on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) to service_role;

comment on function public.public_order_preflight(
  text, text, text, text, text, text, text, text, text, uuid, text,
  timestamptz, uuid, jsonb, boolean, text
) is
  'Canonical trusted public-order preflight with stall-local special-closure enforcement.';
