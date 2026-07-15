-- Dine-in fulfillment, configurable checkout modules, product localization, and item production state.
do $$
begin
  create type public.fulfillment_type as enum ('TAKEOUT', 'DINE_IN');
exception when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.order_item_status as enum ('PENDING', 'PREPARING', 'READY', 'SERVED');
exception when duplicate_object then null;
end;
$$;

do $$
begin
  create type public.payment_option_kind as enum ('CASH', 'LINE_PAY', 'JKO_PAY', 'CUSTOM');
exception when duplicate_object then null;
end;
$$;

alter table public.organization_memberships
  add column if not exists is_primary_owner boolean not null default false;

with ranked_owners as (
  select id, row_number() over (partition by organization_id order by created_at, id) as owner_rank
  from public.organization_memberships
  where role = 'ORGANIZATION_OWNER'::public.user_role and is_active
)
update public.organization_memberships membership
set is_primary_owner = true
from ranked_owners ranked
where membership.id = ranked.id and ranked.owner_rank = 1
  and not exists (
    select 1 from public.organization_memberships existing
    where existing.organization_id = membership.organization_id and existing.is_primary_owner
  );

create unique index if not exists organization_memberships_primary_owner_key
  on public.organization_memberships (organization_id) where is_primary_owner;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_primary_owner_role_check;
alter table public.organization_memberships
  add constraint organization_memberships_primary_owner_role_check
  check (not is_primary_owner or (role = 'ORGANIZATION_OWNER'::public.user_role and is_active));

create table if not exists public.product_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  locale text not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_translations_product_locale_key unique (product_id, locale),
  constraint product_translations_locale_check check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint product_translations_name_check check (char_length(name) between 1 and 120),
  constraint product_translations_description_check check (char_length(description) <= 500)
);
create index if not exists product_translations_organization_locale_idx
  on public.product_translations (organization_id, locale);

create table if not exists public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  code text not null,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dining_tables_stall_code_key unique (stall_id, code),
  constraint dining_tables_code_check check (code ~ '^[A-Z0-9-]{1,20}$'),
  constraint dining_tables_label_check check (char_length(label) between 1 and 40),
  constraint dining_tables_sort_order_check check (sort_order between 0 and 10000)
);
create index if not exists dining_tables_organization_stall_active_idx
  on public.dining_tables (organization_id, stall_id, is_active);

create table if not exists public.payment_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  code text not null,
  name text not null,
  kind public.payment_option_kind not null,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_options_stall_code_key unique (stall_id, code),
  constraint payment_options_code_check check (code ~ '^[A-Z0-9_-]{1,30}$'),
  constraint payment_options_name_check check (char_length(name) between 1 and 50),
  constraint payment_options_sort_order_check check (sort_order between 0 and 10000)
);
create index if not exists payment_options_organization_stall_enabled_idx
  on public.payment_options (organization_id, stall_id, is_enabled);

create table if not exists public.discount_options (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stall_id uuid not null references public.stalls(id) on delete cascade,
  name text not null,
  rate_bps integer not null,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_options_name_check check (char_length(name) between 1 and 50),
  constraint discount_options_rate_check check (rate_bps between 1 and 10000),
  constraint discount_options_sort_order_check check (sort_order between 0 and 10000)
);
create index if not exists discount_options_organization_stall_enabled_idx
  on public.discount_options (organization_id, stall_id, is_enabled);

alter table public.qr_codes add column if not exists dining_table_id uuid;
alter table public.qr_codes drop constraint if exists qr_codes_dining_table_id_fkey;
alter table public.qr_codes add constraint qr_codes_dining_table_id_fkey
  foreign key (dining_table_id) references public.dining_tables(id) on delete cascade;
drop index if exists public.qr_codes_stall_token_version_key;
alter table public.qr_codes drop constraint if exists qr_codes_stall_id_token_version_key;
create unique index if not exists qr_codes_takeout_token_version_key
  on public.qr_codes (stall_id, token_version) where dining_table_id is null;
create unique index if not exists qr_codes_table_token_version_key
  on public.qr_codes (dining_table_id, token_version) where dining_table_id is not null;
create index if not exists qr_codes_dining_table_state_idx
  on public.qr_codes (dining_table_id, state) where dining_table_id is not null;

alter table public.stall_ordering_settings
  add column if not exists dine_in_enabled boolean not null default true,
  add column if not exists print_module_enabled boolean not null default false,
  add column if not exists payment_module_enabled boolean not null default true,
  add column if not exists discount_module_enabled boolean not null default false;

alter table public.orders
  add column if not exists dining_table_id uuid,
  add column if not exists fulfillment_type public.fulfillment_type not null default 'TAKEOUT',
  add column if not exists subtotal integer,
  add column if not exists discount_amount integer not null default 0,
  add column if not exists discount_option_id uuid,
  add column if not exists discount_label text,
  add column if not exists discount_rate_bps integer;
update public.orders set subtotal = total where subtotal is null;
alter table public.orders alter column subtotal set not null;
alter table public.orders alter column pickup_code_hash drop not null;
alter table public.orders drop constraint if exists orders_dining_table_id_fkey;
alter table public.orders add constraint orders_dining_table_id_fkey
  foreign key (dining_table_id) references public.dining_tables(id) on delete set null;
alter table public.orders drop constraint if exists orders_discount_option_id_fkey;
alter table public.orders add constraint orders_discount_option_id_fkey
  foreign key (discount_option_id) references public.discount_options(id) on delete set null;
alter table public.orders drop constraint if exists orders_checkout_amounts_check;
alter table public.orders add constraint orders_checkout_amounts_check check (
  subtotal >= 0 and discount_amount >= 0 and total >= 0
  and subtotal - discount_amount = total
  and (discount_rate_bps is null or discount_rate_bps between 1 and 10000)
  and (fulfillment_type <> 'DINE_IN'::public.fulfillment_type or table_label is not null)
);
create index if not exists orders_stall_table_status_idx
  on public.orders (stall_id, dining_table_id, status) where fulfillment_type = 'DINE_IN';

alter table public.payments
  add column if not exists payment_option_id uuid,
  add column if not exists method_label text not null default '現金',
  add column if not exists cash_received integer,
  add column if not exists change_amount integer;
alter table public.payments drop constraint if exists payments_payment_option_id_fkey;
alter table public.payments add constraint payments_payment_option_id_fkey
  foreign key (payment_option_id) references public.payment_options(id) on delete set null;
alter table public.payments drop constraint if exists payments_cash_change_check;
alter table public.payments add constraint payments_cash_change_check check (
  char_length(method_label) between 1 and 50
  and (cash_received is null or cash_received >= amount)
  and (change_amount is null or change_amount >= 0)
  and ((cash_received is null and change_amount is null) or change_amount = cash_received - amount)
);
create index if not exists payments_option_paid_idx on public.payments (payment_option_id, paid_at);

alter table public.order_items
  add column if not exists status public.order_item_status not null default 'PENDING',
  add column if not exists preparing_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists served_at timestamptz;
create index if not exists order_items_order_status_idx on public.order_items (order_id, status);

insert into public.payment_options (organization_id, stall_id, code, name, kind, is_enabled, sort_order)
select stall.organization_id, stall.id, defaults.code, defaults.name, defaults.kind, defaults.is_enabled, defaults.sort_order
from public.stalls stall
cross join (values
  ('CASH', '現金', 'CASH'::public.payment_option_kind, true, 1),
  ('LINE_PAY', 'LINE Pay', 'LINE_PAY'::public.payment_option_kind, true, 2),
  ('JKO_PAY', '街口支付', 'JKO_PAY'::public.payment_option_kind, true, 3)
) as defaults(code, name, kind, is_enabled, sort_order)
on conflict (stall_id, code) do nothing;

create or replace function public.enforce_extended_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_stall_id uuid;
begin
  if tg_table_name = 'product_translations' then
    select organization_id into v_organization_id from public.products where id = new.product_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'PRODUCT_TRANSLATION_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name in ('dining_tables', 'payment_options', 'discount_options') then
    select organization_id into v_organization_id from public.stalls where id = new.stall_id;
    if v_organization_id is null or v_organization_id <> new.organization_id then raise exception 'STALL_CONFIGURATION_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name = 'qr_codes' then
    if new.dining_table_id is not null then
      select organization_id, stall_id into v_organization_id, v_stall_id from public.dining_tables where id = new.dining_table_id;
      if v_organization_id is null or v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then raise exception 'QR_TABLE_SCOPE_MISMATCH'; end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'orders' then
    if new.dining_table_id is not null then
      select organization_id, stall_id into v_organization_id, v_stall_id from public.dining_tables where id = new.dining_table_id;
      if v_organization_id is null or v_organization_id <> new.organization_id or v_stall_id <> new.stall_id then raise exception 'ORDER_TABLE_SCOPE_MISMATCH'; end if;
    end if;
    if new.discount_option_id is not null and not exists (
      select 1 from public.discount_options discount
      where discount.id = new.discount_option_id and discount.organization_id = new.organization_id and discount.stall_id = new.stall_id
    ) then raise exception 'ORDER_DISCOUNT_SCOPE_MISMATCH'; end if;
    return new;
  end if;

  if tg_table_name = 'payments' then
    if new.payment_option_id is not null and not exists (
      select 1 from public.payment_options option_record
      where option_record.id = new.payment_option_id and option_record.organization_id = new.organization_id and option_record.stall_id = new.stall_id
    ) then raise exception 'PAYMENT_OPTION_SCOPE_MISMATCH'; end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists product_translations_scope_before_write on public.product_translations;
create trigger product_translations_scope_before_write before insert or update on public.product_translations
for each row execute function public.enforce_extended_scope();
drop trigger if exists dining_tables_scope_before_write on public.dining_tables;
create trigger dining_tables_scope_before_write before insert or update on public.dining_tables
for each row execute function public.enforce_extended_scope();
drop trigger if exists payment_options_scope_before_write on public.payment_options;
create trigger payment_options_scope_before_write before insert or update on public.payment_options
for each row execute function public.enforce_extended_scope();
drop trigger if exists discount_options_scope_before_write on public.discount_options;
create trigger discount_options_scope_before_write before insert or update on public.discount_options
for each row execute function public.enforce_extended_scope();
drop trigger if exists qr_codes_table_scope_before_write on public.qr_codes;
create trigger qr_codes_table_scope_before_write before insert or update of dining_table_id on public.qr_codes
for each row execute function public.enforce_extended_scope();
drop trigger if exists orders_extended_scope_before_write on public.orders;
create trigger orders_extended_scope_before_write before insert or update of dining_table_id, discount_option_id on public.orders
for each row execute function public.enforce_extended_scope();
drop trigger if exists payments_option_scope_before_write on public.payments;
create trigger payments_option_scope_before_write before insert or update of payment_option_id on public.payments
for each row execute function public.enforce_extended_scope();

alter table public.product_translations enable row level security;
alter table public.product_translations force row level security;
alter table public.dining_tables enable row level security;
alter table public.dining_tables force row level security;
alter table public.payment_options enable row level security;
alter table public.payment_options force row level security;
alter table public.discount_options enable row level security;
alter table public.discount_options force row level security;

revoke all on public.product_translations, public.dining_tables, public.payment_options, public.discount_options from public, anon, authenticated;
grant select on public.product_translations, public.dining_tables, public.payment_options, public.discount_options to authenticated;
grant select, insert, update, delete on public.product_translations, public.dining_tables, public.payment_options, public.discount_options to service_role;

create policy product_translations_authorized_select on public.product_translations
for select to authenticated using (
  public.has_organization_wide_staff_access(organization_id)
  or exists (
    select 1 from public.stall_products assignment
    where assignment.product_id = product_translations.product_id and public.can_access_stall(assignment.stall_id)
  )
);
create policy dining_tables_authorized_select on public.dining_tables
for select to authenticated using (public.can_access_stall(stall_id));
create policy payment_options_authorized_select on public.payment_options
for select to authenticated using (public.can_access_stall(stall_id));
create policy discount_options_authorized_select on public.discount_options
for select to authenticated using (public.can_access_stall(stall_id));

revoke all on function public.enforce_extended_scope() from public, anon, authenticated;
grant execute on function public.enforce_extended_scope() to service_role;

create or replace function public.emit_order_item_operational_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.operational_events (
      organization_id, stall_id, event_type, entity_type, entity_id, payload
    ) values (
      new.organization_id,
      new.stall_id,
      'ORDER_ITEM_STATUS_CHANGED',
      'ORDER_ITEM',
      new.id,
      jsonb_build_object('orderId', new.order_id, 'status', new.status, 'name', new.name)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_emit_operational_after_update on public.order_items;
create trigger order_items_emit_operational_after_update
after update of status on public.order_items
for each row execute function public.emit_order_item_operational_event();
revoke all on function public.emit_order_item_operational_event() from public, anon, authenticated;
grant execute on function public.emit_order_item_operational_event() to service_role;

create or replace function public.lookup_public_order_idempotency(
  p_session_token_hash text,
  p_idempotency_key uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', order_record.id,
    'order_no', order_record.order_no,
    'order_status', order_record.status,
    'payment_status', order_record.payment_status,
    'total_amount', order_record.total,
    'fulfillment_type', order_record.fulfillment_type,
    'pickup_required', order_record.fulfillment_type = 'TAKEOUT'::public.fulfillment_type,
    'created_at', order_record.created_at
  )
  from public.order_sessions session_record
  join public.orders order_record on order_record.id = session_record.order_id
  where session_record.token_hash = p_session_token_hash
    and order_record.idempotency_key = p_idempotency_key;
$$;

create or replace function public.rebuild_daily_stall_summary(
  p_stall_id uuid,
  p_date_from date,
  p_date_to date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stall public.stalls%rowtype;
  v_count integer;
begin
  if p_date_from is null or p_date_to is null or p_date_to < p_date_from then raise exception 'INVALID_SUMMARY_DATE_RANGE'; end if;
  if p_date_to - p_date_from > 366 then raise exception 'SUMMARY_DATE_RANGE_TOO_LARGE'; end if;
  select * into v_stall from public.stalls where id = p_stall_id;
  if not found then raise exception 'STALL_NOT_FOUND'; end if;

  with date_range as (
    select day::date as business_date from generate_series(p_date_from, p_date_to, interval '1 day') day
  ), order_stats as (
    select
      date_range.business_date,
      count(order_record.id)::integer as order_count,
      count(order_record.id) filter (where order_record.status in (
        'CONFIRMED'::public.order_status, 'PREPARING'::public.order_status,
        'READY'::public.order_status, 'COMPLETED'::public.order_status
      ))::integer as confirmed_order_count,
      count(order_record.id) filter (where order_record.status = 'COMPLETED'::public.order_status)::integer as completed_order_count,
      count(order_record.id) filter (where order_record.status = 'CANCELLED'::public.order_status)::integer as cancelled_order_count,
      count(order_record.id) filter (where order_record.status in (
        'WAITING_CONFIRMATION'::public.order_status, 'CONFIRMED'::public.order_status,
        'PREPARING'::public.order_status, 'READY'::public.order_status
      ))::integer as pending_order_count,
      count(order_record.id) filter (
        where order_record.payment_status = 'UNPAID'::public.payment_status
          and order_record.status not in ('CANCELLED'::public.order_status, 'EXPIRED'::public.order_status)
      )::integer as unpaid_order_count,
      coalesce(sum(order_record.subtotal) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as gross_sales,
      coalesce(sum(order_record.discount_amount) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as discount_amount,
      coalesce(sum(order_record.total) filter (where order_record.status = 'COMPLETED'::public.order_status), 0)::integer as net_sales,
      max(order_record.created_at) as last_order_at
    from date_range
    left join public.orders order_record on order_record.stall_id = v_stall.id
      and (order_record.created_at at time zone v_stall.timezone)::date = date_range.business_date
    group by date_range.business_date
  ), payment_stats as (
    select
      date_range.business_date,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'CASH'::public.payment_method), 0)::integer as cash_amount,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'MANUAL_TRANSFER'::public.payment_method), 0)::integer as manual_transfer_amount,
      coalesce(sum(payment.amount) filter (where payment.status = 'PAID'::public.payment_status and payment.method = 'OTHER'::public.payment_method), 0)::integer as other_payment_amount
    from date_range
    left join public.orders payment_order on payment_order.stall_id = v_stall.id
      and (payment_order.created_at at time zone v_stall.timezone)::date = date_range.business_date
    left join public.payments payment on payment.order_id = payment_order.id
    group by date_range.business_date
  )
  insert into public.daily_stall_summaries (
    organization_id, stall_id, business_date, order_count, confirmed_order_count,
    completed_order_count, cancelled_order_count, pending_order_count, unpaid_order_count,
    gross_sales, discount_amount, net_sales, cash_amount, manual_transfer_amount,
    other_payment_amount, average_order_value, last_order_at, last_calculated_at, updated_at
  )
  select
    v_stall.organization_id, v_stall.id, order_stats.business_date, order_stats.order_count,
    order_stats.confirmed_order_count, order_stats.completed_order_count, order_stats.cancelled_order_count,
    order_stats.pending_order_count, order_stats.unpaid_order_count, order_stats.gross_sales,
    order_stats.discount_amount, order_stats.net_sales, payment_stats.cash_amount,
    payment_stats.manual_transfer_amount, payment_stats.other_payment_amount,
    case when order_stats.completed_order_count = 0 then 0
      else round(order_stats.net_sales::numeric / order_stats.completed_order_count)::integer end,
    order_stats.last_order_at, now(), now()
  from order_stats join payment_stats using (business_date)
  on conflict (stall_id, business_date) do update set
    organization_id = excluded.organization_id,
    order_count = excluded.order_count,
    confirmed_order_count = excluded.confirmed_order_count,
    completed_order_count = excluded.completed_order_count,
    cancelled_order_count = excluded.cancelled_order_count,
    pending_order_count = excluded.pending_order_count,
    unpaid_order_count = excluded.unpaid_order_count,
    gross_sales = excluded.gross_sales,
    discount_amount = excluded.discount_amount,
    net_sales = excluded.net_sales,
    cash_amount = excluded.cash_amount,
    manual_transfer_amount = excluded.manual_transfer_amount,
    other_payment_amount = excluded.other_payment_amount,
    average_order_value = excluded.average_order_value,
    last_order_at = excluded.last_order_at,
    last_calculated_at = excluded.last_calculated_at,
    updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

drop trigger if exists orders_daily_summary_after_write on public.orders;
create trigger orders_daily_summary_after_write
after insert or update of status, payment_status, subtotal, discount_amount, total, created_at, stall_id or delete
on public.orders for each row execute function public.refresh_order_daily_summary();

create or replace function public.initialize_order_checkout_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.subtotal := coalesce(new.subtotal, new.total);
  new.discount_amount := coalesce(new.discount_amount, 0);
  return new;
end;
$$;
drop trigger if exists orders_initialize_checkout_before_insert on public.orders;
create trigger orders_initialize_checkout_before_insert
before insert on public.orders for each row execute function public.initialize_order_checkout_fields();
revoke all on function public.initialize_order_checkout_fields() from public, anon, authenticated;
grant execute on function public.initialize_order_checkout_fields() to service_role;

alter function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) rename to create_public_order_legacy;

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
  v_table_id uuid;
  v_table_label text;
  v_table_active boolean;
  v_dine_in_enabled boolean;
  v_fulfillment public.fulfillment_type := 'TAKEOUT'::public.fulfillment_type;
begin
  select qr.dining_table_id, settings.dine_in_enabled
  into v_table_id, v_dine_in_enabled
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

  v_result := public.create_public_order_legacy(
    p_order_id, p_qr_token, p_session_token_hash, p_device_hash, p_ip_hash,
    p_qr_token_hash, p_behavior_hash, p_idempotency_key, p_idempotency_hash,
    p_customer_name, p_customer_note, p_items, p_tracking_token_hash,
    p_pickup_code_hash, p_request_id
  );

  if coalesce((v_result->>'ok')::boolean, false) and v_result ? 'order' then
    v_order_id := (v_result #>> '{order,order_id}')::uuid;
    if v_table_id is not null then
      v_fulfillment := 'DINE_IN'::public.fulfillment_type;
      update public.orders
      set dining_table_id = v_table_id,
          table_label = v_table_label,
          fulfillment_type = v_fulfillment,
          pickup_code_hash = null,
          subtotal = total
      where id = v_order_id;
    else
      update public.orders set subtotal = total where id = v_order_id;
    end if;
    v_result := jsonb_set(v_result, '{order,fulfillment_type}', to_jsonb(v_fulfillment::text), true);
    v_result := jsonb_set(v_result, '{order,pickup_required}', to_jsonb(v_fulfillment = 'TAKEOUT'::public.fulfillment_type), true);
  end if;
  return v_result;
end;
$$;

revoke all on function public.create_public_order_legacy(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_public_order(
  uuid, text, text, text, text, text, text, uuid, text, text, text,
  jsonb, text, text, text
) to service_role;
