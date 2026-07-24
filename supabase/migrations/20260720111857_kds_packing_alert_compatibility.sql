-- Keep the shared pending-order alert aligned with the KDS PACKING state.
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
    organization_id,
    stall_id,
    alert_type,
    severity,
    message
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
      select 1
      from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'ORDERING_PAUSED'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id,
    stall_id,
    alert_type,
    severity,
    message
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
      select 1
      from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'EXCESSIVE_PENDING_ORDERS'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id,
    stall_id,
    alert_type,
    severity,
    message
  )
  select
    stall.organization_id,
    stall.id,
    'UNPAID_COMPLETED_ORDER',
    'CRITICAL',
    '目前有 ' || count(orders.id)::text || ' 筆已完成但尚未付款的訂單'
  from public.stalls stall
  join public.orders orders
    on orders.stall_id = stall.id
    and orders.status = 'COMPLETED'::public.order_status
    and orders.payment_status <> 'PAID'::public.payment_status
  where stall.organization_id = p_organization_id
    and stall.is_active
  group by stall.organization_id, stall.id
  having not exists (
    select 1
    from public.operational_alerts alert
    where alert.stall_id = stall.id
      and alert.alert_type = 'UNPAID_COMPLETED_ORDER'
      and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
  );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  insert into public.operational_alerts (
    organization_id,
    stall_id,
    alert_type,
    severity,
    message
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
      select 1
      from public.operational_alerts alert
      where alert.stall_id = stall.id
        and alert.alert_type = 'HIGH_CANCELLATION_RATE'
        and alert.status in ('ACTIVE', 'ACKNOWLEDGED')
    );
  get diagnostics affected_count = row_count;
  changed_count := changed_count + affected_count;

  return changed_count;
end;
$$;

revoke all on function public.refresh_operational_alerts(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_operational_alerts(uuid) to service_role;
