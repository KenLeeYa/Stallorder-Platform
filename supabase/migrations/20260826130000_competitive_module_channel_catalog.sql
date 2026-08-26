-- Competitive enhancement Phase 1-2 foundation.
-- Additive only: existing Product/StallProduct and QR ordering remain canonical
-- until a separately reviewed publication rollout enables the HQ module.

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
      ('MODULE_CORE_OPS_ENABLED', 'Core ordering, KDS, pickup and reporting module.', true, false),
      ('MODULE_GROWTH_ENABLED', 'Customer 360, consent, loyalty and growth automation module.', false, false),
      ('MODULE_OMNI_ENABLED', 'LINE, delivery, payment and invoice integration module.', false, false),
      ('MODULE_HQ_ENABLED', 'Versioned channel catalog and HQ governance module.', false, false),
      ('MODULE_SUPPLY_LITE_ENABLED', 'Ingredient, recipe and inventory ledger module.', false, false),
      ('MODULE_EVENT_GROWTH_ENABLED', 'Signed event attribution and organizer reporting module.', false, false),
      ('MODULE_PUBLIC_API_ENABLED', 'Scoped public API and outbound webhook module.', false, false),
      ('MODULE_ADVANCED_ANALYTICS_ENABLED', 'Governed advanced analytics and operational intelligence module.', false, false)
    on conflict (code) do nothing;
  end if;
end;
$$;

create function app_private.touch_competitive_enhancement_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.catalog_menu_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  menu_key text not null default 'DEFAULT',
  name text not null,
  version_number integer not null,
  status text not null default 'DRAFT',
  currency text not null default 'TWD',
  source_version_id uuid references public.catalog_menu_versions(id) on delete restrict,
  review_notes text,
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  locked_at timestamptz,
  checksum text,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  approved_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_menu_versions_scope_key unique (id, organization_id),
  constraint catalog_menu_versions_number_key unique (organization_id, menu_key, version_number),
  constraint catalog_menu_versions_menu_key_check check (menu_key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint catalog_menu_versions_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint catalog_menu_versions_version_check check (version_number between 1 and 1000000),
  constraint catalog_menu_versions_status_check check (status in (
    'DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING',
    'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'FAILED', 'ARCHIVED'
  )),
  constraint catalog_menu_versions_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint catalog_menu_versions_review_notes_check check (
    review_notes is null or char_length(review_notes) <= 1000
  ),
  constraint catalog_menu_versions_checksum_check check (
    checksum is null or checksum ~ '^[a-f0-9]{64}$'
  ),
  constraint catalog_menu_versions_schedule_check check (
    status <> 'SCHEDULED' or scheduled_publish_at is not null
  ),
  constraint catalog_menu_versions_active_check check (
    status <> 'ACTIVE' or published_at is not null
  )
);

create unique index catalog_menu_versions_one_active
  on public.catalog_menu_versions (organization_id, menu_key)
  where status = 'ACTIVE';
create index catalog_menu_versions_lifecycle_idx
  on public.catalog_menu_versions (organization_id, menu_key, status, updated_at desc);
create index catalog_menu_versions_schedule_idx
  on public.catalog_menu_versions (scheduled_publish_at, id)
  where status = 'SCHEDULED';

create table public.catalog_version_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  product_id uuid not null,
  category_id uuid,
  group_id uuid,
  product_name text not null,
  description text not null default '',
  base_price_amount integer not null,
  currency text not null default 'TWD',
  product_kind text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  modifier_snapshot jsonb not null default '[]'::jsonb,
  bundle_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint catalog_version_items_version_scope_fkey
    foreign key (version_id, organization_id)
    references public.catalog_menu_versions(id, organization_id) on delete cascade,
  constraint catalog_version_items_product_scope_fkey
    foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint catalog_version_items_version_product_key unique (version_id, product_id),
  constraint catalog_version_items_name_check check (char_length(btrim(product_name)) between 1 and 120),
  constraint catalog_version_items_price_check check (base_price_amount >= 0),
  constraint catalog_version_items_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint catalog_version_items_kind_check check (product_kind in ('SINGLE', 'BUNDLE')),
  constraint catalog_version_items_sort_check check (sort_order between 0 and 1000000),
  constraint catalog_version_items_modifier_array_check check (jsonb_typeof(modifier_snapshot) = 'array'),
  constraint catalog_version_items_bundle_array_check check (jsonb_typeof(bundle_snapshot) = 'array')
);

create index catalog_version_items_order_idx
  on public.catalog_version_items (version_id, sort_order, product_name, id);

create table public.catalog_channel_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  stall_id uuid,
  region_code text,
  channel text not null,
  product_id uuid not null,
  price_amount integer,
  visible boolean,
  availability_windows jsonb not null default '[]'::jsonb,
  available_quantity integer,
  daily_replenishment_quantity integer,
  hq_locked boolean not null default false,
  inherited_from_override_id uuid references public.catalog_channel_overrides(id) on delete set null,
  effective_from timestamptz,
  effective_until timestamptz,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_channel_overrides_version_scope_fkey
    foreign key (version_id, organization_id)
    references public.catalog_menu_versions(id, organization_id) on delete cascade,
  constraint catalog_channel_overrides_product_scope_fkey
    foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint catalog_channel_overrides_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint catalog_channel_overrides_scope_check check (
    (stall_id is not null and region_code is null)
    or (stall_id is null and region_code is not null)
  ),
  constraint catalog_channel_overrides_region_check check (
    region_code is null or region_code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'
  ),
  constraint catalog_channel_overrides_channel_check check (channel in (
    'QR', 'STAFF_POS', 'LINE_ORDERING', 'BRANDED_WEB', 'FOODPANDA',
    'UBER_EATS', 'KIOSK', 'MARKETPLACE', 'PHONE_ORDER', 'DELIVERY_PARTNER'
  )),
  constraint catalog_channel_overrides_price_check check (price_amount is null or price_amount >= 0),
  constraint catalog_channel_overrides_quantity_check check (
    available_quantity is null or available_quantity >= 0
  ),
  constraint catalog_channel_overrides_replenishment_check check (
    daily_replenishment_quantity is null or daily_replenishment_quantity >= 0
  ),
  constraint catalog_channel_overrides_windows_check check (jsonb_typeof(availability_windows) = 'array'),
  constraint catalog_channel_overrides_effective_check check (
    effective_until is null or effective_from is null or effective_until > effective_from
  )
);

create unique index catalog_channel_overrides_scope_key
  on public.catalog_channel_overrides (
    version_id,
    channel,
    product_id,
    coalesce(stall_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(region_code, '')
  );
create index catalog_channel_overrides_effective_idx
  on public.catalog_channel_overrides (
    organization_id, channel, stall_id, product_id, effective_from, effective_until
  );

create table public.catalog_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  stall_id uuid,
  channel text not null,
  status text not null default 'PENDING',
  publication_mode text not null default 'INCREMENTAL',
  idempotency_key text not null,
  target_checksum text,
  provider_job_reference text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_summary text,
  requested_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_publications_version_scope_fkey
    foreign key (version_id, organization_id)
    references public.catalog_menu_versions(id, organization_id) on delete restrict,
  constraint catalog_publications_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint catalog_publications_idempotency_key unique (organization_id, idempotency_key),
  constraint catalog_publications_channel_check check (channel in (
    'QR', 'STAFF_POS', 'LINE_ORDERING', 'BRANDED_WEB', 'FOODPANDA',
    'UBER_EATS', 'KIOSK', 'MARKETPLACE', 'PHONE_ORDER', 'DELIVERY_PARTNER'
  )),
  constraint catalog_publications_status_check check (status in (
    'PENDING', 'VALIDATING', 'PUBLISHING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
  )),
  constraint catalog_publications_mode_check check (publication_mode in ('FULL', 'INCREMENTAL', 'DRY_RUN')),
  constraint catalog_publications_key_check check (
    char_length(idempotency_key) between 16 and 160
    and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint catalog_publications_checksum_check check (
    target_checksum is null or target_checksum ~ '^[a-f0-9]{64}$'
  ),
  constraint catalog_publications_attempt_check check (
    attempt_count between 0 and max_attempts and max_attempts between 1 and 20
  ),
  constraint catalog_publications_error_check check (
    last_error_summary is null or char_length(last_error_summary) <= 500
  )
);

create index catalog_publications_queue_idx
  on public.catalog_publications (status, next_attempt_at, requested_at, id)
  where status in ('PENDING', 'FAILED');
create index catalog_publications_scope_idx
  on public.catalog_publications (organization_id, stall_id, channel, requested_at desc);

create function app_private.guard_catalog_version_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed boolean := false;
begin
  if old.status = new.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'DRAFT' then new.status in ('IN_REVIEW', 'ARCHIVED')
    when 'IN_REVIEW' then new.status in ('APPROVED', 'DRAFT', 'ARCHIVED')
    when 'APPROVED' then new.status in ('SCHEDULED', 'PUBLISHING', 'DRAFT', 'ARCHIVED')
    when 'SCHEDULED' then new.status in ('PUBLISHING', 'APPROVED', 'ARCHIVED')
    when 'PUBLISHING' then new.status in ('ACTIVE', 'FAILED')
    when 'ACTIVE' then new.status in ('SUPERSEDED', 'ROLLED_BACK')
    when 'SUPERSEDED' then new.status in ('ROLLED_BACK', 'ARCHIVED')
    when 'ROLLED_BACK' then new.status = 'ARCHIVED'
    when 'FAILED' then new.status in ('DRAFT', 'ARCHIVED')
    else false
  end;

  if not v_allowed then
    raise exception 'CATALOG_VERSION_TRANSITION_INVALID' using errcode = '23514';
  end if;
  if new.status = 'APPROVED' and new.approved_by_profile_id is null then
    raise exception 'CATALOG_VERSION_APPROVER_REQUIRED' using errcode = '23514';
  end if;
  if new.status = 'SCHEDULED' and new.scheduled_publish_at is null then
    raise exception 'CATALOG_VERSION_SCHEDULE_REQUIRED' using errcode = '23514';
  end if;
  if new.status = 'ACTIVE' and new.published_at is null then
    raise exception 'CATALOG_VERSION_PUBLICATION_TIME_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.guard_catalog_draft_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version_id uuid := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  v_status text;
begin
  select version.status into v_status
  from public.catalog_menu_versions version
  where version.id = v_version_id;
  if v_status is distinct from 'DRAFT' then
    raise exception 'CATALOG_VERSION_CONTENT_LOCKED' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger catalog_menu_versions_touch_updated_at
before update on public.catalog_menu_versions
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger catalog_menu_versions_transition_guard
before update of status on public.catalog_menu_versions
for each row execute function app_private.guard_catalog_version_transition();
create trigger backend_writable_guard
before insert or update or delete on public.catalog_menu_versions
for each statement execute function app_private.enforce_backend_writable();

create trigger catalog_version_items_draft_guard
before insert or update or delete on public.catalog_version_items
for each row execute function app_private.guard_catalog_draft_content();
create trigger backend_writable_guard
before insert or update or delete on public.catalog_version_items
for each statement execute function app_private.enforce_backend_writable();

create trigger catalog_channel_overrides_touch_updated_at
before update on public.catalog_channel_overrides
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger catalog_channel_overrides_draft_guard
before insert or update or delete on public.catalog_channel_overrides
for each row execute function app_private.guard_catalog_draft_content();
create trigger backend_writable_guard
before insert or update or delete on public.catalog_channel_overrides
for each statement execute function app_private.enforce_backend_writable();

create trigger catalog_publications_touch_updated_at
before update on public.catalog_publications
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.catalog_publications
for each statement execute function app_private.enforce_backend_writable();

alter table public.catalog_menu_versions enable row level security;
alter table public.catalog_menu_versions force row level security;
alter table public.catalog_version_items enable row level security;
alter table public.catalog_version_items force row level security;
alter table public.catalog_channel_overrides enable row level security;
alter table public.catalog_channel_overrides force row level security;
alter table public.catalog_publications enable row level security;
alter table public.catalog_publications force row level security;

revoke all on table public.catalog_menu_versions from public, anon, authenticated;
revoke all on table public.catalog_version_items from public, anon, authenticated;
revoke all on table public.catalog_channel_overrides from public, anon, authenticated;
revoke all on table public.catalog_publications from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_menu_versions to service_role;
grant select, insert, update, delete on table public.catalog_version_items to service_role;
grant select, insert, update, delete on table public.catalog_channel_overrides to service_role;
grant select, insert, update, delete on table public.catalog_publications to service_role;

revoke all on function app_private.touch_competitive_enhancement_updated_at()
  from public, anon, authenticated;
revoke all on function app_private.guard_catalog_version_transition()
  from public, anon, authenticated;
revoke all on function app_private.guard_catalog_draft_content()
  from public, anon, authenticated;

comment on table public.catalog_menu_versions is
  'Organization-owned versioned menu metadata. Existing product tables remain canonical until HQ rollout.';
comment on table public.catalog_channel_overrides is
  'Traceable region or stall override for one channel and product in a draft catalog version.';
comment on table public.catalog_publications is
  'Idempotent, observable publication request without provider secret or raw payload storage.';
