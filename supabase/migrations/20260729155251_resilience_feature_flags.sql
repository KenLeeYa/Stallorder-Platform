create table public.resilience_feature_flags (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  description text not null default ''
    check (char_length(description) <= 500),
  default_enabled boolean not null default false,
  is_emergency boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resilience_feature_flag_overrides (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid not null
    references public.resilience_feature_flags(id) on delete cascade,
  scope_type text not null
    check (scope_type in ('GLOBAL', 'ORGANIZATION', 'STALL', 'DEVICE', 'PERCENTAGE')),
  organization_id uuid
    references public.organizations(id) on delete cascade,
  stall_id uuid
    references public.stalls(id) on delete cascade,
  device_id uuid,
  enabled boolean not null,
  rollout_percentage smallint
    check (rollout_percentage between 0 and 100),
  expires_at timestamptz,
  reason text not null
    check (char_length(btrim(reason)) between 5 and 500),
  created_by_profile_id uuid
    references public.profiles(id) on delete set null,
  updated_by_profile_id uuid
    references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resilience_feature_flag_override_scope_check check (
    (
      scope_type = 'GLOBAL'
      and organization_id is null
      and stall_id is null
      and device_id is null
      and rollout_percentage is null
    )
    or (
      scope_type = 'ORGANIZATION'
      and organization_id is not null
      and stall_id is null
      and device_id is null
      and rollout_percentage is null
    )
    or (
      scope_type = 'STALL'
      and organization_id is not null
      and stall_id is not null
      and device_id is null
      and rollout_percentage is null
    )
    or (
      scope_type = 'DEVICE'
      and organization_id is not null
      and stall_id is not null
      and device_id is not null
      and rollout_percentage is null
    )
    or (
      scope_type = 'PERCENTAGE'
      and organization_id is null
      and stall_id is null
      and device_id is null
      and rollout_percentage is not null
    )
  )
);

create unique index resilience_feature_flag_override_scope_key
  on public.resilience_feature_flag_overrides (
    flag_id,
    scope_type,
    organization_id,
    stall_id,
    device_id
  ) nulls not distinct;

create index resilience_feature_flag_override_active
  on public.resilience_feature_flag_overrides (
    flag_id,
    scope_type,
    expires_at
  );

create index resilience_feature_flag_override_organization
  on public.resilience_feature_flag_overrides (
    organization_id,
    flag_id
  )
  where organization_id is not null;

create index resilience_feature_flag_override_stall
  on public.resilience_feature_flag_overrides (
    stall_id,
    flag_id
  )
  where stall_id is not null;

create or replace function app_private.touch_resilience_feature_flag_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.enforce_resilience_feature_flag_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app_private
as $$
begin
  if new.stall_id is not null and not exists (
    select 1
    from public.stalls
    where id = new.stall_id
      and organization_id = new.organization_id
  ) then
    raise exception 'RESILIENCE_FLAG_STALL_SCOPE_MISMATCH'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger resilience_feature_flags_touch_updated_at
before update on public.resilience_feature_flags
for each row execute function app_private.touch_resilience_feature_flag_updated_at();

create trigger resilience_feature_flag_overrides_touch_updated_at
before update on public.resilience_feature_flag_overrides
for each row execute function app_private.touch_resilience_feature_flag_updated_at();

create trigger resilience_feature_flag_overrides_scope_guard
before insert or update on public.resilience_feature_flag_overrides
for each row execute function app_private.enforce_resilience_feature_flag_scope();

insert into public.resilience_feature_flags (
  code,
  description,
  default_enabled,
  is_emergency
)
values
  ('DUAL_ORDER_INTAKE_ENABLED', '啟用兩條受信任公開訂單入口。', false, false),
  ('DR_READ_ROUTING_ENABLED', '允許符合延遲門檻的 DR 唯讀查詢。', false, false),
  ('DR_FAILOVER_ENABLED', '允許進入受控 DR 切換程序。', false, true),
  ('OFFLINE_POS_ENABLED', '允許核准裝置使用離線店員點餐。', false, false),
  ('OFFLINE_SINGLE_DEVICE_ONLY', '每個攤位離線時僅允許一台 Leader 寫入。', true, false),
  ('OFFLINE_MANUAL_PAYMENT_ENABLED', '允許離線現金或人工電子付款紀錄。', false, false),
  ('QR_DEGRADED_MENU_ENABLED', '後端不可寫入時仍提供快取菜單。', false, false),
  ('LINE_PAY_ENABLED', '允許 LINE Pay Provider 功能。', false, false),
  ('JKOPAY_ENABLED', '允許街口支付 Provider 功能。', false, false),
  ('ROLLING_RELEASE_ENABLED', '允許受控百分比發布。', false, false),
  ('LOCAL_EDGE_GATEWAY_ENABLED', '保留給未來現場 Gateway，現階段不得啟用。', false, true),
  ('EMERGENCY_QR_DEGRADED_MODE', '緊急停用 QR 寫入並顯示櫃台點餐引導。', false, true)
on conflict (code) do nothing;

alter table public.resilience_feature_flags enable row level security;
alter table public.resilience_feature_flags force row level security;
alter table public.resilience_feature_flag_overrides enable row level security;
alter table public.resilience_feature_flag_overrides force row level security;

revoke all on table public.resilience_feature_flags
  from public, anon, authenticated;
revoke all on table public.resilience_feature_flag_overrides
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.resilience_feature_flags
  to service_role;
grant select, insert, update, delete
  on table public.resilience_feature_flag_overrides
  to service_role;

revoke all on function app_private.touch_resilience_feature_flag_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function app_private.enforce_resilience_feature_flag_scope()
  from public, anon, authenticated, service_role;

comment on table public.resilience_feature_flags is
  'Server-evaluated resilience flag catalog. This is separate from commercial plan entitlements.';
comment on table public.resilience_feature_flag_overrides is
  'Audited scoped overrides for resilience flags. Expired rows are retained as history and ignored at evaluation time.';
