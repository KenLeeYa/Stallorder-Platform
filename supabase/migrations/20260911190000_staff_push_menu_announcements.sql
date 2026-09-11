-- Opt-in staff notifications. Browser DB roles cannot read endpoints or credentials.
create table public.stall_menu_announcements (
  stall_id uuid primary key references public.stalls(id) on delete cascade,
  enabled boolean not null default false,
  title varchar(80) not null default '',
  content varchar(2000) not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  constraint menu_announcement_range check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint menu_announcement_content check (not enabled or (length(trim(title)) > 0 and length(trim(content)) > 0))
);
create table public.staff_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  stall_id uuid not null references public.stalls(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  session_family_id uuid not null,
  session_version integer not null,
  endpoint_hash varchar(64) not null unique,
  encrypted_subscription text not null,
  vapid_key_hash varchar(64) not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_push_subscription_stall_idx on public.staff_push_subscriptions(stall_id, enabled);
create index staff_push_subscription_owner_idx on public.staff_push_subscriptions(profile_id, session_family_id);
create table public.staff_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.staff_push_subscriptions(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  lease_token uuid,
  claimed_at timestamptz,
  error_code varchar(80),
  sent_at timestamptz,
  displayed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(subscription_id, order_id)
);
create index staff_push_delivery_queue_idx on public.staff_push_deliveries(status, available_at);
create index staff_push_delivery_subscription_idx on public.staff_push_deliveries(subscription_id, created_at desc);

alter table public.stall_menu_announcements enable row level security;
alter table public.staff_push_subscriptions enable row level security;
alter table public.staff_push_deliveries enable row level security;
revoke all on public.stall_menu_announcements, public.staff_push_subscriptions, public.staff_push_deliveries from public, anon, authenticated;
grant all on public.stall_menu_announcements, public.staff_push_subscriptions, public.staff_push_deliveries to service_role;

-- The order transaction covers every creation path, including Edge RPC.
-- Only INSERT queues delivery; payment, amendment and completion updates never alert.
create function app_private.enqueue_staff_new_order_push()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status::text in ('CANCELLED', 'EXPIRED', 'COMPLETED') or new.source = 'OFFLINE_POS' then
    return new;
  end if;
  insert into public.staff_push_deliveries(subscription_id, order_id)
  select id, new.id from public.staff_push_subscriptions
  where stall_id = new.stall_id and enabled
  on conflict (subscription_id, order_id) do nothing;
  return new;
end;
$$;
revoke all on function app_private.enqueue_staff_new_order_push() from public, anon, authenticated;
create trigger staff_new_order_push after insert on public.orders
for each row execute function app_private.enqueue_staff_new_order_push();
