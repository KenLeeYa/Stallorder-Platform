-- Restricted handoff credentials extend the original order; they are not orders.
create table public.line_platform_pickup_credentials (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.line_platform_order_owners(order_id),
  organization_id uuid not null references public.organizations(id),
  stall_id uuid not null references public.stalls(id),
  environment text not null check (environment in ('local', 'preview', 'production')),
  version integer not null check (version > 0),
  fulfillment_time_version integer not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  media_hash text not null unique check (media_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text not null,
  media_ciphertext text not null,
  expires_at timestamptz not null,
  media_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  consumed_at timestamptz,
  redeemed_by uuid references public.profiles(id),
  redemption_method text check (redemption_method in ('QR', 'MANUAL')),
  idempotency_key uuid,
  request_hash text,
  created_at timestamptz not null default now(),
  constraint line_platform_pickup_version_unique unique (order_id, version),
  constraint line_platform_pickup_media_deadline check (media_expires_at >= expires_at),
  constraint line_platform_pickup_consumption_check check (
    (consumed_at is null and redeemed_by is null and idempotency_key is null
      and request_hash is null and redemption_method is null)
    or (consumed_at is not null and redeemed_by is not null and idempotency_key is not null
      and request_hash ~ '^[0-9a-f]{64}$' and redemption_method is not null)
  )
);
create unique index line_platform_pickup_one_active_order
  on public.line_platform_pickup_credentials(order_id)
  where revoked_at is null and consumed_at is null;
create unique index line_platform_pickup_redemption_key
  on public.line_platform_pickup_credentials(environment, stall_id, idempotency_key)
  where idempotency_key is not null;
create index line_platform_pickup_order_history
  on public.line_platform_pickup_credentials(order_id, version desc);
alter table public.line_platform_pickup_credentials enable row level security;
alter table public.line_platform_pickup_credentials force row level security;
revoke all on public.line_platform_pickup_credentials from anon, authenticated;
grant select, insert, update on public.line_platform_pickup_credentials to service_role;
create unique index order_events_line_platform_pickup_once
  on public.order_events(order_id) where event_type = 'LINE_PLATFORM_PICKED_UP';

create function app_private.enforce_line_platform_pickup_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.orders o
    join public.line_platform_order_owners owner on owner.order_id = o.id
    where o.id = new.order_id and o.organization_id = new.organization_id
      and o.stall_id = new.stall_id and owner.environment = new.environment
      and o.fulfillment_type = 'TAKEOUT'
  ) then raise exception 'LINE_PLATFORM_PICKUP_SCOPE'; end if;
  if tg_op = 'UPDATE' and (
    old.order_id <> new.order_id or old.organization_id <> new.organization_id
    or old.stall_id <> new.stall_id or old.environment <> new.environment
    or old.version <> new.version or old.token_hash <> new.token_hash
    or old.media_hash <> new.media_hash or old.token_ciphertext <> new.token_ciphertext
    or old.media_ciphertext <> new.media_ciphertext or old.expires_at <> new.expires_at
    or old.media_expires_at <> new.media_expires_at
    or old.fulfillment_time_version <> new.fulfillment_time_version
    or (old.revoked_at is not null and old.revoked_at is distinct from new.revoked_at)
    or (old.consumed_at is not null and (
      old.consumed_at is distinct from new.consumed_at
      or old.redeemed_by is distinct from new.redeemed_by
      or old.idempotency_key is distinct from new.idempotency_key
      or old.request_hash is distinct from new.request_hash
      or old.redemption_method is distinct from new.redemption_method
    ))
  ) then raise exception 'LINE_PLATFORM_PICKUP_IMMUTABLE'; end if;
  return new;
end $$;
create trigger line_platform_pickup_scope_before_write
before insert or update on public.line_platform_pickup_credentials
for each row execute function app_private.enforce_line_platform_pickup_scope();

create function app_private.guard_line_platform_pickup_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The creation-time requirement applies before the first card/credential is requested.
  if new.status = 'COMPLETED' and old.status is distinct from new.status
    and (exists (select 1 from public.line_platform_order_owners owner
      where owner.order_id = new.id and owner.pickup_required)
      or exists (select 1 from public.line_platform_pickup_credentials c where c.order_id = new.id))
    and not exists (select 1 from public.line_platform_pickup_credentials c
      where c.order_id = new.id and c.consumed_at is not null) then
    raise exception 'LINE_PLATFORM_PICKUP_HANDOFF_REQUIRED';
  end if;
  return new;
end $$;
create trigger orders_line_platform_pickup_guard
before update of status on public.orders
for each row execute function app_private.guard_line_platform_pickup_completion();

create function app_private.revoke_line_platform_pickup_on_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.status in ('CANCELLED', 'EXPIRED') and old.status is distinct from new.status)
    or (new.payment_status = 'REFUNDED' and old.payment_status is distinct from new.payment_status)
    or old.fulfillment_time_version is distinct from new.fulfillment_time_version
    or old.scheduled_pickup_at is distinct from new.scheduled_pickup_at
    or old.requested_fulfillment_at is distinct from new.requested_fulfillment_at
    or old.committed_fulfillment_at is distinct from new.committed_fulfillment_at then
    update public.line_platform_pickup_credentials
    set revoked_at = now(), revoke_reason = case
      when new.status in ('CANCELLED', 'EXPIRED') or new.payment_status = 'REFUNDED'
      then 'ORDER_UNAVAILABLE' else 'SCHEDULE_CHANGED' end
    where order_id = new.id and consumed_at is null and revoked_at is null;
  end if;
  return null;
end $$;
create trigger orders_line_platform_pickup_revoke
after update of status, payment_status, fulfillment_time_version, scheduled_pickup_at, committed_fulfillment_at, requested_fulfillment_at
on public.orders for each row execute function app_private.revoke_line_platform_pickup_on_order_change();
revoke all on function app_private.enforce_line_platform_pickup_scope() from public, anon, authenticated;
revoke all on function app_private.guard_line_platform_pickup_completion() from public, anon, authenticated;
revoke all on function app_private.revoke_line_platform_pickup_on_order_change() from public, anon, authenticated;
