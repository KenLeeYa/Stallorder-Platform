create table if not exists public.product_category_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.product_categories(id) on delete cascade,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_category_translations_category_locale_key unique (category_id, locale),
  constraint product_category_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint product_category_translations_name_check check (char_length(name) between 1 and 120)
);

create index if not exists product_category_translations_organization_locale_idx
  on public.product_category_translations (organization_id, locale);

create table if not exists public.product_group_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.product_groups(id) on delete cascade,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_group_translations_group_locale_key unique (group_id, locale),
  constraint product_group_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint product_group_translations_name_check check (char_length(name) between 1 and 120)
);

create index if not exists product_group_translations_organization_locale_idx
  on public.product_group_translations (organization_id, locale);

create or replace function public.enforce_product_taxonomy_translation_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  if tg_table_name = 'product_category_translations' then
    select organization_id into v_organization_id
      from public.product_categories where id = new.category_id;
  else
    select organization_id into v_organization_id
      from public.product_groups where id = new.group_id;
  end if;
  if v_organization_id is null or v_organization_id <> new.organization_id then
    raise exception 'PRODUCT_TAXONOMY_TRANSLATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists product_category_translations_scope_before_write on public.product_category_translations;
create trigger product_category_translations_scope_before_write
before insert or update on public.product_category_translations
for each row execute function public.enforce_product_taxonomy_translation_scope();

drop trigger if exists product_group_translations_scope_before_write on public.product_group_translations;
create trigger product_group_translations_scope_before_write
before insert or update on public.product_group_translations
for each row execute function public.enforce_product_taxonomy_translation_scope();

alter table public.product_category_translations enable row level security;
alter table public.product_category_translations force row level security;
alter table public.product_group_translations enable row level security;
alter table public.product_group_translations force row level security;

revoke all on public.product_category_translations, public.product_group_translations
from public, anon, authenticated;
grant select on public.product_category_translations, public.product_group_translations
to authenticated;
grant select, insert, update, delete on public.product_category_translations, public.product_group_translations
to service_role;

drop policy if exists product_category_translations_authorized_select on public.product_category_translations;
create policy product_category_translations_authorized_select
on public.product_category_translations for select to authenticated using (
  app_private.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1
      from public.products product
      join public.stall_products stall_product on stall_product.product_id = product.id
     where product.category_id = product_category_translations.category_id
       and app_private.can_access_stall(stall_product.stall_id)
  )
);

drop policy if exists product_group_translations_authorized_select on public.product_group_translations;
create policy product_group_translations_authorized_select
on public.product_group_translations for select to authenticated using (
  app_private.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1
      from public.products product
      join public.stall_products stall_product on stall_product.product_id = product.id
     where product.group_id = product_group_translations.group_id
       and app_private.can_access_stall(stall_product.stall_id)
  )
);

revoke all on function public.enforce_product_taxonomy_translation_scope()
from public, anon, authenticated;
grant execute on function public.enforce_product_taxonomy_translation_scope()
to service_role;
