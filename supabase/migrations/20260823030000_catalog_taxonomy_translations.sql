create table public.product_category_translations (
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

create index product_category_translations_organization_locale_idx
  on public.product_category_translations (organization_id, locale);

create table public.product_group_translations (
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

create index product_group_translations_organization_locale_idx
  on public.product_group_translations (organization_id, locale);

create function public.enforce_product_taxonomy_translation_scope()
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

create trigger product_category_translations_scope_before_write
before insert or update on public.product_category_translations
for each row execute function public.enforce_product_taxonomy_translation_scope();

create trigger product_group_translations_scope_before_write
before insert or update on public.product_group_translations
for each row execute function public.enforce_product_taxonomy_translation_scope();

alter table public.product_category_translations enable row level security;
alter table public.product_category_translations force row level security;
alter table public.product_group_translations enable row level security;
alter table public.product_group_translations force row level security;

revoke all on table public.product_category_translations, public.product_group_translations
from public, anon, authenticated;
grant select, insert, update, delete on table public.product_category_translations, public.product_group_translations
to service_role;

revoke all on function public.enforce_product_taxonomy_translation_scope()
from public, anon, authenticated;
grant execute on function public.enforce_product_taxonomy_translation_scope()
to service_role;
