-- Competitive enhancement Phase 7: Supply Lite foundation.
-- Additive only. Existing product and order flows remain canonical; inventory
-- consumption is not enabled until a separately reviewed rollout is approved.

create table public.supply_ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  base_uom text not null,
  low_stock_threshold_micros bigint not null default 0,
  is_active boolean not null default true,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_ingredients_scope_key unique (id, organization_id),
  constraint supply_ingredients_code_key unique (organization_id, code),
  constraint supply_ingredients_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint supply_ingredients_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint supply_ingredients_uom_check check (base_uom in ('G', 'KG', 'ML', 'L', 'EA')),
  constraint supply_ingredients_threshold_check check (
    low_stock_threshold_micros between 0 and 9000000000000000
  )
);

create index supply_ingredients_active_idx
  on public.supply_ingredients (organization_id, is_active, name, id);

create table public.supply_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid,
  code text not null,
  name text not null,
  location_type text not null,
  is_active boolean not null default true,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_locations_scope_key unique (id, organization_id),
  constraint supply_locations_code_key unique (organization_id, code),
  constraint supply_locations_stall_scope_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint supply_locations_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint supply_locations_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint supply_locations_type_check check (location_type in (
    'CENTRAL', 'STALL', 'STORAGE', 'IN_TRANSIT'
  )),
  constraint supply_locations_scope_check check (
    (location_type = 'STALL' and stall_id is not null)
    or (location_type <> 'STALL' and stall_id is null)
  )
);

create index supply_locations_active_idx
  on public.supply_locations (organization_id, is_active, location_type, name, id);

create table public.supply_recipe_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  ingredient_id uuid not null,
  quantity_micros bigint not null,
  waste_basis_points integer not null default 0,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_recipe_components_product_scope_fkey
    foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete cascade,
  constraint supply_recipe_components_ingredient_scope_fkey
    foreign key (ingredient_id, organization_id)
    references public.supply_ingredients(id, organization_id) on delete restrict,
  constraint supply_recipe_components_key unique (organization_id, product_id, ingredient_id),
  constraint supply_recipe_components_quantity_check check (
    quantity_micros between 1 and 9000000000000000
  ),
  constraint supply_recipe_components_waste_check check (
    waste_basis_points between 0 and 10000
  )
);

create index supply_recipe_components_ingredient_idx
  on public.supply_recipe_components (organization_id, ingredient_id, product_id);

create table public.supply_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingredient_id uuid not null,
  location_id uuid not null,
  quantity_micros bigint not null default 0,
  average_unit_cost_micros bigint not null default 0,
  last_movement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_inventory_balances_ingredient_scope_fkey
    foreign key (ingredient_id, organization_id)
    references public.supply_ingredients(id, organization_id) on delete restrict,
  constraint supply_inventory_balances_location_scope_fkey
    foreign key (location_id, organization_id)
    references public.supply_locations(id, organization_id) on delete restrict,
  constraint supply_inventory_balances_key unique (organization_id, ingredient_id, location_id),
  constraint supply_inventory_balances_quantity_check check (
    quantity_micros between -9000000000000000 and 9000000000000000
  ),
  constraint supply_inventory_balances_cost_check check (
    average_unit_cost_micros between 0 and 9000000000000000
  )
);

create index supply_inventory_balances_location_idx
  on public.supply_inventory_balances (organization_id, location_id, ingredient_id);

create table public.supply_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingredient_id uuid not null,
  location_id uuid not null,
  movement_type text not null,
  quantity_delta_micros bigint not null,
  unit_cost_micros bigint,
  source_type text not null,
  source_id text not null,
  idempotency_key text not null,
  reason text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  reversal_of_movement_id uuid references public.supply_inventory_movements(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint supply_inventory_movements_ingredient_scope_fkey
    foreign key (ingredient_id, organization_id)
    references public.supply_ingredients(id, organization_id) on delete restrict,
  constraint supply_inventory_movements_location_scope_fkey
    foreign key (location_id, organization_id)
    references public.supply_locations(id, organization_id) on delete restrict,
  constraint supply_inventory_movements_idempotency_key
    unique (organization_id, idempotency_key),
  constraint supply_inventory_movements_type_check check (movement_type in (
    'RECEIPT', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT',
    'SALE_CONSUMPTION', 'REVERSAL'
  )),
  constraint supply_inventory_movements_quantity_check check (
    quantity_delta_micros <> 0
    and quantity_delta_micros between -9000000000000000 and 9000000000000000
  ),
  constraint supply_inventory_movements_direction_check check (
    (movement_type in ('RECEIPT', 'TRANSFER_IN') and quantity_delta_micros > 0)
    or (movement_type in ('WASTE', 'TRANSFER_OUT', 'SALE_CONSUMPTION') and quantity_delta_micros < 0)
    or movement_type in ('ADJUSTMENT', 'REVERSAL')
  ),
  constraint supply_inventory_movements_cost_check check (
    unit_cost_micros is null or unit_cost_micros between 0 and 9000000000000000
  ),
  constraint supply_inventory_movements_source_type_check check (
    source_type ~ '^[A-Z][A-Z0-9_]{1,79}$'
  ),
  constraint supply_inventory_movements_source_id_check check (
    char_length(btrim(source_id)) between 1 and 160
  ),
  constraint supply_inventory_movements_key_check check (
    char_length(idempotency_key) between 16 and 160
    and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint supply_inventory_movements_reason_check check (
    char_length(btrim(reason)) between 1 and 300
  )
);

create index supply_inventory_movements_timeline_idx
  on public.supply_inventory_movements (
    organization_id, location_id, ingredient_id, created_at desc, id desc
  );
create index supply_inventory_movements_source_idx
  on public.supply_inventory_movements (organization_id, source_type, source_id);

create function app_private.guard_supply_movement_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SUPPLY_MOVEMENT_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger supply_ingredients_touch_updated_at
before update on public.supply_ingredients
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.supply_ingredients
for each statement execute function app_private.enforce_backend_writable();

create trigger supply_locations_touch_updated_at
before update on public.supply_locations
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.supply_locations
for each statement execute function app_private.enforce_backend_writable();

create trigger supply_recipe_components_touch_updated_at
before update on public.supply_recipe_components
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.supply_recipe_components
for each statement execute function app_private.enforce_backend_writable();

create trigger supply_inventory_balances_touch_updated_at
before update on public.supply_inventory_balances
for each row execute function app_private.touch_competitive_enhancement_updated_at();
create trigger backend_writable_guard
before insert or update or delete on public.supply_inventory_balances
for each statement execute function app_private.enforce_backend_writable();

create trigger supply_inventory_movements_immutable_guard
before update or delete on public.supply_inventory_movements
for each row execute function app_private.guard_supply_movement_immutable();
create trigger backend_writable_guard
before insert or update or delete on public.supply_inventory_movements
for each statement execute function app_private.enforce_backend_writable();

alter table public.supply_ingredients enable row level security;
alter table public.supply_ingredients force row level security;
alter table public.supply_locations enable row level security;
alter table public.supply_locations force row level security;
alter table public.supply_recipe_components enable row level security;
alter table public.supply_recipe_components force row level security;
alter table public.supply_inventory_balances enable row level security;
alter table public.supply_inventory_balances force row level security;
alter table public.supply_inventory_movements enable row level security;
alter table public.supply_inventory_movements force row level security;

revoke all on table public.supply_ingredients from public, anon, authenticated;
revoke all on table public.supply_locations from public, anon, authenticated;
revoke all on table public.supply_recipe_components from public, anon, authenticated;
revoke all on table public.supply_inventory_balances from public, anon, authenticated;
revoke all on table public.supply_inventory_movements from public, anon, authenticated;
grant select, insert, update, delete on table public.supply_ingredients to service_role;
grant select, insert, update, delete on table public.supply_locations to service_role;
grant select, insert, update, delete on table public.supply_recipe_components to service_role;
grant select, insert, update, delete on table public.supply_inventory_balances to service_role;
grant select, insert on table public.supply_inventory_movements to service_role;

revoke all on function app_private.guard_supply_movement_immutable()
  from public, anon, authenticated;

comment on table public.supply_inventory_movements is
  'Immutable, idempotent Supply Lite inventory ledger. Corrections use compensating entries.';
comment on table public.supply_inventory_balances is
  'Server-maintained current balance derived transactionally from immutable movement entries.';
