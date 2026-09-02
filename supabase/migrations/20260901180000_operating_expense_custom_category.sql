alter table public.operating_expenses
  add column if not exists custom_category_name varchar(40);

alter table public.operating_expenses
  drop constraint if exists operating_expenses_custom_category_name_check;

alter table public.operating_expenses
  add constraint operating_expenses_custom_category_name_check
  check (
    custom_category_name is null
    or (
      category = 'OTHER'
      and char_length(btrim(custom_category_name)) between 2 and 40
    )
  );

create index if not exists operating_expenses_other_name_lookup_idx
  on public.operating_expenses (organization_id, custom_category_name, created_at desc)
  where category = 'OTHER' and custom_category_name is not null;
