begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

delete from public.order_production_tasks where stall_id = '22222222-2222-4222-8222-222222222222';
delete from public.kitchen_station_assignments where stall_id = '22222222-2222-4222-8222-222222222222';
delete from public.kitchen_stations
where stall_id = '22222222-2222-4222-8222-222222222222' and code <> 'DEFAULT';

select is(
  (select count(*)::integer from public.kitchen_stations
   where stall_id = '22222222-2222-4222-8222-222222222222' and code = 'DEFAULT'),
  1,
  'every stall has one default kitchen station'
);
select throws_ok(
  $$
    update public.kitchen_stations
    set is_active = false
    where stall_id = '22222222-2222-4222-8222-222222222222' and code = 'DEFAULT'
  $$,
  'P0001',
  'DEFAULT_KITCHEN_STATION_REQUIRED',
  'the default kitchen station cannot be disabled'
);
select throws_ok(
  $$
    delete from public.kitchen_stations
    where stall_id = '22222222-2222-4222-8222-222222222222' and code = 'DEFAULT'
  $$,
  'P0001',
  'DEFAULT_KITCHEN_STATION_REQUIRED',
  'the default kitchen station cannot be deleted'
);

insert into public.kitchen_stations (
  id, organization_id, stall_id, name, code, sort_order
) values (
  'a1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '炸台', 'FRY', 1
);
insert into public.kitchen_station_assignments (
  organization_id, stall_id, station_id, product_id
) values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'a1000000-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444441'
);

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status,
  payment_status, subtotal, total, device_hash, pickup_code_hash,
  pickup_code_display, confirmation_expires_at, created_at, updated_at
) values (
  'a2000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'KDS-001', repeat('1', 64),
  'a2000000-0000-4000-8000-000000000011', 'QR_MENU', 'KDS customer',
  'TAKEOUT', 'WAITING_CONFIRMATION', 'UNPAID', 130, 130, repeat('2', 64),
  repeat('3', 64), '738', now() + interval '10 minutes', now(), now()
);
insert into public.order_items (
  id, tenant_id, organization_id, stall_id, order_id, product_id,
  name, base_unit_price, unit_price, quantity, status
) values
  (
    'a3000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'a2000000-0000-4000-8000-000000000001',
    '44444444-4444-4444-8444-444444444441', '雞排', 95, 95, 1, 'PENDING'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'a2000000-0000-4000-8000-000000000001',
    '44444444-4444-4444-8444-444444444444', '冬瓜茶', 35, 35, 1, 'PENDING'
  );

update public.orders
set status = 'CONFIRMED', confirmed_at = now()
where id = 'a2000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.order_production_tasks
   where order_id = 'a2000000-0000-4000-8000-000000000001'),
  2,
  'confirming an order creates one production task per item'
);
select is(
  (select station_id from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000001'),
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'product-specific assignment routes to the configured station'
);
select is(
  (select station.code from public.order_production_tasks task
   join public.kitchen_stations station on station.id = task.station_id
   where task.order_item_id = 'a3000000-0000-4000-8000-000000000002'),
  'DEFAULT',
  'unassigned products route to the default station'
);
select is(
  (select count(*)::integer from public.order_events
   where order_id = 'a2000000-0000-4000-8000-000000000001'
     and event_type = 'PRODUCTION_TASK_CREATED'),
  2,
  'task creation emits authoritative order events'
);

update public.orders
set confirmed_at = now() - interval '15 minutes'
where id = 'a2000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.refresh_kds_operational_alerts(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
end
$$;
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'KDS_ORDER_OVERDUE' and status = 'ACTIVE'
  ),
  'overdue KDS work creates an operational alert'
);
update public.orders
set confirmed_at = now()
where id = 'a2000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.refresh_kds_operational_alerts(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
end
$$;
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'KDS_ORDER_OVERDUE' and status = 'RESOLVED'
  ),
  'overdue KDS alert resolves when work returns below the threshold'
);

update public.order_production_tasks
set quantity = 12
where order_item_id = 'a3000000-0000-4000-8000-000000000002';
do $$
begin
  perform public.refresh_kds_operational_alerts(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
end
$$;
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'STATION_BACKLOG' and status = 'ACTIVE'
  ),
  'station backlog creates an operational alert'
);
update public.order_production_tasks
set quantity = 1
where order_item_id = 'a3000000-0000-4000-8000-000000000002';
do $$
begin
  perform public.refresh_kds_operational_alerts(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  );
end
$$;
select ok(
  exists (
    select 1 from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'STATION_BACKLOG' and status = 'RESOLVED'
  ),
  'station backlog alert resolves after the queue is reduced'
);

update public.order_items
set status = 'PREPARING', preparing_at = now()
where id = 'a3000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000001'),
  'PREPARING',
  'item preparation synchronizes its production task'
);
update public.order_items
set status = 'READY', ready_at = now()
where id = 'a3000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000001'),
  'COMPLETED',
  'ready items synchronize production completion'
);

delete from public.order_production_tasks
where order_item_id = 'a3000000-0000-4000-8000-000000000001';
select public.create_kds_tasks_for_order('a2000000-0000-4000-8000-000000000001');
select ok(
  (select status = 'COMPLETED'::public.kitchen_task_status
      and started_at is not null
      and completed_at is not null
   from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000001'),
  'backfilled ready items keep completed task state and timestamps'
);

update public.orders
set status = 'CANCELLED', cancelled_at = now()
where id = 'a2000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000001'),
  'COMPLETED',
  'cancelling an order preserves already completed production history'
);
select is(
  (select status::text from public.order_production_tasks
   where order_item_id = 'a3000000-0000-4000-8000-000000000002'),
  'CANCELLED',
  'cancelling an order cancels pending production tasks'
);

select ok(
  (select bool_and(relrowsecurity and relforcerowsecurity)
   from pg_class
   where oid in (
     'public.kitchen_stations'::regclass,
     'public.kitchen_station_assignments'::regclass,
     'public.order_production_tasks'::regclass
   )),
  'all KDS tables enable and force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.order_production_tasks', 'SELECT'),
  'anonymous users cannot read production tasks'
);
select ok(
  not has_table_privilege('authenticated', 'public.order_production_tasks', 'UPDATE'),
  'authenticated users cannot write production tasks directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.orders', 'total', 'SELECT')
  and not has_column_privilege('authenticated', 'public.orders', 'payment_status', 'SELECT'),
  'the Data API does not grant financial order columns to kitchen users'
);
select ok(
  (select exists (
    select 1 from public.plan_entitlements entitlement
    where entitlement.feature_code = 'KDS' and entitlement.is_enabled
  )),
  'KDS is backed by server-side plan entitlements'
);
select ok(
  'PACKING' = any(enum_range(null::public.order_status)::text[]),
  'the shared order state includes PACKING'
);

delete from public.operational_alerts
where stall_id = '22222222-2222-4222-8222-222222222222'
  and alert_type = 'EXCESSIVE_PENDING_ORDERS';

insert into public.orders (
  id, tenant_id, organization_id, stall_id, order_no, tracking_token_hash,
  idempotency_key, source, customer_name, fulfillment_type, status, payment_status,
  subtotal, total, device_hash, pickup_code_hash, pickup_code_display,
  confirmation_expires_at, confirmed_at, created_at, updated_at
)
select
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'KDS-PACK-' || series_no::text,
  encode(digest('kds-pack-tracking-' || series_no::text, 'sha256'), 'hex'),
  gen_random_uuid(),
  'STAFF_POS',
  'KDS packing customer',
  'TAKEOUT',
  'PACKING',
  'UNPAID',
  0,
  0,
  encode(digest('kds-pack-device-' || series_no::text, 'sha256'), 'hex'),
  encode(digest('kds-pack-pickup-' || series_no::text, 'sha256'), 'hex'),
  lpad(series_no::text, 3, '0'),
  now() + interval '10 minutes',
  now(),
  now() - make_interval(mins => series_no),
  now()
from generate_series(1, 10) as series_no;

select public.refresh_operational_alerts('11111111-1111-4111-8111-111111111111');
select ok(
  exists (
    select 1
    from public.operational_alerts
    where stall_id = '22222222-2222-4222-8222-222222222222'
      and alert_type = 'EXCESSIVE_PENDING_ORDERS'
      and status = 'ACTIVE'
  ),
  'PACKING orders remain part of the shared pending-order operational alert'
);

do $$
declare
  v_business_date date;
begin
  v_business_date := public.stall_business_date(
    '22222222-2222-4222-8222-222222222222',
    now()
  );
  perform public.rebuild_daily_stall_summary(
    '22222222-2222-4222-8222-222222222222',
    v_business_date,
    v_business_date
  );
end
$$;
select ok(
  (select pending_order_count >= 10 and confirmed_order_count >= 10
   from public.daily_stall_summaries
   where stall_id = '22222222-2222-4222-8222-222222222222'
     and business_date = public.stall_business_date(
       '22222222-2222-4222-8222-222222222222',
       now()
     )),
  'PACKING orders remain included in daily operational summaries'
);

insert into public.organizations (
  id, name, slug, business_name, status, email, phone, updated_at
) values (
  'a4000000-0000-4000-8000-000000000001', 'Other KDS org', 'other-kds-org',
  'Other KDS org', 'ACTIVE', 'other-kds@stallorder.test', '0900000099', now()
);
insert into public.subscriptions (
  id, organization_id, plan_id, status, billing_period_start, billing_period_end
) select
  'a4500000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001', id, 'ACTIVE',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month')::date
from public.plans where code = 'STANDARD';
insert into public.stalls (
  id, organization_id, name, slug, code, address, currency, timezone,
  is_active, business_status, ordering_enabled, updated_at
) values (
  'a5000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001', 'Other KDS stall', 'other-kds-stall',
  'OTHER-KDS', 'Other address', 'TWD', 'Asia/Taipei', true, 'OPEN', true, now()
);

insert into auth.users (id, email) values (
  'a6000000-0000-4000-8000-000000000001', 'kitchen-kds-auth@stallorder.test'
);
update public.profiles
set auth_user_id = 'a6000000-0000-4000-8000-000000000001'
where id = '55555555-5555-4555-8555-555555555553';
insert into auth.users (id, email) values (
  'a6000000-0000-4000-8000-000000000002', 'staff-kds-auth@stallorder.test'
);
update public.profiles
set auth_user_id = 'a6000000-0000-4000-8000-000000000002'
where id = '55555555-5555-4555-8555-555555555552';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000001', true);
select cmp_ok(
  (select count(*)::integer from public.kitchen_stations
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  '>', 0,
  'kitchen can read stations for its assigned stall'
);
select is(
  (select count(*)::integer from public.kitchen_stations
   where stall_id = 'a5000000-0000-4000-8000-000000000001'),
  0,
  'kitchen cannot read another stall production configuration'
);
select is(
  (select count(*)::integer from public.order_production_tasks
   where stall_id = 'a5000000-0000-4000-8000-000000000001'),
  0,
  'cross-stall production task access is isolated'
);
select is(
  public.can_view_orders('22222222-2222-4222-8222-222222222222'),
  false,
  'kitchen cannot use the general order RLS boundary'
);
select is(
  public.can_view_kds('22222222-2222-4222-8222-222222222222'),
  true,
  'kitchen can use the dedicated KDS RLS boundary'
);

select set_config('request.jwt.claim.sub', 'a6000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.kitchen_stations
   where stall_id = '22222222-2222-4222-8222-222222222222'),
  0,
  'staff cannot read KDS configuration directly'
);
select is(
  public.can_view_orders('22222222-2222-4222-8222-222222222222'),
  true,
  'staff keeps the general order RLS access required for operations'
);

reset role;
select lives_ok(
  $$
    delete from public.stalls
    where id = 'a5000000-0000-4000-8000-000000000001'
  $$,
  'deleting a stall may cascade through its default kitchen station'
);

select * from finish();
rollback;
