-- Scope replay/idempotency to the provider connection and add the provider-specific
-- capability switches. Every new switch remains disabled by default.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';

alter table public.external_orders
  drop constraint external_orders_provider_order_key,
  add constraint external_orders_provider_order_key
    unique (connection_id, provider, external_order_id);

alter table public.delivery_webhook_events
  drop constraint delivery_webhook_events_provider_replay_key,
  add constraint delivery_webhook_events_provider_replay_key
    unique (connection_id, provider, replay_key);

alter table public.delivery_sync_jobs
  drop constraint delivery_sync_jobs_provider_deduplication_key,
  add constraint delivery_sync_jobs_provider_deduplication_key
    unique (connection_id, provider, deduplication_key),
  drop constraint delivery_sync_jobs_job_type_check,
  add constraint delivery_sync_jobs_job_type_check
    check (job_type in (
      'CONNECTION_HEALTH_CHECK', 'STORE_DISCOVERY', 'STORE_ACTIVATION',
      'MENU_FULL_SYNC', 'MENU_INCREMENTAL_SYNC', 'AVAILABILITY_SYNC',
      'ORDER_FETCH', 'ORDER_IMPORT', 'ORDER_ACCEPT', 'ORDER_REJECT',
      'ORDER_PREPARING', 'ORDER_READY', 'ORDER_RECONCILIATION',
      'CONNECTION_DISCONNECT'
    ));

do $$
begin
  if not exists (
    select 1
    from public.backend_runtime_state
    where is_current
      and backend_code = 'DR'
      and backend_role = 'READ_ONLY_STANDBY'
      and not writes_enabled
      and enforcement_enabled
  ) then
    perform app_private.assert_backend_writable();

    insert into public.resilience_feature_flags (
      code,
      description,
      default_enabled,
      is_emergency
    )
    values
      ('FOODPANDA_ORDERS_ENABLED', 'foodpanda 訂單接收與處理', false, false),
      ('FOODPANDA_CATALOG_READ_ENABLED', 'foodpanda Catalog 讀取', false, false),
      ('FOODPANDA_CATALOG_WRITE_ENABLED', 'foodpanda Catalog 更新', false, false),
      ('FOODPANDA_OUTLET_ENABLED', 'foodpanda Outlet 管理', false, false),
      ('FOODPANDA_PRODUCT_CREATE_BETA_ENABLED', 'foodpanda Add Products Beta', false, false),
      ('UBER_EATS_ORDERS_ENABLED', 'Uber Eats 訂單接收與處理', false, false),
      ('UBER_EATS_MENU_READ_ENABLED', 'Uber Eats Menu 讀取', false, false),
      ('UBER_EATS_MENU_FULL_WRITE_ENABLED', 'Uber Eats 完整 Menu 寫入', false, false),
      ('UBER_EATS_MENU_ITEM_WRITE_ENABLED', 'Uber Eats 單品稀疏更新', false, false),
      ('UBER_EATS_STORE_READ_ENABLED', 'Uber Eats Store 讀取', false, false),
      ('UBER_EATS_STORE_STATUS_WRITE_ENABLED', 'Uber Eats Store 狀態更新', false, false),
      ('UBER_EATS_HOLIDAY_HOURS_WRITE_ENABLED', 'Uber Eats Holiday Hours 更新', false, false),
      ('UBER_EATS_STORE_ACTIVATION_ENABLED', 'Uber Eats Store 啟用', false, false),
      ('UBER_EATS_REPORTS_READ_ENABLED', 'Uber Eats Reports 讀取', false, false),
      ('UBER_EATS_ORDER_READY_ENABLED', 'Uber Eats Order Ready API generation', false, false),
      ('UBER_EATS_ORDER_READY_TIME_ENABLED', 'Uber Eats Ready Time API generation', false, false),
      ('UBER_EATS_FULFILLMENT_ISSUES_ENABLED', 'Uber Eats Fulfillment Issues', false, false)
    on conflict (code) do nothing;
  end if;
end;
$$;

commit;
