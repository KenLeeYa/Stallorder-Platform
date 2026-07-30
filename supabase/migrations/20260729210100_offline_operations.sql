create type public.order_origin as enum (
  'ONLINE_QR',
  'ONLINE_STAFF',
  'OFFLINE_POS',
  'IMPORTED',
  'TEST',
  'SYSTEM_CANARY'
);

alter table public.orders
  add column origin public.order_origin,
  add column source_device_id uuid
    references public.client_devices(id) on delete restrict,
  add column offline_order_id uuid,
  add column offline_local_sequence integer,
  add column menu_snapshot_version integer,
  add column device_created_at timestamptz,
  add column server_received_at timestamptz,
  add column synced_at timestamptz,
  add column offline_sync_status text not null default 'NOT_APPLICABLE',
  add column offline_conflict_status text not null default 'NONE',
  add column device_clock_offset_ms bigint,
  add column local_display_number text;

update public.orders
set origin = case
  when is_test then 'TEST'::public.order_origin
  when source in ('STAFF_POS', 'MERCHANT_SETUP_TEST')
    then 'ONLINE_STAFF'::public.order_origin
  else 'ONLINE_QR'::public.order_origin
end
where origin is null;

alter table public.orders
  alter column origin set default 'ONLINE_QR'::public.order_origin,
  alter column origin set not null,
  add constraint orders_offline_sequence_check check (
    offline_local_sequence is null
    or offline_local_sequence between 1 and 999999999
  ),
  add constraint orders_menu_snapshot_version_check check (
    menu_snapshot_version is null or menu_snapshot_version >= 1
  ),
  add constraint orders_device_clock_offset_check check (
    device_clock_offset_ms is null
    or abs(device_clock_offset_ms) <= 86400000
  ),
  add constraint orders_offline_sync_status_check check (
    offline_sync_status in (
      'NOT_APPLICABLE',
      'SYNCED',
      'SYNCED_WITH_CONFLICT',
      'REJECTED'
    )
  ),
  add constraint orders_offline_conflict_status_check check (
    offline_conflict_status in ('NONE', 'OPEN', 'RESOLVED')
  ),
  add constraint orders_local_display_number_check check (
    local_display_number is null
    or local_display_number ~ '^OFF-[A-F0-9]{6}-[0-9]{8}-[0-9]{1,9}$'
  ),
  add constraint orders_offline_origin_fields_check check (
    (
      origin = 'OFFLINE_POS'::public.order_origin
      and source_device_id is not null
      and offline_order_id is not null
      and offline_local_sequence is not null
      and menu_snapshot_version is not null
      and device_created_at is not null
      and server_received_at is not null
      and synced_at is not null
      and device_clock_offset_ms is not null
      and local_display_number is not null
      and offline_sync_status in ('SYNCED', 'SYNCED_WITH_CONFLICT')
    )
    or (
      origin <> 'OFFLINE_POS'::public.order_origin
      and source_device_id is null
      and offline_order_id is null
      and offline_local_sequence is null
      and menu_snapshot_version is null
      and device_created_at is null
      and server_received_at is null
      and synced_at is null
      and device_clock_offset_ms is null
      and local_display_number is null
      and offline_sync_status = 'NOT_APPLICABLE'
      and offline_conflict_status = 'NONE'
    )
  );

create unique index orders_offline_device_order_unique
  on public.orders (source_device_id, offline_order_id)
  where source_device_id is not null and offline_order_id is not null;

create unique index orders_offline_idempotency_unique
  on public.orders (idempotency_key)
  where origin = 'OFFLINE_POS'::public.order_origin;

create index orders_offline_sync_lookup
  on public.orders (stall_id, source_device_id, synced_at desc)
  where origin = 'OFFLINE_POS'::public.order_origin;

alter table public.payments
  drop constraint payments_status_valid,
  add column offline_payment_method text,
  add column reconciliation_status text,
  add constraint payments_status_valid check (
    status in (
      'PAID'::public.payment_status,
      'REFUNDED'::public.payment_status,
      'PENDING_RECONCILIATION'::public.payment_status
    )
  ),
  add constraint payments_offline_method_check check (
    offline_payment_method is null
    or offline_payment_method in (
      'CASH',
      'MANUAL_LINE_PAY',
      'MANUAL_JKOPAY',
      'OTHER_MANUAL'
    )
  ),
  add constraint payments_reconciliation_status_check check (
    reconciliation_status is null
    or reconciliation_status in (
      'PENDING_RECONCILIATION',
      'RECONCILED',
      'REJECTED'
    )
  ),
  add constraint payments_offline_reconciliation_check check (
    (
      offline_payment_method is null
      and reconciliation_status is null
      and status <> 'PENDING_RECONCILIATION'::public.payment_status
    )
    or (
      offline_payment_method = 'CASH'
      and (
        (
          reconciliation_status is null
          and status in (
            'PAID'::public.payment_status,
            'REFUNDED'::public.payment_status
          )
        )
        or (
          status = 'PENDING_RECONCILIATION'::public.payment_status
          and reconciliation_status = 'PENDING_RECONCILIATION'
        )
      )
    )
    or (
      offline_payment_method in (
        'MANUAL_LINE_PAY',
        'MANUAL_JKOPAY',
        'OTHER_MANUAL'
      )
      and (
        (
          status = 'PENDING_RECONCILIATION'::public.payment_status
          and reconciliation_status = 'PENDING_RECONCILIATION'
        )
        or (
          status in (
            'PAID'::public.payment_status,
            'REFUNDED'::public.payment_status
          )
          and reconciliation_status in ('RECONCILED', 'REJECTED')
        )
      )
    )
  );

create index payments_offline_reconciliation_queue
  on public.payments (
    organization_id,
    stall_id,
    reconciliation_status,
    created_at
  )
  where reconciliation_status = 'PENDING_RECONCILIATION';

alter table public.print_jobs
  add column offline_print_job_id uuid,
  add column template_version text,
  add constraint print_jobs_template_version_check check (
    template_version is null
    or template_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'
  );

create unique index print_jobs_offline_job_unique
  on public.print_jobs (offline_print_job_id)
  where offline_print_job_id is not null;

create unique index cash_movements_offline_event_unique
  on public.cash_movements (cash_shift_id, reference_type, reference_id)
  where reference_type = 'OFFLINE_CASH_EVENT'
    and reference_id is not null;

alter table public.offline_stall_runtime_policy
  add column max_manual_payment_amount integer not null default 2000
    check (max_manual_payment_amount between 0 and 100000000),
  add column max_total_manual_payment_amount integer not null default 5000
    check (max_total_manual_payment_amount between 0 and 100000000),
  add column require_customer_contact_above_amount integer not null default 1000
    check (require_customer_contact_above_amount between 0 and 100000000),
  add column manager_approval_threshold integer not null default 1500
    check (manager_approval_threshold between 0 and 100000000),
  add constraint offline_policy_manual_payment_limits_check check (
    max_manual_payment_amount <= max_single_order_amount
    and max_total_manual_payment_amount <= max_total_amount
    and (
      require_customer_contact_above_amount = 0
      or require_customer_contact_above_amount <= max_manual_payment_amount
    )
    and (
      manager_approval_threshold = 0
      or manager_approval_threshold <= max_manual_payment_amount
    )
  );

create table public.offline_order_sync_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  device_id uuid not null
    references public.client_devices(id) on delete restrict,
  offline_order_id uuid not null,
  idempotency_key uuid not null,
  order_id uuid not null
    references public.orders(id) on delete restrict,
  outcome text not null
    check (outcome in (
      'ACCEPTED',
      'ACCEPTED_WITH_CONFLICT',
      'DUPLICATE'
    )),
  local_display_number text not null
    check (local_display_number ~ '^OFF-[A-F0-9]{6}-[0-9]{8}-[0-9]{1,9}$'),
  canonical_order_number text not null,
  promotion_epoch bigint not null
    check (promotion_epoch >= 1),
  server_received_at timestamptz not null,
  synced_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  unique (device_id, offline_order_id),
  unique (idempotency_key),
  unique (order_id),
  constraint offline_sync_receipts_expiry_check check (
    expires_at > synced_at
  )
);

create index offline_sync_receipts_device_created
  on public.offline_order_sync_receipts (device_id, created_at desc);

create index offline_sync_receipts_stall_expiry
  on public.offline_order_sync_receipts (stall_id, expires_at);

create table public.offline_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  device_id uuid not null
    references public.client_devices(id) on delete restrict,
  receipt_id uuid
    references public.offline_order_sync_receipts(id) on delete set null,
  order_id uuid
    references public.orders(id) on delete set null,
  local_entity_type text not null default 'ORDER'
    check (local_entity_type in ('ORDER', 'CASH_EVENT', 'PRINT_JOB')),
  local_entity_id uuid not null,
  offline_order_id uuid,
  conflict_type text not null
    check (conflict_type in (
      'MENU_VERSION_EXPIRED',
      'PRICE_CHANGED',
      'PRODUCT_DISABLED',
      'PRODUCT_DELETED',
      'ROLE_CHANGED',
      'DEVICE_REVOKED',
      'INVALID_STATE_TRANSITION',
      'DUPLICATE_ORDER',
      'PAYMENT_RECONCILIATION_REQUIRED',
      'CLOCK_SKEW',
      'BACKEND_EPOCH_CHANGED',
      'CASH_TOTAL_MISMATCH',
      'PRINT_STATUS_UNKNOWN',
      'UNKNOWN_REFERENCE',
      'SHIFT_ALREADY_CLOSED',
      'DUPLICATE_CASH_MOVEMENT',
      'MULTIPLE_OFFLINE_SHIFT'
    )),
  resolution_status text not null default 'OPEN'
    check (resolution_status in (
      'OPEN',
      'AUTO_RESOLVED',
      'ACCEPTED_LOCAL',
      'MERGED',
      'REJECTED',
      'CANCELLED'
    )),
  details_json jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(details_json) = 'object'
      and pg_column_size(details_json) <= 32768
    ),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_profile_id uuid
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, local_entity_type, local_entity_id, conflict_type),
  constraint offline_sync_conflict_resolution_check check (
    (
      resolution_status = 'OPEN'
      and resolved_at is null
      and resolved_by_profile_id is null
    )
    or (
      resolution_status <> 'OPEN'
      and resolved_at is not null
    )
  )
);

create index offline_sync_conflicts_stall_resolution
  on public.offline_sync_conflicts (
    organization_id,
    stall_id,
    resolution_status,
    detected_at desc
  );

create index offline_sync_conflicts_device_order
  on public.offline_sync_conflicts (
    device_id,
    offline_order_id,
    detected_at desc
  );

create table public.domain_outbox (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  aggregate_type text not null
    check (aggregate_type ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  aggregate_id uuid not null,
  event_type text not null
    check (event_type ~ '^[A-Z][A-Z0-9_]{0,119}$'),
  dedupe_key text not null
    check (char_length(dedupe_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(payload) = 'object'
      and pg_column_size(payload) <= 65536
    ),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 100),
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z0-9_]{1,120}$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);

create index domain_outbox_delivery_queue
  on public.domain_outbox (status, available_at, created_at)
  where status in ('PENDING', 'FAILED');

create table public.domain_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  stall_id uuid not null
    references public.stalls(id) on delete cascade,
  device_id uuid
    references public.client_devices(id) on delete restrict,
  source text not null
    check (source ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  message_key text not null
    check (char_length(message_key) between 1 and 200),
  payload_hash text not null
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'RECEIVED'
    check (status in ('RECEIVED', 'PROCESSED', 'REJECTED')),
  result_json jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(result_json) = 'object'
      and pg_column_size(result_json) <= 32768
    ),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, message_key),
  constraint domain_inbox_processing_check check (
    (status = 'RECEIVED' and processed_at is null)
    or (status <> 'RECEIVED' and processed_at is not null)
  )
);

create index domain_inbox_device_received
  on public.domain_inbox (device_id, received_at desc);

create or replace function app_private.validate_offline_order_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.origin is distinct from old.origin
    or new.source_device_id is distinct from old.source_device_id
    or new.offline_order_id is distinct from old.offline_order_id
    or new.offline_local_sequence is distinct from old.offline_local_sequence
    or new.menu_snapshot_version is distinct from old.menu_snapshot_version
    or new.device_created_at is distinct from old.device_created_at
    or new.server_received_at is distinct from old.server_received_at
    or new.synced_at is distinct from old.synced_at
    or new.device_clock_offset_ms is distinct from old.device_clock_offset_ms
    or new.local_display_number is distinct from old.local_display_number
  ) then
    raise exception 'OFFLINE_ORDER_IDENTITY_IMMUTABLE'
      using errcode = '23514';
  end if;

  if new.origin = 'OFFLINE_POS'::public.order_origin and not exists (
    select 1
    from public.client_devices device
    where device.id = new.source_device_id
      and device.organization_id = new.organization_id
      and device.stall_id = new.stall_id
  ) then
    raise exception 'OFFLINE_ORDER_DEVICE_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger orders_validate_offline_scope
before insert or update on public.orders
for each row execute function app_private.validate_offline_order_scope();

create or replace function app_private.validate_offline_sync_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
declare
  v_device_id uuid;
  v_order_id uuid;
begin
  v_device_id := new.device_id;
  v_order_id := case
    when tg_table_name = 'offline_order_sync_receipts' then new.order_id
    else new.order_id
  end;

  if not exists (
    select 1
    from public.client_devices device
    where device.id = v_device_id
      and device.organization_id = new.organization_id
      and device.stall_id = new.stall_id
  ) then
    raise exception 'OFFLINE_SYNC_DEVICE_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if v_order_id is not null and not exists (
    select 1
    from public.orders order_record
    where order_record.id = v_order_id
      and order_record.organization_id = new.organization_id
      and order_record.stall_id = new.stall_id
  ) then
    raise exception 'OFFLINE_SYNC_ORDER_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger offline_sync_receipts_validate_scope
before insert or update on public.offline_order_sync_receipts
for each row execute function app_private.validate_offline_sync_scope();

create trigger offline_sync_conflicts_validate_scope
before insert or update on public.offline_sync_conflicts
for each row execute function app_private.validate_offline_sync_scope();

create or replace function app_private.validate_domain_message_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.stall_id is distinct from old.stall_id
    or new.aggregate_type is distinct from old.aggregate_type
    or new.aggregate_id is distinct from old.aggregate_id
    or new.event_type is distinct from old.event_type
    or new.dedupe_key is distinct from old.dedupe_key
    or new.payload is distinct from old.payload
  ) then
    raise exception 'DOMAIN_OUTBOX_EVENT_IMMUTABLE'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.stalls stall
    where stall.id = new.stall_id
      and stall.organization_id = new.organization_id
  ) then
    raise exception 'DOMAIN_MESSAGE_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger domain_outbox_validate_scope
before insert or update on public.domain_outbox
for each row execute function app_private.validate_domain_message_scope();

create or replace function app_private.validate_domain_inbox_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.stall_id is distinct from old.stall_id
    or new.device_id is distinct from old.device_id
    or new.source is distinct from old.source
    or new.message_key is distinct from old.message_key
    or new.payload_hash is distinct from old.payload_hash
  ) then
    raise exception 'DOMAIN_INBOX_IDENTITY_IMMUTABLE'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.stalls stall
    where stall.id = new.stall_id
      and stall.organization_id = new.organization_id
  ) then
    raise exception 'DOMAIN_MESSAGE_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  if new.device_id is not null and not exists (
    select 1
    from public.client_devices device
    where device.id = new.device_id
      and device.organization_id = new.organization_id
      and device.stall_id = new.stall_id
  ) then
    raise exception 'DOMAIN_INBOX_DEVICE_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger domain_inbox_validate_scope
before insert or update on public.domain_inbox
for each row execute function app_private.validate_domain_inbox_scope();

create trigger offline_sync_conflicts_touch_updated_at
before update on public.offline_sync_conflicts
for each row execute function app_private.touch_offline_foundation_updated_at();

create trigger domain_outbox_touch_updated_at
before update on public.domain_outbox
for each row execute function app_private.touch_offline_foundation_updated_at();

create trigger domain_inbox_touch_updated_at
before update on public.domain_inbox
for each row execute function app_private.touch_offline_foundation_updated_at();

select app_private.install_backend_writable_guard(
  'public.offline_order_sync_receipts'::regclass
);
select app_private.install_backend_writable_guard(
  'public.offline_sync_conflicts'::regclass
);
select app_private.install_backend_writable_guard(
  'public.domain_outbox'::regclass
);
select app_private.install_backend_writable_guard(
  'public.domain_inbox'::regclass
);

alter table public.offline_order_sync_receipts enable row level security;
alter table public.offline_order_sync_receipts force row level security;
alter table public.offline_sync_conflicts enable row level security;
alter table public.offline_sync_conflicts force row level security;
alter table public.domain_outbox enable row level security;
alter table public.domain_outbox force row level security;
alter table public.domain_inbox enable row level security;
alter table public.domain_inbox force row level security;

revoke all on table public.offline_order_sync_receipts
  from public, anon, authenticated;
revoke all on table public.offline_sync_conflicts
  from public, anon, authenticated;
revoke all on table public.domain_outbox
  from public, anon, authenticated;
revoke all on table public.domain_inbox
  from public, anon, authenticated;

grant select, insert on table public.offline_order_sync_receipts
  to service_role;
grant select, insert, update on table public.offline_sync_conflicts
  to service_role;
grant select, insert, update on table public.domain_outbox
  to service_role;
grant select, insert, update on table public.domain_inbox
  to service_role;

revoke all on function app_private.validate_offline_order_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_offline_sync_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_domain_message_scope()
  from public, anon, authenticated, service_role;
revoke all on function app_private.validate_domain_inbox_scope()
  from public, anon, authenticated, service_role;

create or replace function public.record_order_usage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stall_timezone text;
begin
  if new.is_test
    or new.origin in (
      'TEST'::public.order_origin,
      'SYSTEM_CANARY'::public.order_origin
    ) then
    return new;
  end if;

  select stall.timezone
  into stall_timezone
  from public.stalls stall
  where stall.id = new.stall_id;

  insert into public.usage_events (
    organization_id,
    stall_id,
    event_type,
    quantity,
    billing_period,
    reference_id,
    occurred_at
  ) values (
    new.organization_id,
    new.stall_id,
    'ORDER_CREATED',
    1,
    date_trunc(
      'month',
      new.created_at at time zone coalesce(stall_timezone, 'Asia/Taipei')
    )::date,
    new.id::text,
    new.created_at
  ) on conflict do nothing;

  return new;
end;
$$;

create or replace function public.record_billable_order_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date;
begin
  if not new.is_test
    and new.origin not in (
      'TEST'::public.order_origin,
      'SYSTEM_CANARY'::public.order_origin
    )
    and new.status = 'COMPLETED'::public.order_status
    and (
      tg_op = 'INSERT'
      or old.status <> 'COMPLETED'::public.order_status
    ) then
    perform 1
    from public.subscriptions subscription
    where subscription.organization_id = new.organization_id
    for update;

    v_period := date_trunc(
      'month',
      coalesce(new.completed_at, now())
    )::date;

    insert into public.usage_events (
      organization_id,
      stall_id,
      event_type,
      quantity,
      billing_period,
      reference_type,
      reference_id,
      occurred_at
    ) values (
      new.organization_id,
      new.stall_id,
      'BILLABLE_ORDER_COMPLETED',
      1,
      v_period,
      'ORDER',
      new.id::text,
      coalesce(new.completed_at, now())
    ) on conflict do nothing;

    perform public.rebuild_billing_usage_summary(
      new.organization_id,
      v_period
    );
    perform public.reconcile_billing_usage_warnings(
      new.organization_id,
      v_period
    );
  end if;

  return null;
end;
$$;

revoke all on function public.record_order_usage()
  from public, anon, authenticated;
revoke all on function public.record_billable_order_completed()
  from public, anon, authenticated;

comment on column public.orders.origin is
  'Authoritative order origin. OFFLINE_POS rows retain device and snapshot provenance.';
comment on table public.offline_order_sync_receipts is
  'Immutable idempotent acknowledgements for accepted offline order imports.';
comment on table public.offline_sync_conflicts is
  'Durable operator-visible offline reconciliation conflicts; records are never silently discarded.';
comment on table public.domain_outbox is
  'Transactional side-effect queue. Payloads must exclude credentials and customer notes.';
comment on table public.domain_inbox is
  'Inbound message deduplication registry. Only payload hashes and safe result metadata are stored.';
