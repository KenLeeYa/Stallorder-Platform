do $$
begin
  create type public.product_note_selection_mode as enum ('SINGLE', 'MULTIPLE');
exception when duplicate_object then null;
end;
$$;

create table if not exists public.product_note_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  selection_mode public.product_note_selection_mode not null default 'MULTIPLE',
  is_required boolean not null default false,
  min_selections integer not null default 0,
  max_selections integer,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_note_groups_organization_name_key unique (organization_id, name),
  constraint product_note_groups_name_check check (char_length(name) between 1 and 80),
  constraint product_note_groups_min_check check (min_selections between 0 and 20),
  constraint product_note_groups_max_check check (max_selections is null or max_selections between 1 and 20),
  constraint product_note_groups_bounds_check check (max_selections is null or min_selections <= max_selections),
  constraint product_note_groups_required_check check (not is_required or min_selections >= 1),
  constraint product_note_groups_single_check check (selection_mode <> 'SINGLE' or max_selections = 1)
);
create index if not exists product_note_groups_organization_sort_idx
  on public.product_note_groups (organization_id, sort_order);

create table if not exists public.product_note_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_group_id uuid not null references public.product_note_groups(id) on delete cascade,
  name text not null,
  price_delta integer not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_note_options_group_name_key unique (note_group_id, name),
  constraint product_note_options_name_check check (char_length(name) between 1 and 80),
  constraint product_note_options_price_check check (price_delta between -10000000 and 10000000)
);
create index if not exists product_note_options_organization_group_sort_idx
  on public.product_note_options (organization_id, note_group_id, sort_order);

create table if not exists public.product_note_group_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_group_id uuid not null references public.product_note_groups(id) on delete cascade,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_note_group_translations_group_locale_key unique (note_group_id, locale),
  constraint product_note_group_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint product_note_group_translations_name_check check (char_length(name) between 1 and 120)
);
create index if not exists product_note_group_translations_organization_locale_idx
  on public.product_note_group_translations (organization_id, locale);

create table if not exists public.product_note_option_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_option_id uuid not null references public.product_note_options(id) on delete cascade,
  locale text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_note_option_translations_option_locale_key unique (note_option_id, locale),
  constraint product_note_option_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint product_note_option_translations_name_check check (char_length(name) between 1 and 120)
);
create index if not exists product_note_option_translations_organization_locale_idx
  on public.product_note_option_translations (organization_id, locale);

create table if not exists public.product_note_group_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  note_group_id uuid not null references public.product_note_groups(id) on delete cascade,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_note_group_assignments_product_group_key unique (product_id, note_group_id)
);
create index if not exists product_note_group_assignments_product_sort_idx
  on public.product_note_group_assignments (organization_id, product_id, sort_order);
create index if not exists product_note_group_assignments_group_idx
  on public.product_note_group_assignments (organization_id, note_group_id);

alter table public.order_items add column if not exists base_unit_price integer;
update public.order_items set base_unit_price = unit_price where base_unit_price is null;
alter table public.order_items alter column base_unit_price set not null;
alter table public.order_items drop constraint if exists order_items_base_price_nonnegative;
alter table public.order_items add constraint order_items_base_price_nonnegative check (base_unit_price >= 0);

create or replace function public.initialize_order_item_base_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_unit_price is null then new.base_unit_price := new.unit_price; end if;
  return new;
end;
$$;
drop trigger if exists order_items_initialize_base_price_before_insert on public.order_items;
create trigger order_items_initialize_base_price_before_insert
before insert on public.order_items for each row execute function public.initialize_order_item_base_price();

create table if not exists public.order_item_note_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  note_group_id uuid references public.product_note_groups(id) on delete set null,
  note_option_id uuid references public.product_note_options(id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_delta integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint order_item_note_options_group_name_check check (char_length(group_name) between 1 and 120),
  constraint order_item_note_options_option_name_check check (char_length(option_name) between 1 and 120),
  constraint order_item_note_options_price_check check (price_delta between -10000000 and 10000000)
);
create index if not exists order_item_note_options_organization_stall_idx
  on public.order_item_note_options (organization_id, stall_id);
create index if not exists order_item_note_options_order_item_idx
  on public.order_item_note_options (order_item_id, sort_order);
create index if not exists order_item_note_options_option_idx
  on public.order_item_note_options (note_option_id);

create or replace function public.enforce_product_note_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
  v_group_id uuid;
begin
  if tg_table_name = 'product_note_options' then
    select organization_id into v_organization_id from public.product_note_groups where id = new.note_group_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'PRODUCT_NOTE_OPTION_SCOPE_MISMATCH'; end if;
  elsif tg_table_name = 'product_note_group_translations' then
    select organization_id into v_organization_id from public.product_note_groups where id = new.note_group_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'PRODUCT_NOTE_GROUP_TRANSLATION_SCOPE_MISMATCH'; end if;
  elsif tg_table_name = 'product_note_option_translations' then
    select organization_id into v_organization_id from public.product_note_options where id = new.note_option_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'PRODUCT_NOTE_OPTION_TRANSLATION_SCOPE_MISMATCH'; end if;
  elsif tg_table_name = 'product_note_group_assignments' then
    if not exists (
      select 1 from public.products product
      join public.product_note_groups note_group on note_group.id = new.note_group_id
      where product.id = new.product_id
        and product.organization_id = new.organization_id
        and note_group.organization_id = new.organization_id
    ) then raise exception 'PRODUCT_NOTE_ASSIGNMENT_SCOPE_MISMATCH'; end if;
  elsif tg_table_name = 'order_item_note_options' then
    select organization_id, stall_id into v_organization_id, v_stall_id
    from public.order_items where id = new.order_item_id;
    if v_organization_id is null or v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then
      raise exception 'ORDER_ITEM_NOTE_SCOPE_MISMATCH';
    end if;
    if new.note_group_id is not null and not exists (
      select 1 from public.product_note_groups where id = new.note_group_id and organization_id = new.organization_id
    ) then raise exception 'ORDER_ITEM_NOTE_GROUP_SCOPE_MISMATCH'; end if;
    if new.note_option_id is not null then
      select organization_id, note_group_id into v_organization_id, v_group_id
      from public.product_note_options where id = new.note_option_id;
      if v_organization_id is null or v_organization_id <> new.organization_id
        or (new.note_group_id is not null and v_group_id <> new.note_group_id) then
        raise exception 'ORDER_ITEM_NOTE_OPTION_SCOPE_MISMATCH';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_note_options_scope_before_write on public.product_note_options;
create trigger product_note_options_scope_before_write before insert or update on public.product_note_options
for each row execute function public.enforce_product_note_scope();
drop trigger if exists product_note_group_translations_scope_before_write on public.product_note_group_translations;
create trigger product_note_group_translations_scope_before_write before insert or update on public.product_note_group_translations
for each row execute function public.enforce_product_note_scope();
drop trigger if exists product_note_option_translations_scope_before_write on public.product_note_option_translations;
create trigger product_note_option_translations_scope_before_write before insert or update on public.product_note_option_translations
for each row execute function public.enforce_product_note_scope();
drop trigger if exists product_note_group_assignments_scope_before_write on public.product_note_group_assignments;
create trigger product_note_group_assignments_scope_before_write before insert or update on public.product_note_group_assignments
for each row execute function public.enforce_product_note_scope();
drop trigger if exists order_item_note_options_scope_before_write on public.order_item_note_options;
create trigger order_item_note_options_scope_before_write before insert or update on public.order_item_note_options
for each row execute function public.enforce_product_note_scope();

alter table public.product_note_groups enable row level security;
alter table public.product_note_groups force row level security;
alter table public.product_note_options enable row level security;
alter table public.product_note_options force row level security;
alter table public.product_note_group_translations enable row level security;
alter table public.product_note_group_translations force row level security;
alter table public.product_note_option_translations enable row level security;
alter table public.product_note_option_translations force row level security;
alter table public.product_note_group_assignments enable row level security;
alter table public.product_note_group_assignments force row level security;
alter table public.order_item_note_options enable row level security;
alter table public.order_item_note_options force row level security;

revoke all on public.product_note_groups, public.product_note_options,
  public.product_note_group_translations, public.product_note_option_translations,
  public.product_note_group_assignments, public.order_item_note_options
from public, anon, authenticated;
grant select on public.product_note_groups, public.product_note_options,
  public.product_note_group_translations, public.product_note_option_translations,
  public.product_note_group_assignments, public.order_item_note_options to authenticated;
grant select, insert, update, delete on public.product_note_groups, public.product_note_options,
  public.product_note_group_translations, public.product_note_option_translations,
  public.product_note_group_assignments, public.order_item_note_options to service_role;

create policy product_note_groups_authorized_select on public.product_note_groups
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.product_note_group_assignments assignment
    join public.stall_products stall_product on stall_product.product_id = assignment.product_id
    where assignment.note_group_id = product_note_groups.id and public.can_access_stall(stall_product.stall_id)
  )
);
create policy product_note_options_authorized_select on public.product_note_options
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.product_note_group_assignments assignment
    join public.stall_products stall_product on stall_product.product_id = assignment.product_id
    where assignment.note_group_id = product_note_options.note_group_id and public.can_access_stall(stall_product.stall_id)
  )
);
create policy product_note_group_translations_authorized_select on public.product_note_group_translations
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.product_note_group_assignments assignment
    join public.stall_products stall_product on stall_product.product_id = assignment.product_id
    where assignment.note_group_id = product_note_group_translations.note_group_id and public.can_access_stall(stall_product.stall_id)
  )
);
create policy product_note_option_translations_authorized_select on public.product_note_option_translations
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.product_note_options note_option
    join public.product_note_group_assignments assignment on assignment.note_group_id = note_option.note_group_id
    join public.stall_products stall_product on stall_product.product_id = assignment.product_id
    where note_option.id = product_note_option_translations.note_option_id and public.can_access_stall(stall_product.stall_id)
  )
);
create policy product_note_group_assignments_authorized_select on public.product_note_group_assignments
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.stall_products stall_product
    where stall_product.product_id = product_note_group_assignments.product_id
      and public.can_access_stall(stall_product.stall_id)
  )
);
create policy order_item_note_options_authorized_select on public.order_item_note_options
for select to authenticated using (public.can_view_orders(stall_id));

revoke all on function public.initialize_order_item_base_price() from public, anon, authenticated;
revoke all on function public.enforce_product_note_scope() from public, anon, authenticated;
grant execute on function public.initialize_order_item_base_price() to service_role;
grant execute on function public.enforce_product_note_scope() to service_role;

create or replace function public.create_public_order(
  p_order_id uuid,
  p_qr_token text,
  p_session_token_hash text,
  p_device_hash text,
  p_ip_hash text,
  p_qr_token_hash text,
  p_behavior_hash text,
  p_idempotency_key uuid,
  p_idempotency_hash text,
  p_customer_name text,
  p_customer_note text,
  p_items jsonb,
  p_tracking_token_hash text,
  p_pickup_code_hash text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order_id uuid;
  v_session_id uuid;
  v_tenant_id uuid;
  v_organization_id uuid;
  v_stall_id uuid;
  v_qr_code_id uuid;
  v_table_id uuid;
  v_table_label text;
  v_table_active boolean;
  v_dine_in_enabled boolean;
  v_fulfillment public.fulfillment_type := 'TAKEOUT'::public.fulfillment_type;
  v_order_total integer;
  v_idempotent_replay boolean;
begin
  select session_record.id, session_record.tenant_id, session_record.organization_id,
    session_record.stall_id, session_record.qr_code_id, qr.dining_table_id, settings.dine_in_enabled
  into v_session_id, v_tenant_id, v_organization_id, v_stall_id, v_qr_code_id,
    v_table_id, v_dine_in_enabled
  from public.order_sessions session_record
  join public.qr_codes qr on qr.id = session_record.qr_code_id
  join public.stall_ordering_settings settings on settings.stall_id = session_record.stall_id
  where session_record.token_hash = p_session_token_hash;

  if v_table_id is not null then
    select label, is_active into v_table_label, v_table_active
    from public.dining_tables where id = v_table_id for share;
  end if;
  if v_table_id is not null and (not coalesce(v_table_active, false) or not coalesce(v_dine_in_enabled, false)) then
    return jsonb_build_object('ok', false, 'code', 'TABLE_UNAVAILABLE');
  end if;

  if v_organization_id is not null and jsonb_typeof(p_items) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p_items) item
      where case
        when not (item ? 'modifier_option_ids') then false
        when jsonb_typeof(item->'modifier_option_ids') <> 'array' then true
        else jsonb_array_length(item->'modifier_option_ids') > 50
      end
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      select 1 from (
        select item->>'product_id' as product_id, selected.value
        from jsonb_array_elements(p_items) item
        cross join lateral jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
        group by item->>'product_id', selected.value
        having count(*) > 1
      ) duplicate_selection
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      with selected as (
        select (item->>'product_id')::uuid as product_id, selected.value::uuid as option_id
        from jsonb_array_elements(p_items) item
        cross join lateral jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
      )
      select 1 from selected
      left join public.product_note_options note_option
        on note_option.id = selected.option_id and note_option.organization_id = v_organization_id and note_option.is_active
      left join public.product_note_groups note_group
        on note_group.id = note_option.note_group_id and note_group.organization_id = v_organization_id and note_group.is_active
      left join public.product_note_group_assignments assignment
        on assignment.note_group_id = note_group.id and assignment.product_id = selected.product_id
          and assignment.organization_id = v_organization_id and assignment.is_active
      where note_option.id is null or note_group.id is null or assignment.id is null
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;

    if exists (
      with requested as (
        select (item->>'product_id')::uuid as product_id,
          coalesce(item->'modifier_option_ids', '[]'::jsonb) as selected_options
        from jsonb_array_elements(p_items) item
      )
      select 1
      from requested
      join public.product_note_group_assignments assignment
        on assignment.product_id = requested.product_id
        and assignment.organization_id = v_organization_id and assignment.is_active
      join public.product_note_groups note_group
        on note_group.id = assignment.note_group_id
        and note_group.organization_id = v_organization_id and note_group.is_active
      cross join lateral (
        select count(*)::integer as selected_count
        from jsonb_array_elements_text(requested.selected_options) selected(value)
        join public.product_note_options note_option
          on note_option.id = selected.value::uuid
          and note_option.note_group_id = note_group.id and note_option.is_active
      ) selection_count
      where selection_count.selected_count < note_group.min_selections
        or (note_group.max_selections is not null and selection_count.selected_count > note_group.max_selections)
    ) then
      perform public.record_public_order_attempt(p_request_id, 'ORDER_SUBMIT', 'DENIED', 'INVALID_PRODUCT_NOTES', v_tenant_id, v_stall_id, v_qr_code_id, v_session_id, p_ip_hash, p_device_hash, p_qr_token_hash, p_session_token_hash, p_behavior_hash, p_idempotency_hash);
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRODUCT_NOTES');
    end if;
  end if;

  v_result := public.create_public_order_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );

  if coalesce((v_result->>'ok')::boolean, false) and v_result ? 'order' then
    v_order_id := (v_result #>> '{order,order_id}')::uuid;
    v_idempotent_replay := coalesce((v_result->>'idempotent_replay')::boolean, false);

    if not v_idempotent_replay then
      update public.order_items set base_unit_price = unit_price where order_id = v_order_id;

      insert into public.order_item_note_options (
        organization_id, stall_id, order_item_id, note_group_id, note_option_id,
        group_name, option_name, price_delta, sort_order, created_at
      )
      select v_organization_id, v_stall_id, order_item.id, note_group.id, note_option.id,
        note_group.name, note_option.name, note_option.price_delta,
        note_group.sort_order * 1000 + note_option.sort_order, now()
      from jsonb_array_elements(p_items) item
      cross join lateral jsonb_array_elements_text(coalesce(item->'modifier_option_ids', '[]'::jsonb)) selected(value)
      join public.order_items order_item
        on order_item.order_id = v_order_id and order_item.product_id = (item->>'product_id')::uuid
      join public.product_note_options note_option on note_option.id = selected.value::uuid
      join public.product_note_groups note_group on note_group.id = note_option.note_group_id;

      update public.order_items order_item
      set unit_price = greatest(0, order_item.base_unit_price + modifier_total.price_delta)
      from (
        select item.id, coalesce(sum(note.price_delta), 0)::integer as price_delta
        from public.order_items item
        left join public.order_item_note_options note on note.order_item_id = item.id
        where item.order_id = v_order_id
        group by item.id
      ) modifier_total
      where order_item.id = modifier_total.id;

      select coalesce(sum(unit_price * quantity), 0)::integer into v_order_total
      from public.order_items where order_id = v_order_id;
      update public.orders set subtotal = v_order_total, total = v_order_total where id = v_order_id;
      update public.audit_logs
      set metadata = (coalesce(nullif(metadata, ''), '{}')::jsonb || jsonb_build_object('total', v_order_total))::text
      where entity_id = v_order_id and action = 'PUBLIC_ORDER_CREATED';
    else
      select total into v_order_total from public.orders where id = v_order_id;
    end if;

    if v_table_id is not null then
      v_fulfillment := 'DINE_IN'::public.fulfillment_type;
      update public.orders
      set dining_table_id = v_table_id,
          table_label = v_table_label,
          fulfillment_type = v_fulfillment,
          pickup_code_hash = null
      where id = v_order_id;
    end if;
    v_result := jsonb_set(v_result, '{order,fulfillment_type}', to_jsonb(v_fulfillment::text), true);
    v_result := jsonb_set(v_result, '{order,pickup_required}', to_jsonb(v_fulfillment = 'TAKEOUT'::public.fulfillment_type), true);
    v_result := jsonb_set(v_result, '{order,total_amount}', to_jsonb(v_order_total), true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;

create or replace function public.get_public_order(
  p_tracking_token_hash text,
  p_device_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', order_record.id,
    'orderNo', order_record.order_no,
    'orderStatus', order_record.status,
    'paymentStatus', order_record.payment_status,
    'totalAmount', order_record.total,
    'createdAt', order_record.created_at,
    'confirmedAt', order_record.confirmed_at,
    'completedAt', order_record.completed_at,
    'stallName', stall.name,
    'fulfillmentType', order_record.fulfillment_type,
    'tableLabel', order_record.table_label,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'name', item.name,
        'quantity', item.quantity,
        'status', item.status,
        'note', item.note,
        'noteOptions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'groupName', note.group_name,
            'optionName', note.option_name,
            'priceDelta', note.price_delta
          ) order by note.sort_order, note.id)
          from public.order_item_note_options note where note.order_item_id = item.id
        ), '[]'::jsonb)
      ) order by item.created_at, item.id)
      from public.order_items item where item.order_id = order_record.id
    ), '[]'::jsonb)
  )
  from public.orders order_record
  join public.stalls stall on stall.id = order_record.stall_id
  where order_record.tracking_token_hash = p_tracking_token_hash
    and order_record.device_hash = p_device_hash;
$$;

revoke all on function public.get_public_order(text, text) from public, anon, authenticated;
grant execute on function public.get_public_order(text, text) to service_role;
