-- Phase 5: persisted, tenant-scoped operational events and actionable alerts.

-- Preserve explicit PAUSED/SOLD_OUT states when ordering_enabled is disabled.
-- The Phase 1 compatibility trigger previously collapsed both to CLOSED.
create or replace function public.sync_stall_foundation_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is null then
    new.organization_id := new.tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := new.organization_id;
  elsif new.organization_id <> new.tenant_id then
    raise exception 'STALL_ORGANIZATION_SCOPE_MISMATCH';
  end if;

  new.code := coalesce(
    nullif(upper(btrim(new.code)), ''),
    upper(regexp_replace(new.slug, '[^a-zA-Z0-9]+', '-', 'g'))
  );
  new.address := coalesce(nullif(btrim(new.address), ''), new.location);
  new.location := coalesce(nullif(btrim(new.location), ''), new.address);
  new.timezone := coalesce(nullif(btrim(new.timezone), ''), 'Asia/Taipei');

  if tg_op = 'INSERT' then
    if new.business_status <> 'OPEN'::public.stall_business_status then
      new.ordering_state := case new.business_status
        when 'PAUSED'::public.stall_business_status then 'PAUSED'::public.stall_ordering_state
        when 'CLOSED'::public.stall_business_status then 'CLOSED'::public.stall_ordering_state
        else 'OPEN'::public.stall_ordering_state
      end;
      new.is_sold_out := new.business_status = 'SOLD_OUT'::public.stall_business_status;
    elsif new.is_sold_out then
      new.business_status := 'SOLD_OUT'::public.stall_business_status;
    elsif new.ordering_state = 'PAUSED'::public.stall_ordering_state then
      new.business_status := 'PAUSED'::public.stall_business_status;
    elsif new.ordering_state = 'CLOSED'::public.stall_ordering_state then
      new.business_status := 'CLOSED'::public.stall_business_status;
    end if;
  elsif new.business_status is distinct from old.business_status then
    new.ordering_state := case new.business_status
      when 'PAUSED'::public.stall_business_status then 'PAUSED'::public.stall_ordering_state
      when 'CLOSED'::public.stall_business_status then 'CLOSED'::public.stall_ordering_state
      else 'OPEN'::public.stall_ordering_state
    end;
    new.is_sold_out := new.business_status = 'SOLD_OUT'::public.stall_business_status;
  elsif new.ordering_state is distinct from old.ordering_state
     or new.is_sold_out is distinct from old.is_sold_out then
    new.business_status := case
      when new.is_sold_out then 'SOLD_OUT'::public.stall_business_status
      when new.ordering_state = 'PAUSED'::public.stall_ordering_state then 'PAUSED'::public.stall_business_status
      when new.ordering_state = 'CLOSED'::public.stall_ordering_state then 'CLOSED'::public.stall_business_status
      else 'OPEN'::public.stall_business_status
    end;
  end if;

  if tg_op = 'UPDATE' and new.ordering_enabled is distinct from old.ordering_enabled then
    if not new.ordering_enabled then
      if new.business_status = 'PAUSED'::public.stall_business_status then
        new.ordering_state := 'PAUSED'::public.stall_ordering_state;
        new.is_sold_out := false;
      elsif new.business_status = 'SOLD_OUT'::public.stall_business_status then
        new.ordering_state := 'OPEN'::public.stall_ordering_state;
        new.is_sold_out := true;
      else
        new.ordering_state := 'CLOSED'::public.stall_ordering_state;
        new.business_status := 'CLOSED'::public.stall_business_status;
        new.is_sold_out := false;
      end if;
    elsif new.business_status = 'CLOSED'::public.stall_business_status then
      new.ordering_state := 'OPEN'::public.stall_ordering_state;
      new.business_status := 'OPEN'::public.stall_business_status;
    end if;
  else
    new.ordering_enabled := new.ordering_state <> 'CLOSED'::public.stall_ordering_state;
  end if;

  return new;
end;
$$;

create table public.operational_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  event_type text not null check (event_type in (
    'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_PREPARING', 'ORDER_READY',
    'ORDER_COMPLETED', 'ORDER_CANCELLED', 'PAYMENT_RECORDED',
    'STALL_OPENED', 'STALL_PAUSED', 'STALL_CLOSED',
    'PRODUCT_SOLD_OUT_CHANGED'
  )),
  entity_type text not null check (char_length(entity_type) between 1 and 60),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operational_events_payload_object check (jsonb_typeof(payload) = 'object')
);

create index operational_events_organization_created_idx
  on public.operational_events (organization_id, created_at desc);
create index operational_events_stall_created_idx
  on public.operational_events (stall_id, created_at desc);
create index operational_events_entity_idx
  on public.operational_events (entity_type, entity_id, created_at desc);

create trigger operational_events_scope_before_write
before insert or update on public.operational_events
for each row execute function public.derive_stall_organization_scope();

create table public.operational_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  alert_type text not null check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER'
  )),
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  message text not null check (char_length(message) between 1 and 500),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED')),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index operational_alerts_open_type_idx
  on public.operational_alerts (stall_id, alert_type)
  where status in ('ACTIVE', 'ACKNOWLEDGED');
create index operational_alerts_organization_status_idx
  on public.operational_alerts (organization_id, status, detected_at desc);
create index operational_alerts_stall_status_idx
  on public.operational_alerts (stall_id, status, detected_at desc);

create trigger operational_alerts_scope_before_write
before insert or update on public.operational_alerts
for each row execute function public.derive_stall_organization_scope();

create or replace function public.touch_operational_alert_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger operational_alerts_touch_before_update
before update on public.operational_alerts
for each row execute function public.touch_operational_alert_updated_at();

create or replace function public.emit_order_operational_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mapped_event_type text;
begin
  mapped_event_type := case new.new_status
    when 'WAITING_CONFIRMATION'::public.order_status then 'ORDER_CREATED'
    when 'CONFIRMED'::public.order_status then 'ORDER_CONFIRMED'
    when 'PREPARING'::public.order_status then 'ORDER_PREPARING'
    when 'READY'::public.order_status then 'ORDER_READY'
    when 'COMPLETED'::public.order_status then 'ORDER_COMPLETED'
    when 'CANCELLED'::public.order_status then 'ORDER_CANCELLED'
    else null
  end;

  if mapped_event_type is not null then
    insert into public.operational_events (
      organization_id, stall_id, event_type, entity_type, entity_id, payload
    ) values (
      new.organization_id,
      new.stall_id,
      mapped_event_type,
      'ORDER',
      new.order_id,
      jsonb_build_object(
        'previousStatus', new.previous_status,
        'newStatus', new.new_status
      )
    );
  end if;
  return new;
end;
$$;

create trigger order_events_emit_operational_after_insert
after insert on public.order_events
for each row execute function public.emit_order_operational_event();

create or replace function public.emit_payment_operational_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'PAID' and (
    tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.amount is distinct from new.amount
  ) then
    insert into public.operational_events (
      organization_id, stall_id, event_type, entity_type, entity_id, payload
    ) values (
      new.organization_id,
      new.stall_id,
      'PAYMENT_RECORDED',
      'PAYMENT',
      new.id,
      jsonb_build_object('orderId', new.order_id)
    );
  end if;
  return new;
end;
$$;

create trigger payments_emit_operational_after_write
after insert or update of status, amount on public.payments
for each row execute function public.emit_payment_operational_event();

create or replace function public.emit_stall_operational_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mapped_event_type text;
begin
  if old.business_status is not distinct from new.business_status
     and old.ordering_enabled is not distinct from new.ordering_enabled then
    return new;
  end if;

  mapped_event_type := case
    when new.business_status = 'OPEN'::public.stall_business_status and new.ordering_enabled
      then 'STALL_OPENED'
    when new.business_status = 'PAUSED'::public.stall_business_status or not new.ordering_enabled
      then 'STALL_PAUSED'
    else 'STALL_CLOSED'
  end;

  insert into public.operational_events (
    organization_id, stall_id, event_type, entity_type, entity_id, payload
  ) values (
    new.organization_id,
    new.id,
    mapped_event_type,
    'STALL',
    new.id,
    jsonb_build_object(
      'businessStatus', new.business_status,
      'orderingEnabled', new.ordering_enabled
    )
  );
  return new;
end;
$$;

create trigger stalls_emit_operational_after_update
after update of business_status, ordering_enabled on public.stalls
for each row execute function public.emit_stall_operational_event();

create or replace function public.emit_product_operational_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_sold_out is distinct from new.is_sold_out then
    insert into public.operational_events (
      organization_id, stall_id, event_type, entity_type, entity_id, payload
    ) values (
      new.organization_id,
      new.stall_id,
      'PRODUCT_SOLD_OUT_CHANGED',
      'PRODUCT',
      new.product_id,
      jsonb_build_object('isSoldOut', new.is_sold_out)
    );
  end if;
  return new;
end;
$$;

create trigger stall_products_emit_operational_after_update
after update of is_sold_out on public.stall_products
for each row execute function public.emit_product_operational_event();

create or replace function public.refresh_operational_alerts(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer := 0;
  affected_count integer := 0;
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'ORGANIZATION_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  update public.operational_alerts alert
  set status = 'RESOLVED', resolved_at = now()
  where alert.organization_id = p_organization_id
    and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    and (
      (
        alert.alert_type = 'ORDERING_PAUSED'
        and not exists (
          select 1 from public.stalls stall
          where stall.id = alert.stall_id and stall.is_active
            and (stall.business_status = 'PAUSED'::public.stall_business_status or not stall.ordering_enabled)
        )
      )
      or (
        alert.alert_type = 'EXCESSIVE_PENDING_ORDERS'
        and (select count(*) from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.status in (
              'WAITING_CONFIRMATION'::public.order_status,
              'CONFIRMED'::public.order_status,
              'PREPARING'::public.order_status,
              'READY'::public.order_status
            )) < 10
      )
      or (
        alert.alert_type = 'UNPAID_COMPLETED_ORDER'
        and not exists (
          select 1 from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.status = 'COMPLETED'::public.order_status
            and orders.payment_status <> 'PAID'::public.payment_status
        )
      )
      or (
        alert.alert_type = 'HIGH_CANCELLATION_RATE'
        and not exists (
          select 1 from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.created_at >= now() - interval '24 hours'
          group by orders.stall_id
          having count(*) >= 5
            and count(*) filter (where orders.status = 'CANCELLED'::public.order_status)::numeric / count(*) >= 0.30
        )
      )
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select stall.organization_id, stall.id, 'ORDERING_PAUSED', 'WARNING', '此攤位目前暫停接受 QR 點餐。'
  from public.stalls stall
  where stall.organization_id = p_organization_id
    and stall.is_active
    and (stall.business_status = 'PAUSED'::public.stall_business_status or not stall.ordering_enabled)
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id and alert.alert_type = 'ORDERING_PAUSED'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select stall.organization_id, stall.id, 'EXCESSIVE_PENDING_ORDERS', 'CRITICAL',
    '待處理訂單已達 ' || count(orders.id)::text || ' 筆，請立即確認現場處理能力。'
  from public.stalls stall
  join public.orders orders on orders.stall_id = stall.id
    and orders.status in (
      'WAITING_CONFIRMATION'::public.order_status,
      'CONFIRMED'::public.order_status,
      'PREPARING'::public.order_status,
      'READY'::public.order_status
    )
  where stall.organization_id = p_organization_id and stall.is_active
  group by stall.organization_id, stall.id
  having count(orders.id) >= 10
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id and alert.alert_type = 'EXCESSIVE_PENDING_ORDERS'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select stall.organization_id, stall.id, 'UNPAID_COMPLETED_ORDER', 'CRITICAL',
    '發現 ' || count(orders.id)::text || ' 筆已完成但未付款的訂單。'
  from public.stalls stall
  join public.orders orders on orders.stall_id = stall.id
    and orders.status = 'COMPLETED'::public.order_status
    and orders.payment_status <> 'PAID'::public.payment_status
  where stall.organization_id = p_organization_id and stall.is_active
  group by stall.organization_id, stall.id
  having not exists (
    select 1 from public.operational_alerts alert
    where alert.stall_id = stall.id and alert.alert_type = 'UNPAID_COMPLETED_ORDER'
      and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
  );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select stall.organization_id, stall.id, 'HIGH_CANCELLATION_RATE', 'WARNING',
    '近 24 小時取消率達 ' || round(
      count(*) filter (where orders.status = 'CANCELLED'::public.order_status)::numeric * 100 / count(*)
    )::text || '%。'
  from public.stalls stall
  join public.orders orders on orders.stall_id = stall.id
    and orders.created_at >= now() - interval '24 hours'
  where stall.organization_id = p_organization_id and stall.is_active
  group by stall.organization_id, stall.id
  having count(*) >= 5
    and count(*) filter (where orders.status = 'CANCELLED'::public.order_status)::numeric / count(*) >= 0.30
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id and alert.alert_type = 'HIGH_CANCELLATION_RATE'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$$;

revoke all on function public.refresh_operational_alerts(uuid) from public, anon, authenticated;
grant execute on function public.refresh_operational_alerts(uuid) to service_role;

alter table public.operational_events enable row level security;
alter table public.operational_events force row level security;
alter table public.operational_alerts enable row level security;
alter table public.operational_alerts force row level security;

revoke all on public.operational_events, public.operational_alerts from public, anon, authenticated;
grant select on public.operational_events, public.operational_alerts to authenticated;
grant select, insert, update, delete on public.operational_events, public.operational_alerts to service_role;

create policy operational_events_authorized_select on public.operational_events
for select to authenticated using (
  public.can_access_stall(stall_id)
  and (
    event_type <> 'PAYMENT_RECORDED'
    or public.has_organization_role(
      organization_id,
      array[
        'ORGANIZATION_OWNER'::public.user_role,
        'ORGANIZATION_ADMIN'::public.user_role,
        'FINANCE_VIEWER'::public.user_role
      ]
    )
    or public.has_stall_role(
      stall_id,
      array['STALL_MANAGER'::public.user_role, 'STAFF'::public.user_role]
    )
  )
);

create policy operational_alerts_authorized_select on public.operational_alerts
for select to authenticated using (
  public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    ]
  )
  or public.has_stall_role(
    stall_id,
    array['STALL_MANAGER'::public.user_role, 'STAFF'::public.user_role]
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.operational_events;
    alter publication supabase_realtime add table public.operational_alerts;
  end if;
end;
$$;
