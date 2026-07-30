begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);

select has_table('public', 'offline_order_sync_receipts', 'offline sync receipts exist');
select has_table('public', 'offline_sync_conflicts', 'offline sync conflicts exist');
select has_table('public', 'domain_outbox', 'transactional outbox exists');
select has_table('public', 'domain_inbox', 'idempotent inbox exists');

select has_column('public', 'orders', 'origin', 'orders retain authoritative origin');
select has_column('public', 'orders', 'source_device_id', 'orders retain source device');
select has_column('public', 'orders', 'offline_order_id', 'orders retain local order identity');
select has_column('public', 'orders', 'menu_snapshot_version', 'orders retain menu snapshot version');
select has_column('public', 'payments', 'offline_payment_method', 'payments retain offline method');
select has_column('public', 'payments', 'reconciliation_status', 'manual payments retain reconciliation state');
select has_column('public', 'print_jobs', 'offline_print_job_id', 'print jobs retain offline deduplication id');
select has_column('public', 'offline_stall_runtime_policy', 'max_manual_payment_amount', 'policy bounds each manual payment');
select has_column('public', 'offline_stall_runtime_policy', 'max_total_manual_payment_amount', 'policy bounds total manual payments');

select ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_class
    where oid in (
      'public.offline_order_sync_receipts'::regclass,
      'public.offline_sync_conflicts'::regclass,
      'public.domain_outbox'::regclass,
      'public.domain_inbox'::regclass
    )
  ),
  'all offline synchronization tables enable and force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.offline_order_sync_receipts', 'SELECT')
  and not has_table_privilege('anon', 'public.offline_sync_conflicts', 'SELECT')
  and not has_table_privilege('anon', 'public.domain_outbox', 'SELECT')
  and not has_table_privilege('anon', 'public.domain_inbox', 'SELECT'),
  'anonymous clients cannot inspect offline synchronization records'
);

select ok(
  not has_table_privilege('authenticated', 'public.offline_order_sync_receipts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.offline_sync_conflicts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.domain_outbox', 'INSERT')
  and not has_table_privilege('authenticated', 'public.domain_inbox', 'INSERT'),
  'authenticated clients cannot write trusted synchronization records'
);

select ok(
  has_table_privilege('service_role', 'public.offline_order_sync_receipts', 'INSERT')
  and has_table_privilege('service_role', 'public.offline_sync_conflicts', 'UPDATE')
  and has_table_privilege('service_role', 'public.domain_outbox', 'INSERT')
  and has_table_privilege('service_role', 'public.domain_inbox', 'UPDATE'),
  'trusted server role can process synchronization records'
);

select has_index(
  'public',
  'orders',
  'orders_offline_device_order_unique',
  'offline order identity is unique per source device'
);
select has_index(
  'public',
  'orders',
  'orders_offline_idempotency_unique',
  'offline order idempotency key has a database uniqueness guard'
);
select has_index(
  'public',
  'print_jobs',
  'print_jobs_offline_job_unique',
  'offline print jobs are deduplicated'
);
select has_index(
  'public',
  'cash_movements',
  'cash_movements_offline_event_unique',
  'offline cash events are deduplicated'
);

select is(
  (
    select array_agg(enumlabel::text order by enumsortorder)
    from pg_enum
    where enumtypid = 'public.order_origin'::regtype
  ),
  array[
    'ONLINE_QR',
    'ONLINE_STAFF',
    'OFFLINE_POS',
    'IMPORTED',
    'TEST',
    'SYSTEM_CANARY'
  ]::text[],
  'order origin distinguishes online, offline, imported and non-billable records'
);

select ok(
  exists (
    select 1
    from pg_enum
    where enumtypid = 'public.payment_status'::regtype
      and enumlabel = 'PENDING_RECONCILIATION'
  ),
  'payment status supports manual-payment reconciliation'
);

select has_index(
  'public',
  'offline_order_sync_receipts',
  'offline_order_sync_receipts_device_id_offline_order_id_key',
  'receipt identity is unique per device and offline order'
);
select has_index(
  'public',
  'offline_order_sync_receipts',
  'offline_order_sync_receipts_idempotency_key_key',
  'receipt idempotency key is globally unique'
);
select has_index(
  'public',
  'domain_inbox',
  'domain_inbox_source_message_key_key',
  'inbox source message key is unique'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'offline_order_sync_receipts',
        'offline_sync_conflicts',
        'domain_outbox',
        'domain_inbox'
      )
  ),
  0,
  'trusted synchronization tables expose no browser-facing RLS policies'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where not tgisinternal
      and tgname = 'backend_writable_guard'
      and tgrelid in (
        'public.offline_order_sync_receipts'::regclass,
        'public.offline_sync_conflicts'::regclass,
        'public.domain_outbox'::regclass,
        'public.domain_inbox'::regclass
      )
  ),
  4,
  'all trusted synchronization tables are fenced to the active writer'
);

select is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'origin'
  ),
  '''ONLINE_QR''::order_origin',
  'legacy order creation remains backward compatible with online QR origin'
);

select ok(
  not has_function_privilege('anon', 'app_private.validate_offline_sync_scope()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.validate_offline_sync_scope()', 'EXECUTE'),
  'scope validation helpers cannot be invoked by browser roles'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_offline_origin_fields_check'
  ),
  'offline provenance fields are enforced as one atomic shape'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_offline_reconciliation_check'
  ),
  'offline payment reconciliation states are database constrained'
);

select * from finish();
rollback;
