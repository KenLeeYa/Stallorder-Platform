-- Phase 1: introduce organization/profile scopes without breaking the legacy
-- Edge RPCs that still write tenant_id during the staged migration.

alter table public.tenants rename to organizations;

alter table public.organizations
  add column business_name text,
  add column default_timezone text not null default 'Asia/Taipei',
  add column default_currency text not null default 'TWD';

update public.organizations
set business_name = name
where business_name is null or btrim(business_name) = '';

alter table public.organizations alter column business_name set not null;

create or replace function public.normalize_organization_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.business_name := coalesce(nullif(btrim(new.business_name), ''), new.name);
  new.default_timezone := coalesce(nullif(btrim(new.default_timezone), ''), 'Asia/Taipei');
  new.default_currency := coalesce(nullif(btrim(new.default_currency), ''), 'TWD');
  return new;
end;
$$;

create trigger organizations_normalize_before_write
before insert or update on public.organizations
for each row execute function public.normalize_organization_record();

alter table public.user_accounts rename to profiles;
alter table public.profiles alter column password_hash drop not null;
alter table public.profiles
  add column avatar_url text,
  add column last_login_at timestamptz,
  add constraint profiles_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users(id) on delete set null;

alter table public.stalls
  add column organization_id uuid,
  add column code text,
  add column description text not null default '',
  add column address text,
  add column phone text not null default '',
  add column timezone text not null default 'Asia/Taipei',
  add column business_status public.stall_business_status not null default 'OPEN',
  add column ordering_enabled boolean not null default true,
  add column logo_url text,
  add column cover_image_url text;

update public.stalls
set organization_id = tenant_id,
    code = upper(regexp_replace(slug, '[^a-zA-Z0-9]+', '-', 'g')),
    address = location,
    business_status = case
      when is_sold_out then 'SOLD_OUT'::public.stall_business_status
      when ordering_state = 'PAUSED'::public.stall_ordering_state then 'PAUSED'::public.stall_business_status
      when ordering_state = 'CLOSED'::public.stall_ordering_state then 'CLOSED'::public.stall_business_status
      else 'OPEN'::public.stall_business_status
    end,
    ordering_enabled = ordering_state <> 'CLOSED'::public.stall_ordering_state;

alter table public.stalls
  alter column organization_id set not null,
  alter column code set not null,
  alter column address set not null,
  add constraint stalls_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade,
  add constraint stalls_scope_matches check (organization_id = tenant_id),
  add constraint stalls_organization_code_key unique (organization_id, code),
  add constraint stalls_id_organization_key unique (id, organization_id);

create index stalls_organization_active_idx
  on public.stalls (organization_id, is_active, business_status);

create or replace function public.sync_stall_foundation_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is null then
    new.organization_id := new.tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := new.organization_id;
  elsif new.organization_id <> new.tenant_id then
    raise exception 'STALL_ORGANIZATION_SCOPE_MISMATCH';
  end if;

  new.code := coalesce(
    nullif(upper(btrim(new.code)), ''),
    upper(regexp_replace(new.slug, '[^a-zA-Z0-9]+', '-', 'g'))
  );
  new.address := coalesce(nullif(btrim(new.address), ''), new.location);
  new.location := coalesce(nullif(btrim(new.location), ''), new.address);
  new.timezone := coalesce(nullif(btrim(new.timezone), ''), 'Asia/Taipei');

  if tg_op = 'INSERT' then
    if new.business_status <> 'OPEN'::public.stall_business_status then
      new.ordering_state := case new.business_status
        when 'PAUSED'::public.stall_business_status then 'PAUSED'::public.stall_ordering_state
        when 'CLOSED'::public.stall_business_status then 'CLOSED'::public.stall_ordering_state
        else 'OPEN'::public.stall_ordering_state
      end;
      new.is_sold_out := new.business_status = 'SOLD_OUT'::public.stall_business_status;
    elsif new.is_sold_out then
      new.business_status := 'SOLD_OUT'::public.stall_business_status;
    elsif new.ordering_state = 'PAUSED'::public.stall_ordering_state then
      new.business_status := 'PAUSED'::public.stall_business_status;
    elsif new.ordering_state = 'CLOSED'::public.stall_ordering_state then
      new.business_status := 'CLOSED'::public.stall_business_status;
    end if;
  elsif new.business_status is distinct from old.business_status then
    new.ordering_state := case new.business_status
      when 'PAUSED'::public.stall_business_status then 'PAUSED'::public.stall_ordering_state
      when 'CLOSED'::public.stall_business_status then 'CLOSED'::public.stall_ordering_state
      else 'OPEN'::public.stall_ordering_state
    end;
    new.is_sold_out := new.business_status = 'SOLD_OUT'::public.stall_business_status;
  elsif new.ordering_state is distinct from old.ordering_state
     or new.is_sold_out is distinct from old.is_sold_out then
    new.business_status := case
      when new.is_sold_out then 'SOLD_OUT'::public.stall_business_status
      when new.ordering_state = 'PAUSED'::public.stall_ordering_state then 'PAUSED'::public.stall_business_status
      when new.ordering_state = 'CLOSED'::public.stall_ordering_state then 'CLOSED'::public.stall_business_status
      else 'OPEN'::public.stall_business_status
    end;
  end if;

  if tg_op = 'UPDATE' and new.ordering_enabled is distinct from old.ordering_enabled then
    if not new.ordering_enabled then
      new.ordering_state := 'CLOSED'::public.stall_ordering_state;
      new.business_status := 'CLOSED'::public.stall_business_status;
      new.is_sold_out := false;
    elsif new.business_status = 'CLOSED'::public.stall_business_status then
      new.ordering_state := 'OPEN'::public.stall_ordering_state;
      new.business_status := 'OPEN'::public.stall_business_status;
    end if;
  else
    new.ordering_enabled := new.ordering_state <> 'CLOSED'::public.stall_ordering_state;
  end if;

  return new;
end;
$$;

create trigger stalls_sync_foundation_before_write
before insert or update on public.stalls
for each row execute function public.sync_stall_foundation_fields();

-- Every operational table keeps tenant_id temporarily for old Edge RPCs.
-- A trigger makes either name writable while rejecting mismatched scopes.
alter table public.stall_memberships add column organization_id uuid;
alter table public.audit_logs add column organization_id uuid;
alter table public.product_categories add column organization_id uuid;
alter table public.products add column organization_id uuid;
alter table public.qr_codes add column organization_id uuid;
alter table public.stall_ordering_settings add column organization_id uuid;
alter table public.order_sessions add column organization_id uuid;
alter table public.orders add column organization_id uuid;
alter table public.order_items add column organization_id uuid;
alter table public.order_events add column organization_id uuid;
alter table public.public_order_attempts add column organization_id uuid;

update public.stall_memberships set organization_id = tenant_id;
update public.audit_logs set organization_id = tenant_id;
update public.product_categories set organization_id = tenant_id;
update public.products set organization_id = tenant_id;
update public.qr_codes set organization_id = tenant_id;
update public.stall_ordering_settings set organization_id = tenant_id;
update public.order_sessions set organization_id = tenant_id;
update public.orders set organization_id = tenant_id;
update public.order_items set organization_id = tenant_id;
update public.order_events set organization_id = tenant_id;
update public.public_order_attempts set organization_id = tenant_id;

alter table public.stall_memberships alter column organization_id set not null;
alter table public.product_categories alter column organization_id set not null;
alter table public.products alter column organization_id set not null;
alter table public.qr_codes alter column organization_id set not null;
alter table public.stall_ordering_settings alter column organization_id set not null;
alter table public.order_sessions alter column organization_id set not null;
alter table public.orders alter column organization_id set not null;
alter table public.order_items alter column organization_id set not null;
alter table public.order_events alter column organization_id set not null;

create or replace function public.sync_legacy_organization_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is null then
    new.organization_id := new.tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := new.organization_id;
  elsif new.organization_id <> new.tenant_id then
    raise exception 'ORGANIZATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stall_memberships', 'audit_logs', 'product_categories', 'products',
    'qr_codes', 'stall_ordering_settings', 'order_sessions', 'orders',
    'order_items', 'order_events', 'public_order_attempts'
  ] loop
    execute format(
      'create trigger %I_sync_organization_before_write before insert or update on public.%I for each row execute function public.sync_legacy_organization_scope()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stall_memberships', 'audit_logs', 'product_categories', 'products',
    'qr_codes', 'stall_ordering_settings', 'order_sessions', 'orders',
    'order_items', 'order_events', 'public_order_attempts'
  ] loop
    execute format(
      'alter table public.%I add constraint %I foreign key (organization_id) references public.organizations(id) on delete cascade',
      table_name,
      table_name || '_organization_id_fkey'
    );
    execute format(
      'create index %I on public.%I (organization_id)',
      table_name || '_organization_id_idx',
      table_name
    );
  end loop;
end;
$$;

alter table public.public_rate_limit_buckets add column organization_id uuid;
alter table public.stall_order_counters add column organization_id uuid;

update public.public_rate_limit_buckets bucket
set organization_id = stall.organization_id
from public.stalls stall
where stall.id = bucket.stall_id;

update public.stall_order_counters counter
set organization_id = stall.organization_id
from public.stalls stall
where stall.id = counter.stall_id;

alter table public.public_rate_limit_buckets
  alter column organization_id set not null,
  add constraint public_rate_limit_buckets_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

alter table public.stall_order_counters
  alter column organization_id set not null,
  add constraint stall_order_counters_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

create or replace function public.derive_stall_organization_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stall_organization_id uuid;
begin
  select s.organization_id into stall_organization_id
  from public.stalls s
  where s.id = new.stall_id;

  if stall_organization_id is null then
    raise exception 'STALL_NOT_FOUND';
  end if;

  if new.organization_id is null then
    new.organization_id := stall_organization_id;
  elsif new.organization_id <> stall_organization_id then
    raise exception 'STALL_ORGANIZATION_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger public_rate_limit_scope_before_write
before insert or update on public.public_rate_limit_buckets
for each row execute function public.derive_stall_organization_scope();

create trigger stall_order_counter_scope_before_write
before insert or update on public.stall_order_counters
for each row execute function public.derive_stall_organization_scope();

create index public_rate_limit_buckets_organization_idx
  on public.public_rate_limit_buckets (organization_id, expires_at);
create index stall_order_counters_organization_idx
  on public.stall_order_counters (organization_id, business_date);

alter table public.stall_memberships add column profile_id uuid;
update public.stall_memberships set profile_id = user_id;
alter table public.stall_memberships
  alter column profile_id set not null,
  add constraint stall_memberships_profile_id_fkey
    foreign key (profile_id) references public.profiles(id) on delete cascade;

create or replace function public.sync_stall_membership_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id is null then
    new.profile_id := new.user_id;
  elsif new.user_id is null then
    new.user_id := new.profile_id;
  elsif new.profile_id <> new.user_id then
    raise exception 'PROFILE_SCOPE_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger stall_memberships_sync_profile_before_write
before insert or update on public.stall_memberships
for each row execute function public.sync_stall_membership_profile();

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.user_role not null,
  all_stalls boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_memberships_role_check check (
    role in (
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role,
      'FINANCE_VIEWER'::public.user_role
    )
  ),
  constraint organization_memberships_unique_role
    unique (organization_id, profile_id, role)
);

create index organization_memberships_profile_idx
  on public.organization_memberships (profile_id, is_active);
create index organization_memberships_organization_role_idx
  on public.organization_memberships (organization_id, role, is_active);

insert into public.organization_memberships (
  organization_id, profile_id, role, all_stalls, is_active, created_at, updated_at
)
select distinct
  sm.organization_id,
  sm.profile_id,
  'ORGANIZATION_OWNER'::public.user_role,
  true,
  sm.is_active,
  sm.created_at,
  sm.updated_at
from public.stall_memberships sm
where sm.role = 'MERCHANT_OWNER'::public.user_role
on conflict (organization_id, profile_id, role) do nothing;

update public.stall_memberships
set role = 'STALL_MANAGER'::public.user_role
where role = 'MERCHANT_MANAGER'::public.user_role;

delete from public.stall_memberships
where role = 'MERCHANT_OWNER'::public.user_role;

alter table public.stall_memberships
  drop constraint if exists stall_memberships_user_id_stall_id_key,
  add constraint stall_memberships_role_check check (
    role in (
      'STALL_MANAGER'::public.user_role,
      'STAFF'::public.user_role,
      'KITCHEN'::public.user_role
    )
  ),
  add constraint stall_memberships_unique_role unique (stall_id, profile_id, role),
  add constraint stall_memberships_stall_organization_fkey
    foreign key (stall_id, organization_id)
    references public.stalls(id, organization_id) on delete cascade;

alter table public.auth_sessions rename column user_id to profile_id;
alter table public.audit_logs rename column actor_user_id to actor_profile_id;

-- Compatibility views keep already-deployed SQL functions readable while all
-- new application code targets organizations and profiles directly.
create view public.tenants
with (security_invoker = true)
as
select id, name, slug, status, email, phone, created_at, updated_at
from public.organizations;

create view public.user_accounts
with (security_invoker = true)
as
select
  id, auth_user_id, email, password_hash, display_name, is_active,
  platform_role, created_at, updated_at
from public.profiles;

revoke all on public.tenants, public.user_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.tenants, public.user_accounts to service_role;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.is_active
      and p.platform_role = 'PLATFORM_ADMIN'::public.user_role
  );
$$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
  );
$$;

create or replace function public.has_organization_role(
  p_organization_id uuid,
  p_roles public.user_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and (p_roles is null or membership.role = any (p_roles))
  );
$$;

create or replace function public.can_access_stall(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or membership.all_stalls
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
  );
$$;

create or replace function public.has_stall_role(
  p_stall_id uuid,
  p_roles public.user_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and membership.role in (
        'ORGANIZATION_OWNER'::public.user_role,
        'ORGANIZATION_ADMIN'::public.user_role
      )
      and (membership.role = 'ORGANIZATION_OWNER'::public.user_role or membership.all_stalls)
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and (p_roles is null or membership.role = any (p_roles))
  );
$$;

revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_organization_member(uuid) from public, anon;
revoke all on function public.has_organization_role(uuid, public.user_role[]) from public, anon;
revoke all on function public.can_access_stall(uuid) from public, anon;
revoke all on function public.has_stall_role(uuid, public.user_role[]) from public, anon;

grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.has_organization_role(uuid, public.user_role[]) to authenticated;
grant execute on function public.can_access_stall(uuid) to authenticated;
grant execute on function public.has_stall_role(uuid, public.user_role[]) to authenticated;

drop policy if exists tenants_member_select on public.organizations;
drop policy if exists stalls_member_select on public.stalls;
drop policy if exists user_accounts_self_select on public.profiles;
drop policy if exists memberships_self_or_owner_select on public.stall_memberships;
drop policy if exists product_categories_member_select on public.product_categories;
drop policy if exists products_member_select on public.products;
drop policy if exists qr_codes_manager_select on public.qr_codes;
drop policy if exists ordering_settings_manager_select on public.stall_ordering_settings;
drop policy if exists orders_member_select on public.orders;
drop policy if exists order_items_member_select on public.order_items;
drop policy if exists order_events_member_select on public.order_events;
drop policy if exists audit_logs_manager_select on public.audit_logs;

alter table public.organization_memberships enable row level security;
alter table public.organization_memberships force row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select on public.organizations, public.stalls, public.profiles,
  public.organization_memberships, public.stall_memberships,
  public.product_categories, public.products, public.orders,
  public.order_items, public.order_events, public.qr_codes,
  public.stall_ordering_settings, public.audit_logs to authenticated;

create policy organizations_member_select on public.organizations
for select to authenticated
using (public.is_platform_admin() or public.is_organization_member(id));

create policy stalls_member_select on public.stalls
for select to authenticated
using (public.can_access_stall(id));

create policy profiles_self_or_team_select on public.profiles
for select to authenticated
using (
  id = public.current_profile_id()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.organization_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.has_organization_role(
        target_membership.organization_id,
        array[
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role
        ]
      )
  )
  or exists (
    select 1
    from public.stall_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.can_access_stall(target_membership.stall_id)
      and public.has_organization_role(
        target_membership.organization_id,
        array[
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role
        ]
      )
  )
);

create policy organization_memberships_authorized_select
on public.organization_memberships
for select to authenticated
using (
  profile_id = public.current_profile_id()
  or public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role
    ]
  )
);

create policy stall_memberships_authorized_select
on public.stall_memberships
for select to authenticated
using (
  profile_id = public.current_profile_id()
  or public.has_organization_role(
    organization_id,
    array[
      'ORGANIZATION_OWNER'::public.user_role,
      'ORGANIZATION_ADMIN'::public.user_role
    ]
  )
  and public.can_access_stall(stall_id)
  or public.has_stall_role(
    stall_id,
    array['STALL_MANAGER'::public.user_role]
  )
);

create policy product_categories_stall_select on public.product_categories
for select to authenticated using (public.can_access_stall(stall_id));

create policy products_stall_select on public.products
for select to authenticated using (public.can_access_stall(stall_id));

create policy qr_codes_manager_select on public.qr_codes
for select to authenticated
using (
  public.has_stall_role(
    stall_id,
    array['STALL_MANAGER'::public.user_role]
  )
);

create policy ordering_settings_manager_select on public.stall_ordering_settings
for select to authenticated
using (
  public.has_stall_role(
    stall_id,
    array['STALL_MANAGER'::public.user_role]
  )
);

create policy orders_stall_select on public.orders
for select to authenticated using (public.can_access_stall(stall_id));

create policy order_items_stall_select on public.order_items
for select to authenticated using (public.can_access_stall(stall_id));

create policy order_events_stall_select on public.order_events
for select to authenticated using (public.can_access_stall(stall_id));

create policy audit_logs_manager_select on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.has_organization_role(
      organization_id,
      array[
        'ORGANIZATION_OWNER'::public.user_role,
        'ORGANIZATION_ADMIN'::public.user_role
      ]
    )
  )
  or (
    stall_id is not null
    and public.has_stall_role(
      stall_id,
      array['STALL_MANAGER'::public.user_role]
    )
  )
);
