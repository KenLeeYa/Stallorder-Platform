create table public.reusable_product_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  price_delta integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reusable_product_notes_id_organization_key unique (id, organization_id),
  constraint reusable_product_notes_organization_name_key unique (organization_id, name),
  constraint reusable_product_notes_name_check check (char_length(name) between 1 and 80),
  constraint reusable_product_notes_price_check check (price_delta between -10000000 and 10000000),
  constraint reusable_product_notes_sort_check check (sort_order between 0 and 10000)
);

create index reusable_product_notes_organization_sort_idx
  on public.reusable_product_notes (organization_id, sort_order, name);

create table public.reusable_product_note_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reusable_note_id uuid not null,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reusable_product_note_translations_note_organization_fkey
    foreign key (reusable_note_id, organization_id)
    references public.reusable_product_notes(id, organization_id) on delete cascade,
  constraint reusable_product_note_translations_note_locale_key unique (reusable_note_id, locale),
  constraint reusable_product_note_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint reusable_product_note_translations_name_check check (char_length(name) between 1 and 120)
);

create index reusable_product_note_translations_organization_locale_idx
  on public.reusable_product_note_translations (organization_id, locale);

alter table public.product_note_options
  add column reusable_note_id uuid;

alter table public.product_note_options
  add constraint product_note_options_reusable_note_organization_fkey
  foreign key (reusable_note_id, organization_id)
  references public.reusable_product_notes(id, organization_id)
  on delete restrict;

create unique index product_note_options_group_reusable_note_key
  on public.product_note_options (note_group_id, reusable_note_id)
  where reusable_note_id is not null;

create index product_note_options_organization_reusable_note_idx
  on public.product_note_options (organization_id, reusable_note_id)
  where reusable_note_id is not null;

create or replace function public.enforce_reusable_product_note_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_price_delta integer;
  v_is_active boolean;
begin
  if tg_table_name = 'reusable_product_note_translations' then
    if not exists (
      select 1
      from public.reusable_product_notes reusable_note
      where reusable_note.id = new.reusable_note_id
        and reusable_note.organization_id = new.organization_id
    ) then
      raise exception 'REUSABLE_PRODUCT_NOTE_TRANSLATION_SCOPE_MISMATCH';
    end if;
  elsif tg_table_name = 'product_note_options' and new.reusable_note_id is not null then
    select reusable_note.name, reusable_note.price_delta, reusable_note.is_active
      into v_name, v_price_delta, v_is_active
    from public.reusable_product_notes reusable_note
    where reusable_note.id = new.reusable_note_id
      and reusable_note.organization_id = new.organization_id;

    if v_name is null then
      raise exception 'REUSABLE_PRODUCT_NOTE_OPTION_SCOPE_MISMATCH';
    end if;
    if new.name is distinct from v_name
      or new.price_delta is distinct from v_price_delta
      or new.is_active is distinct from v_is_active then
      raise exception 'REUSABLE_PRODUCT_NOTE_OPTION_CONTENT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.sync_reusable_product_note_option_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.product_note_options
  set name = new.name,
      price_delta = new.price_delta,
      is_active = new.is_active,
      updated_at = now()
  where reusable_note_id = new.id
    and organization_id = new.organization_id;
  return new;
end;
$$;

create or replace function public.copy_reusable_product_note_translations_to_option()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reusable_note_id is null then
    return new;
  end if;

  delete from public.product_note_option_translations
  where note_option_id = new.id;

  insert into public.product_note_option_translations (
    organization_id,
    note_option_id,
    locale,
    name
  )
  select new.organization_id, new.id, translation.locale, translation.name
  from public.reusable_product_note_translations translation
  where translation.reusable_note_id = new.reusable_note_id
    and translation.organization_id = new.organization_id;
  return new;
end;
$$;

create or replace function public.sync_reusable_product_note_translation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reusable_note_id uuid;
  v_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    v_reusable_note_id := old.reusable_note_id;
    v_organization_id := old.organization_id;
  else
    v_reusable_note_id := new.reusable_note_id;
    v_organization_id := new.organization_id;
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.locale <> new.locale) then
    delete from public.product_note_option_translations translation
    using public.product_note_options note_option
    where translation.note_option_id = note_option.id
      and note_option.reusable_note_id = v_reusable_note_id
      and note_option.organization_id = v_organization_id
      and translation.locale = old.locale;
  end if;

  if tg_op <> 'DELETE' then
    insert into public.product_note_option_translations (
      organization_id,
      note_option_id,
      locale,
      name
    )
    select v_organization_id, note_option.id, new.locale, new.name
    from public.product_note_options note_option
    where note_option.reusable_note_id = v_reusable_note_id
      and note_option.organization_id = v_organization_id
    on conflict (note_option_id, locale)
    do update set name = excluded.name, updated_at = now();
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger reusable_product_note_translations_scope_before_write
before insert or update on public.reusable_product_note_translations
for each row execute function public.enforce_reusable_product_note_scope();

create trigger product_note_options_reusable_scope_before_write
before insert or update of reusable_note_id, name, price_delta, is_active
on public.product_note_options
for each row execute function public.enforce_reusable_product_note_scope();

create trigger reusable_product_notes_sync_options_after_update
after update of name, price_delta, is_active on public.reusable_product_notes
for each row execute function public.sync_reusable_product_note_option_content();

create trigger product_note_options_copy_reusable_translations_after_link
after insert or update of reusable_note_id on public.product_note_options
for each row execute function public.copy_reusable_product_note_translations_to_option();

create trigger reusable_product_note_translations_sync_options_after_write
after insert or update or delete on public.reusable_product_note_translations
for each row execute function public.sync_reusable_product_note_translation();

alter table public.reusable_product_notes enable row level security;
alter table public.reusable_product_notes force row level security;
alter table public.reusable_product_note_translations enable row level security;
alter table public.reusable_product_note_translations force row level security;

revoke all on public.reusable_product_notes, public.reusable_product_note_translations
from public, anon, authenticated, service_role;
grant select on public.reusable_product_notes, public.reusable_product_note_translations
to authenticated;
grant select, insert, update, delete on public.reusable_product_notes, public.reusable_product_note_translations
to service_role;

create policy reusable_product_notes_authorized_select
on public.reusable_product_notes
for select to authenticated using (
  app_private.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1
    from public.product_note_options note_option
    join public.product_note_group_assignments assignment
      on assignment.note_group_id = note_option.note_group_id
    join public.stall_products stall_product
      on stall_product.product_id = assignment.product_id
    where note_option.reusable_note_id = reusable_product_notes.id
      and app_private.can_access_stall(stall_product.stall_id)
  )
);

create policy reusable_product_note_translations_authorized_select
on public.reusable_product_note_translations
for select to authenticated using (
  app_private.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1
    from public.product_note_options note_option
    join public.product_note_group_assignments assignment
      on assignment.note_group_id = note_option.note_group_id
    join public.stall_products stall_product
      on stall_product.product_id = assignment.product_id
    where note_option.reusable_note_id = reusable_product_note_translations.reusable_note_id
      and app_private.can_access_stall(stall_product.stall_id)
  )
);

revoke all on function public.enforce_reusable_product_note_scope() from public, anon, authenticated;
revoke all on function public.sync_reusable_product_note_option_content() from public, anon, authenticated;
revoke all on function public.copy_reusable_product_note_translations_to_option() from public, anon, authenticated;
revoke all on function public.sync_reusable_product_note_translation() from public, anon, authenticated;
grant execute on function public.enforce_reusable_product_note_scope() to service_role;
grant execute on function public.sync_reusable_product_note_option_content() to service_role;
grant execute on function public.copy_reusable_product_note_translations_to_option() to service_role;
grant execute on function public.sync_reusable_product_note_translation() to service_role;
