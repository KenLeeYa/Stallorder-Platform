alter table public.stalls
  add column if not exists location_guide_image_url text;

alter table public.rate_limit_buckets
  add column if not exists scope text not null default 'legacy';

create index if not exists rate_limit_buckets_scope_expires_at
  on public.rate_limit_buckets (scope, expires_at);

alter table public.storage_object_manifest
  add column if not exists deleted_at timestamptz;

create index if not exists storage_object_manifest_deleted_at
  on public.storage_object_manifest (deleted_at, replication_status)
  where deleted_at is not null;

create table public.catalog_image_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  bucket text not null default 'product-images'
    check (bucket ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
  object_path text not null
    check (
      char_length(object_path) between 1 and 1024
      and object_path !~ '(^|/)\.\.(/|$)'
      and object_path !~ '[[:cntrl:]]'
    ),
  expires_at timestamptz not null,
  attached_at timestamptz,
  cleanup_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, object_path)
);

create index if not exists catalog_image_uploads_tenant_staged
  on public.catalog_image_uploads (organization_id, attached_at, expires_at);

create index if not exists catalog_image_uploads_cleanup
  on public.catalog_image_uploads (cleanup_requested_at, expires_at)
  where attached_at is null;

create table public.operational_alert_refresh_states (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  last_refreshed_at timestamptz,
  claimed_at timestamptz,
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operational_alert_refresh_states_due
  on public.operational_alert_refresh_states (last_refreshed_at, claimed_at);

create index if not exists orders_recent_unpaid_completed_alert_idx
  on public.orders (stall_id, created_at desc)
  where status = 'COMPLETED'::public.order_status
    and payment_status <> 'PAID'::public.payment_status;

create trigger catalog_image_uploads_touch_updated_at
before update on public.catalog_image_uploads
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger operational_alert_refresh_states_touch_updated_at
before update on public.operational_alert_refresh_states
for each row execute function app_private.touch_resilience_foundation_updated_at();

create trigger backend_writable_guard
before insert or update or delete on public.catalog_image_uploads
for each statement execute function app_private.enforce_backend_writable();

create trigger backend_writable_guard
before insert or update or delete on public.operational_alert_refresh_states
for each statement execute function app_private.enforce_backend_writable();

alter table public.catalog_image_uploads enable row level security;
alter table public.catalog_image_uploads force row level security;
alter table public.operational_alert_refresh_states enable row level security;
alter table public.operational_alert_refresh_states force row level security;

revoke all on table public.catalog_image_uploads from public, anon, authenticated;
revoke all on table public.operational_alert_refresh_states from public, anon, authenticated;

grant select, insert, update, delete on table public.catalog_image_uploads to service_role;
grant select, insert, update, delete on table public.operational_alert_refresh_states to service_role;

comment on table public.catalog_image_uploads is
  'Short-lived organization-scoped leases for immutable catalog image uploads; unattached leases are deleted asynchronously.';

comment on column public.storage_object_manifest.deleted_at is
  'Deletion tombstone. Public proxies must deny access immediately and the storage worker removes Primary and DR copies.';

comment on table public.operational_alert_refresh_states is
  'Deduplication and fair scheduling state for bounded background operational-alert refreshes.';

-- Keep operational alert work bounded to live orders and the latest 24 hours.
create function public.refresh_operational_alerts_bounded(p_organization_id uuid)
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
          select 1
          from public.stalls stall
          where stall.id = alert.stall_id
            and stall.is_active
            and (
              stall.business_status = 'PAUSED'::public.stall_business_status
              or not stall.ordering_enabled
            )
        )
      )
      or (
        alert.alert_type = 'EXCESSIVE_PENDING_ORDERS'
        and (
          select count(*)
          from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.status in (
              'WAITING_CONFIRMATION'::public.order_status,
              'CONFIRMED'::public.order_status,
              'PREPARING'::public.order_status,
              'PACKING'::public.order_status,
              'READY'::public.order_status
            )
        ) < 10
      )
      or (
        alert.alert_type = 'UNPAID_COMPLETED_ORDER'
        and not exists (
          select 1
          from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.status = 'COMPLETED'::public.order_status
            and orders.payment_status <> 'PAID'::public.payment_status
            and orders.created_at >= now() - interval '24 hours'
        )
      )
      or (
        alert.alert_type = 'HIGH_CANCELLATION_RATE'
        and not exists (
          select 1
          from public.orders orders
          where orders.stall_id = alert.stall_id
            and orders.created_at >= now() - interval '24 hours'
          group by orders.stall_id
          having count(*) >= 5
            and count(*) filter (
              where orders.status = 'CANCELLED'::public.order_status
            )::numeric / count(*) >= 0.30
        )
      )
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select
    stall.organization_id,
    stall.id,
    'ORDERING_PAUSED',
    'WARNING',
    '攤位目前暫停或關閉 QR 點餐'
  from public.stalls stall
  where stall.organization_id = p_organization_id
    and stall.is_active
    and (
      stall.business_status = 'PAUSED'::public.stall_business_status
      or not stall.ordering_enabled
    )
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'ORDERING_PAUSED'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select
    stall.organization_id,
    stall.id,
    'EXCESSIVE_PENDING_ORDERS',
    'CRITICAL',
    '目前有 ' || count(orders.id)::text || ' 筆待處理訂單，請立即確認產能'
  from public.stalls stall
  join public.orders orders
    on orders.stall_id = stall.id
    and orders.status in (
      'WAITING_CONFIRMATION'::public.order_status,
      'CONFIRMED'::public.order_status,
      'PREPARING'::public.order_status,
      'PACKING'::public.order_status,
      'READY'::public.order_status
    )
  where stall.organization_id = p_organization_id
    and stall.is_active
  group by stall.organization_id, stall.id
  having count(orders.id) >= 10
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'EXCESSIVE_PENDING_ORDERS'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select
    stall.organization_id,
    stall.id,
    'UNPAID_COMPLETED_ORDER',
    'CRITICAL',
    '近 24 小時有 ' || count(orders.id)::text || ' 筆已完成但尚未付款的訂單'
  from public.stalls stall
  join public.orders orders
    on orders.stall_id = stall.id
    and orders.status = 'COMPLETED'::public.order_status
    and orders.payment_status <> 'PAID'::public.payment_status
    and orders.created_at >= now() - interval '24 hours'
  where stall.organization_id = p_organization_id
    and stall.is_active
  group by stall.organization_id, stall.id
  having not exists (
    select 1 from public.operational_alerts alert
    where alert.stall_id = stall.id
      and alert.alert_type = 'UNPAID_COMPLETED_ORDER'
      and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
  );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id, stall_id, alert_type, severity, message
  )
  select
    stall.organization_id,
    stall.id,
    'HIGH_CANCELLATION_RATE',
    'WARNING',
    '近 24 小時取消率為 ' || round(
      count(*) filter (
        where orders.status = 'CANCELLED'::public.order_status
      )::numeric * 100 / count(*)
    )::text || '%'
  from public.stalls stall
  join public.orders orders
    on orders.stall_id = stall.id
    and orders.created_at >= now() - interval '24 hours'
  where stall.organization_id = p_organization_id
    and stall.is_active
  group by stall.organization_id, stall.id
  having count(*) >= 5
    and count(*) filter (
      where orders.status = 'CANCELLED'::public.order_status
    )::numeric / count(*) >= 0.30
    and not exists (
      select 1 from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'HIGH_CANCELLATION_RATE'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$$;

revoke all on function public.refresh_operational_alerts_bounded(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_operational_alerts_bounded(uuid) to service_role;
