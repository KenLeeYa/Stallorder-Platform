-- Customer pickup display settings with hash-only access tokens and least-privilege RLS.

create table public.pickup_display_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  display_token_hash text,
  show_customer_name boolean not null default false,
  show_pickup_code boolean not null default true,
  mask_pickup_code boolean not null default false,
  ready_retention_minutes integer not null default 30,
  preparing_retention_minutes integer not null default 180,
  enable_voice boolean not null default false,
  voice_locale text not null default 'zh-TW',
  announcement_text text,
  theme_json jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickup_display_settings_stall_unique unique (stall_id),
  constraint pickup_display_settings_token_unique unique (display_token_hash),
  constraint pickup_display_settings_token_hash_check check (
    display_token_hash is null or display_token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint pickup_display_settings_ready_retention_check check (
    ready_retention_minutes between 1 and 240
  ),
  constraint pickup_display_settings_preparing_retention_check check (
    preparing_retention_minutes between 15 and 1440
  ),
  constraint pickup_display_settings_voice_locale_check check (
    voice_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  ),
  constraint pickup_display_settings_announcement_length_check check (
    announcement_text is null or char_length(announcement_text) between 1 and 300
  ),
  constraint pickup_display_settings_theme_object_check check (
    theme_json is null or jsonb_typeof(theme_json) = 'object'
  )
);

create index pickup_display_settings_scope_idx
  on public.pickup_display_settings (organization_id, stall_id, is_active);

create or replace function public.touch_pickup_display_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_pickup_display_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.stalls stall
    where stall.id = new.stall_id
      and stall.organization_id = new.organization_id
  ) then
    raise exception 'PICKUP_DISPLAY_STALL_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function public.create_default_pickup_display_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.pickup_display_settings (organization_id, stall_id)
  values (new.organization_id, new.id)
  on conflict (stall_id) do nothing;
  return new;
end;
$$;

create trigger pickup_display_settings_touch_before_update
before update on public.pickup_display_settings
for each row execute function public.touch_pickup_display_updated_at();

create trigger pickup_display_settings_scope_before_write
before insert or update on public.pickup_display_settings
for each row execute function public.enforce_pickup_display_scope();

create trigger stalls_create_default_pickup_display_settings
after insert on public.stalls
for each row execute function public.create_default_pickup_display_settings();

insert into public.pickup_display_settings (organization_id, stall_id)
select stall.organization_id, stall.id
from public.stalls stall
on conflict (stall_id) do nothing;

alter table public.operational_alerts
  drop constraint if exists operational_alerts_alert_type_check;
alter table public.operational_alerts
  add constraint operational_alerts_alert_type_check check (alert_type in (
    'EXCESSIVE_PENDING_ORDERS', 'HIGH_CANCELLATION_RATE', 'PAYMENT_MISMATCH',
    'ORDERING_PAUSED', 'STALL_OFFLINE', 'NO_RECENT_ACTIVITY',
    'UNPAID_COMPLETED_ORDER', 'KDS_ORDER_OVERDUE', 'STATION_BACKLOG',
    'CDS_DISCONNECTED'
  ));

alter table public.pickup_display_settings enable row level security;
alter table public.pickup_display_settings force row level security;
revoke all on table public.pickup_display_settings from public, anon, authenticated;
grant select on table public.pickup_display_settings to authenticated;
grant select, insert, update, delete on table public.pickup_display_settings to service_role;

create policy pickup_display_settings_manager_select
on public.pickup_display_settings
for select to authenticated
using (public.can_manage_stall(stall_id));

revoke all on function public.touch_pickup_display_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_pickup_display_scope() from public, anon, authenticated;
revoke all on function public.create_default_pickup_display_settings() from public, anon, authenticated;
grant execute on function public.touch_pickup_display_updated_at() to service_role;
grant execute on function public.enforce_pickup_display_scope() to service_role;
grant execute on function public.create_default_pickup_display_settings() to service_role;

insert into public.plan_entitlements (
  plan_version_id, feature_code, is_enabled, limit_value, configuration_json
)
select version.id, 'CDS', true, 1,
  jsonb_build_object(
    'voiceAnnouncements', plan.code in ('STANDARD', 'PRO', 'ENTERPRISE')
  )
from public.plan_versions version
join public.plans plan on plan.id = version.plan_id
where plan.code in ('TRIAL', 'LITE', 'STANDARD', 'PRO', 'ENTERPRISE')
on conflict (plan_version_id, feature_code) do update
set is_enabled = excluded.is_enabled,
    limit_value = excluded.limit_value,
    configuration_json = excluded.configuration_json,
    updated_at = now();
