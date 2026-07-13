-- Phase 3: organization product master with per-stall availability and pricing.

-- Categories become organization-level masters. Existing same-name categories
-- are merged before the organization uniqueness rule is added.
with category_mapping as (
  select
    id,
    first_value(id) over (
      partition by organization_id, lower(btrim(name))
      order by created_at, id
    ) as canonical_id
  from public.product_categories
)
update public.products product
set category_id = mapping.canonical_id
from category_mapping mapping
where product.category_id = mapping.id
  and mapping.id <> mapping.canonical_id;

with duplicate_categories as (
  select id
  from (
    select
      id,
      row_number() over (
        partition by organization_id, lower(btrim(name))
        order by created_at, id
      ) as position
    from public.product_categories
  ) ranked
  where position > 1
)
delete from public.product_categories category
using duplicate_categories duplicate
where category.id = duplicate.id;

alter table public.product_categories
  drop constraint if exists product_categories_stall_id_name_key,
  alter column stall_id drop not null,
  add constraint product_categories_id_organization_key unique (id, organization_id);

create unique index product_categories_organization_name_key
  on public.product_categories (organization_id, lower(btrim(name)));
create index product_categories_organization_sort_idx
  on public.product_categories (organization_id, sort_order, name);

create table public.product_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_groups_category_organization_fkey
    foreign key (category_id, organization_id)
    references public.product_categories(id, organization_id) on delete restrict,
  constraint product_groups_id_organization_key unique (id, organization_id),
  constraint product_groups_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint product_groups_sort_nonnegative check (sort_order >= 0)
);

create unique index product_groups_organization_category_name_key
  on public.product_groups (organization_id, category_id, lower(btrim(name)));
create index product_groups_organization_sort_idx
  on public.product_groups (organization_id, category_id, sort_order, name);

alter table public.products rename column price to default_price;
alter table public.products rename column is_available to is_active;
alter table public.products
  alter column stall_id drop not null,
  add column group_id uuid,
  add column image_url text,
  add constraint products_id_organization_key unique (id, organization_id),
  add constraint products_category_organization_fkey
    foreign key (category_id, organization_id)
    references public.product_categories(id, organization_id) on delete restrict,
  add constraint products_group_organization_fkey
    foreign key (group_id, organization_id)
    references public.product_groups(id, organization_id) on delete restrict;

create index products_organization_category_sort_idx
  on public.products (organization_id, category_id, sort_order, name);
create index products_organization_group_idx
  on public.products (organization_id, group_id) where group_id is not null;

create table public.stall_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null,
  product_id uuid not null,
  price_override integer,
  is_enabled boolean not null default true,
  is_sold_out boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stall_products_stall_organization_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade,
  constraint stall_products_product_organization_fkey
    foreign key (product_id, organization_id)
    references public.products(id, organization_id) on delete cascade,
  constraint stall_products_stall_product_key unique (stall_id, product_id),
  constraint stall_products_price_override_nonnegative
    check (price_override is null or price_override >= 0),
  constraint stall_products_sort_nonnegative check (sort_order >= 0)
);

insert into public.stall_products (
  organization_id, stall_id, product_id, price_override,
  is_enabled, is_sold_out, sort_order, created_at, updated_at
)
select
  organization_id,
  stall_id,
  id,
  null,
  true,
  not is_active,
  sort_order,
  created_at,
  updated_at
from public.products
where stall_id is not null
on conflict (stall_id, product_id) do nothing;

-- Legacy is_available represented stall availability. Product masters stay
-- active after the per-stall sold-out value has been preserved above.
update public.products set is_active = true;

create index stall_products_organization_stall_idx
  on public.stall_products (organization_id, stall_id, is_enabled, is_sold_out);
create index stall_products_product_idx
  on public.stall_products (product_id, stall_id);

create or replace function public.effective_stall_product_price(
  p_stall_id uuid,
  p_product_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(stall_product.price_override, product.default_price)
  from public.stall_products stall_product
  join public.products product
    on product.id = stall_product.product_id
   and product.organization_id = stall_product.organization_id
  where stall_product.stall_id = p_stall_id
    and stall_product.product_id = p_product_id
    and stall_product.is_enabled
    and not stall_product.is_sold_out
    and product.is_active;
$$;

create or replace function public.can_access_organization_catalog(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or public.is_organization_member(p_organization_id)
    or exists (
      select 1
      from public.stall_memberships membership
      where membership.organization_id = p_organization_id
        and membership.profile_id = public.current_profile_id()
        and membership.is_active
    );
$$;

revoke all on function public.effective_stall_product_price(uuid, uuid) from public, anon;
revoke all on function public.can_access_organization_catalog(uuid) from public, anon;
grant execute on function public.effective_stall_product_price(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_access_organization_catalog(uuid) to authenticated;

alter table public.product_groups enable row level security;
alter table public.product_groups force row level security;
alter table public.stall_products enable row level security;
alter table public.stall_products force row level security;

drop policy if exists product_categories_stall_select on public.product_categories;
drop policy if exists products_stall_select on public.products;

create policy product_categories_catalog_select on public.product_categories
for select to authenticated
using (public.can_access_organization_catalog(organization_id));

create policy product_groups_catalog_select on public.product_groups
for select to authenticated
using (public.can_access_organization_catalog(organization_id));

create policy products_catalog_select on public.products
for select to authenticated
using (public.can_access_organization_catalog(organization_id));

create policy stall_products_stall_select on public.stall_products
for select to authenticated
using (public.can_access_stall(stall_id));

revoke all on public.product_groups, public.stall_products from public, anon, authenticated;
grant select on public.product_groups, public.stall_products to authenticated;
grant select, insert, update, delete on public.product_groups, public.stall_products to service_role;
