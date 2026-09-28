-- Sandbox workflow extends the existing merchant payment ledger; never SaaS billing attempts.
create table public.line_platform_payment_attempts (
  transaction_id uuid primary key references public.payment_provider_transactions(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  environment text not null check (environment in ('local','preview')),
  state text not null check (state in ('REQUESTING','PENDING_AUTH','CONFIRMING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN','MANUAL_REVIEW')),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  return_state_hash text not null unique check (return_state_hash ~ '^[0-9a-f]{64}$'),
  return_expires_at timestamptz not null,
  credential_reference text not null,
  credential_version text not null,
  merchant_reference text not null,
  channel_id text not null check (channel_id ~ '^[0-9]+$'),
  api_version text not null default 'v4' check (api_version = 'v4'),
  callback_origin text not null,
  partial_refund_enabled boolean not null default false,
  action_url_ciphertext text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index line_platform_payment_one_active_order on public.line_platform_payment_attempts(order_id)
  where state in ('REQUESTING','PENDING_AUTH','CONFIRMING','UNKNOWN','MANUAL_REVIEW');

create table public.line_platform_payment_operations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.line_platform_payment_attempts(transaction_id) on delete restrict,
  refund_id uuid references public.payment_provider_refunds(id) on delete restrict,
  kind text not null check (kind in ('REQUEST','CHECK','CONFIRM','REFUND')),
  operation_key text not null,
  status text not null check (status in ('IN_FLIGHT','SUCCEEDED','FAILED','UNKNOWN')),
  fence uuid not null,
  lease_expires_at timestamptz not null,
  evidence jsonb,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(transaction_id, kind, operation_key)
);
create unique index line_platform_payment_one_inflight on public.line_platform_payment_operations(transaction_id) where status='IN_FLIGHT';
create index line_platform_payment_recovery on public.line_platform_payment_operations(status, lease_expires_at);
alter table public.payment_provider_refunds drop constraint payment_provider_refunds_status_check;
alter table public.payment_provider_refunds add constraint payment_provider_refunds_status_check
  check (status in ('REQUESTED','PROCESSING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN'));

create function app_private.guard_line_platform_pending_payment() returns trigger
language plpgsql set search_path = pg_catalog, public, app_private as $$
declare v_order_id uuid; v_authorized text;
begin
  if tg_table_name='orders' then v_order_id := new.id; else v_order_id := new.order_id; end if;
  v_authorized := current_setting('app.line_platform_payment_transaction', true);
  if tg_table_name='orders' then
    if not (new.payment_status is distinct from old.payment_status
      or new.total is distinct from old.total
      or (new.status is distinct from old.status and new.status in ('CANCELLED','EXPIRED','COMPLETED'))) then return new; end if;
  end if;
  -- Holding an uncertain payment cannot be bypassed by cash checkout, expiry or edit.
  if exists(select 1 from public.line_platform_payment_attempts a where a.order_id=v_order_id
    and a.state in ('REQUESTING','PENDING_AUTH','CONFIRMING','UNKNOWN','MANUAL_REVIEW')
    and a.transaction_id::text is distinct from v_authorized)
    or exists(select 1 from public.payment_provider_refunds r join public.payment_provider_transactions t on t.id=r.transaction_id
      where t.order_id=v_order_id and r.status in ('REQUESTED','PROCESSING','UNKNOWN') and t.id::text is distinct from v_authorized) then
    raise exception 'LINE_PAY_PAYMENT_UNRESOLVED' using errcode='23514';
  end if;
  return new;
end $$;
create trigger orders_line_platform_pending_payment before update on public.orders
  for each row execute function app_private.guard_line_platform_pending_payment();
create trigger payments_line_platform_pending_payment before insert on public.payments
  for each row execute function app_private.guard_line_platform_pending_payment();

create function app_private.guard_line_platform_payment_snapshot() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and (new.transaction_id,new.order_id,new.environment,new.request_fingerprint,new.return_state_hash,
    new.credential_reference,new.credential_version,new.merchant_reference,new.channel_id,new.api_version,new.callback_origin)
    is distinct from (old.transaction_id,old.order_id,old.environment,old.request_fingerprint,old.return_state_hash,
    old.credential_reference,old.credential_version,old.merchant_reference,old.channel_id,old.api_version,old.callback_origin) then
    raise exception 'LINE_PAY_SNAPSHOT_IMMUTABLE' using errcode='23514';
  end if;
  if not exists(select 1 from public.payment_provider_transactions t where t.id=new.transaction_id and t.order_id=new.order_id and t.provider='LINE_PAY') then
    raise exception 'LINE_PAY_TRANSACTION_SCOPE_INVALID' using errcode='23514';
  end if;
  return new;
end $$;
create trigger line_platform_payment_snapshot before insert or update on public.line_platform_payment_attempts
  for each row execute function app_private.guard_line_platform_payment_snapshot();
revoke all on function app_private.guard_line_platform_payment_snapshot() from public,anon,authenticated;

alter table public.line_platform_payment_attempts enable row level security;
alter table public.line_platform_payment_attempts force row level security;
alter table public.line_platform_payment_operations enable row level security;
alter table public.line_platform_payment_operations force row level security;
revoke all on public.line_platform_payment_attempts,public.line_platform_payment_operations from public,anon,authenticated;
grant select,insert,update,delete on public.line_platform_payment_attempts,public.line_platform_payment_operations to service_role;
revoke all on function app_private.guard_line_platform_pending_payment() from public,anon,authenticated;
create trigger backend_writable_guard before insert or update or delete on public.line_platform_payment_attempts
  for each statement execute function app_private.enforce_backend_writable();
create trigger backend_writable_guard before insert or update or delete on public.line_platform_payment_operations
  for each statement execute function app_private.enforce_backend_writable();
