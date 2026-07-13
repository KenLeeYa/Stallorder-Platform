create table public.product_categories (
  id uuid not null,
  tenant_id uuid not null,
  stall_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp(3) without time zone not null default current_timestamp,
  updated_at timestamp(3) without time zone not null,
  constraint product_categories_pkey primary key (id),
  constraint product_categories_tenant_id_fkey foreign key (tenant_id)
    references public.tenants(id) on delete cascade on update cascade,
  constraint product_categories_stall_id_fkey foreign key (stall_id)
    references public.stalls(id) on delete cascade on update cascade,
  constraint product_categories_stall_id_name_key unique (stall_id, name)
);

insert into public.product_categories (
  id, tenant_id, stall_id, name, sort_order, is_active, created_at, updated_at
)
select
  gen_random_uuid(),
  tenant_id,
  stall_id,
  category,
  row_number() over (partition by stall_id order by first_sort_order, category)::integer,
  true,
  now(),
  now()
from (
  select tenant_id, stall_id, category, min(sort_order) as first_sort_order
  from public.products
  group by tenant_id, stall_id, category
) existing_categories;

alter table public.products add column category_id uuid;

update public.products product
set category_id = category.id
from public.product_categories category
where category.tenant_id = product.tenant_id
  and category.stall_id = product.stall_id
  and category.name = product.category;

alter table public.products alter column category_id set not null;
drop index if exists public.products_stall_id_category_idx;
alter table public.products drop column category;
alter table public.products add constraint products_category_id_fkey
  foreign key (category_id) references public.product_categories(id)
  on delete restrict on update cascade;

create index product_categories_tenant_id_idx
  on public.product_categories(tenant_id);
create index product_categories_stall_id_sort_order_idx
  on public.product_categories(stall_id, sort_order);
create index products_stall_id_category_id_idx
  on public.products(stall_id, category_id);

alter table public.order_items drop constraint order_items_product_id_fkey;
alter table public.order_items alter column product_id drop not null;
alter table public.order_items add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products(id)
  on delete set null on update cascade;

alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;
revoke all on table public.product_categories from anon, authenticated;
grant select, insert, update, delete on table public.product_categories to service_role;
grant select on table public.product_categories to authenticated;

create policy product_categories_member_select on public.product_categories
for select to authenticated
using (public.has_stall_role(stall_id, null));
