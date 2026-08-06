-- Shared-catalog bundle definitions. Pricing remains anchored to
-- products.default_price; bundle choices only contribute a trusted delta.

do $$
begin
  create type public.product_kind as enum ('SINGLE', 'BUNDLE');
exception when duplicate_object then null;
end;
$$;

alter table public.products
  add column if not exists kind public.product_kind not null default 'SINGLE';

create table public.product_bundle_choice_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bundle_product_id uuid not null,
  name text not null,
  min_selections integer not null default 1,
  max_selections integer not null default 1,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_bundle_choice_groups_id_organization_key unique (id, organization_id),
  constraint product_bundle_choice_groups_bundle_organization_fkey
    foreign key (bundle_product_id, organization_id)
    references public.products(id, organization_id) on delete cascade,
  constraint product_bundle_choice_groups_bundle_name_key unique (bundle_product_id, name),
  constraint product_bundle_choice_groups_name_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint product_bundle_choice_groups_min_check
    check (min_selections between 0 and 20),
  constraint product_bundle_choice_groups_max_check
    check (max_selections between 1 and 20),
  constraint product_bundle_choice_groups_bounds_check
    check (min_selections <= max_selections),
  constraint product_bundle_choice_groups_sort_check
    check (sort_order between 0 and 10000)
);

create trigger backend_writable_guard
before insert or update or delete on public.product_bundle_choice_groups
for each statement execute function app_private.enforce_backend_writable();

create index product_bundle_choice_groups_organization_bundle_sort_idx
  on public.product_bundle_choice_groups (organization_id, bundle_product_id, sort_order, name);

create table public.product_bundle_choices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  choice_group_id uuid not null,
  component_product_id uuid not null,
  quantity integer not null default 1,
  price_delta integer not null default 0,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_bundle_choices_group_organization_fkey
    foreign key (choice_group_id, organization_id)
    references public.product_bundle_choice_groups(id, organization_id) on delete cascade,
  constraint product_bundle_choices_component_organization_fkey
    foreign key (component_product_id, organization_id)
    references public.products(id, organization_id) on delete restrict,
  constraint product_bundle_choices_group_component_key
    unique (choice_group_id, component_product_id),
  constraint product_bundle_choices_quantity_check
    check (quantity between 1 and 99),
  constraint product_bundle_choices_price_delta_check
    check (price_delta between -10000000 and 10000000),
  constraint product_bundle_choices_sort_check
    check (sort_order between 0 and 10000)
);

create trigger backend_writable_guard
before insert or update or delete on public.product_bundle_choices
for each statement execute function app_private.enforce_backend_writable();

create index product_bundle_choices_organization_group_sort_idx
  on public.product_bundle_choices (organization_id, choice_group_id, sort_order);
create index product_bundle_choices_organization_component_idx
  on public.product_bundle_choices (organization_id, component_product_id);

create or replace function public.enforce_product_bundle_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bundle_kind public.product_kind;
  v_component_kind public.product_kind;
  v_bundle_organization_id uuid;
begin
  if tg_table_name = 'product_bundle_choice_groups' then
    select product.kind
      into v_bundle_kind
    from public.products product
    where product.id = new.bundle_product_id
      and product.organization_id = new.organization_id;

    if v_bundle_kind is null then
      raise exception 'PRODUCT_BUNDLE_SCOPE_MISMATCH';
    elsif v_bundle_kind <> 'BUNDLE'::public.product_kind then
      raise exception 'PRODUCT_BUNDLE_PARENT_MUST_BE_BUNDLE';
    end if;
  elsif tg_table_name = 'product_bundle_choices' then
    select choice_group.organization_id, bundle.kind
      into v_bundle_organization_id, v_bundle_kind
    from public.product_bundle_choice_groups choice_group
    join public.products bundle
      on bundle.id = choice_group.bundle_product_id
     and bundle.organization_id = choice_group.organization_id
    where choice_group.id = new.choice_group_id;

    if v_bundle_organization_id is null
      or v_bundle_organization_id <> new.organization_id
      or v_bundle_kind <> 'BUNDLE'::public.product_kind then
      raise exception 'PRODUCT_BUNDLE_GROUP_SCOPE_MISMATCH';
    end if;

    select product.kind
      into v_component_kind
    from public.products product
    where product.id = new.component_product_id
      and product.organization_id = new.organization_id;

    if v_component_kind is null then
      raise exception 'PRODUCT_BUNDLE_COMPONENT_SCOPE_MISMATCH';
    elsif v_component_kind <> 'SINGLE'::public.product_kind then
      raise exception 'PRODUCT_BUNDLE_NESTING_NOT_ALLOWED';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_product_kind_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = old.kind then
    return new;
  end if;

  if new.kind = 'BUNDLE'::public.product_kind and exists (
    select 1
    from public.product_bundle_choices choice
    where choice.component_product_id = new.id
      and choice.organization_id = new.organization_id
  ) then
    raise exception 'PRODUCT_BUNDLE_NESTING_NOT_ALLOWED';
  end if;

  if new.kind = 'SINGLE'::public.product_kind and exists (
    select 1
    from public.product_bundle_choice_groups choice_group
    where choice_group.bundle_product_id = new.id
      and choice_group.organization_id = new.organization_id
  ) then
    raise exception 'PRODUCT_BUNDLE_GROUPS_MUST_BE_REMOVED';
  end if;

  return new;
end;
$$;

create trigger product_bundle_choice_groups_scope_before_write
before insert or update on public.product_bundle_choice_groups
for each row execute function public.enforce_product_bundle_scope();

create trigger product_bundle_choices_scope_before_write
before insert or update on public.product_bundle_choices
for each row execute function public.enforce_product_bundle_scope();

create trigger products_kind_transition_before_update
before update of kind on public.products
for each row execute function public.enforce_product_kind_transition();

alter table public.product_bundle_choice_groups enable row level security;
alter table public.product_bundle_choice_groups force row level security;
alter table public.product_bundle_choices enable row level security;
alter table public.product_bundle_choices force row level security;

revoke all privileges on table public.product_bundle_choice_groups,
  public.product_bundle_choices
from public, anon, authenticated, service_role;

grant select on table public.product_bundle_choice_groups,
  public.product_bundle_choices
to authenticated;

grant select, insert, update, delete on table public.product_bundle_choice_groups,
  public.product_bundle_choices
to service_role;

create policy product_bundle_choice_groups_catalog_select
on public.product_bundle_choice_groups
for select to authenticated
using (app_private.can_access_organization_catalog(organization_id));

create policy product_bundle_choices_catalog_select
on public.product_bundle_choices
for select to authenticated
using (app_private.can_access_organization_catalog(organization_id));
