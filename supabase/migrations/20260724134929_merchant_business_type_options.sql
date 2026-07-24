create table public.merchant_business_type_options (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  legacy_type public.merchant_business_type unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_business_type_options_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint merchant_business_type_options_name_length check (length(btrim(name)) between 1 and 80),
  constraint merchant_business_type_options_description_length check (
    description is null or length(description) <= 300
  ),
  constraint merchant_business_type_options_sort_order_range check (sort_order between 0 and 10000)
);

create index merchant_business_type_options_active_idx
  on public.merchant_business_type_options (is_active, sort_order);
create index merchant_business_type_options_archived_idx
  on public.merchant_business_type_options (archived_at);

create trigger merchant_business_type_options_touch_updated_at
before update on public.merchant_business_type_options
for each row execute function public.touch_merchant_application_updated_at();

insert into public.merchant_business_type_options (code, legacy_type, name, sort_order)
values
  ('NIGHT_MARKET_STALL', 'NIGHT_MARKET_STALL', '夜市攤位', 10),
  ('FOOD_TRUCK', 'FOOD_TRUCK', '餐車', 20),
  ('MARKET_STALL', 'MARKET_STALL', '市集攤位', 30),
  ('POPUP_STORE', 'POPUP_STORE', '快閃店', 40),
  ('SMALL_RESTAURANT', 'SMALL_RESTAURANT', '小型餐飲店', 50),
  ('BEVERAGE_SHOP', 'BEVERAGE_SHOP', '飲料店', 60),
  ('OTHER', 'OTHER', '其他', 70)
on conflict (code) do nothing;

alter table public.merchant_business_type_options enable row level security;
alter table public.merchant_business_type_options force row level security;

revoke all on public.merchant_business_type_options from public, anon, authenticated;
grant select (
  id, code, legacy_type, name, description, sort_order, is_active, archived_at, created_at, updated_at
) on public.merchant_business_type_options to authenticated;
grant select, insert, update, delete on public.merchant_business_type_options to service_role;

create policy merchant_business_type_options_authenticated_select
on public.merchant_business_type_options
for select to authenticated
using (true);
