-- Remove authorization helpers from the exposed Data API schema while
-- preserving their SECURITY DEFINER behavior for recursive RLS checks.

create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_private to authenticated, service_role;

alter function public.current_profile_id() set schema app_private;
alter function public.is_platform_admin() set schema app_private;
alter function public.is_organization_member(uuid) set schema app_private;
alter function public.has_organization_role(uuid, public.user_role[]) set schema app_private;
alter function public.can_access_stall(uuid) set schema app_private;
alter function public.has_stall_role(uuid, public.user_role[]) set schema app_private;
alter function public.effective_stall_product_price(uuid, uuid) set schema app_private;
alter function public.can_access_organization_catalog(uuid) set schema app_private;
alter function public.can_view_stall_financials(uuid) set schema app_private;
alter function public.has_organization_wide_staff_access(uuid) set schema app_private;
alter function public.can_manage_stall(uuid) set schema app_private;
alter function public.can_view_orders(uuid) set schema app_private;
alter function public.stall_business_date(uuid, timestamptz) set schema app_private;
alter function public.is_current_profile(uuid) set schema app_private;
alter function public.can_view_kds(uuid) set schema app_private;
alter function public.can_view_cash_shift(uuid) set schema app_private;

-- SQL function bodies are stored as text, so references between moved helpers
-- must be schema-qualified again after ALTER FUNCTION ... SET SCHEMA.
create or replace function app_private.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
  );
$$;

create or replace function app_private.has_organization_role(
  p_organization_id uuid,
  p_roles public.user_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (p_roles is null or membership.role = any (p_roles))
  );
$$;

create or replace function app_private.can_access_stall(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or membership.all_stalls
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
  );
$$;

create or replace function app_private.has_stall_role(
  p_stall_id uuid,
  p_roles public.user_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and membership.role in (
        'ORGANIZATION_OWNER'::public.user_role,
        'ORGANIZATION_ADMIN'::public.user_role
      )
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or membership.all_stalls
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (p_roles is null or membership.role = any (p_roles))
  );
$$;

create or replace function app_private.can_access_organization_catalog(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or app_private.is_organization_member(p_organization_id)
    or exists (
      select 1
      from public.stall_memberships membership
      where membership.organization_id = p_organization_id
        and membership.profile_id = app_private.current_profile_id()
        and membership.is_active
    );
$$;

create or replace function app_private.can_view_stall_financials(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1
      from public.stalls stall
      join public.organization_memberships membership
        on membership.organization_id = stall.organization_id
      where stall.id = p_stall_id
        and membership.profile_id = app_private.current_profile_id()
        and membership.is_active
        and membership.role in (
          'ORGANIZATION_OWNER'::public.user_role,
          'ORGANIZATION_ADMIN'::public.user_role,
          'FINANCE_VIEWER'::public.user_role
        )
        and (
          membership.role <> 'ORGANIZATION_ADMIN'::public.user_role
          or membership.all_stalls
          or app_private.can_access_stall(p_stall_id)
        )
    )
    or app_private.has_stall_role(
      p_stall_id,
      array['STALL_MANAGER'::public.user_role]
    );
$$;

create or replace function app_private.has_organization_wide_staff_access(
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  );
$$;

create or replace function app_private.can_manage_stall(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and membership.role = 'STALL_MANAGER'::public.user_role
  );
$$;

create or replace function app_private.can_view_orders(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and membership.role in (
        'STALL_MANAGER'::public.user_role,
        'STAFF'::public.user_role
      )
  );
$$;

create or replace function app_private.can_view_kds(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin() or exists (
    select 1
    from public.stalls stall
    join public.organization_memberships membership
      on membership.organization_id = stall.organization_id
    where stall.id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and (
            membership.all_stalls
            or exists (
              select 1
              from public.stall_memberships stall_membership
              where stall_membership.stall_id = p_stall_id
                and stall_membership.profile_id = membership.profile_id
                and stall_membership.is_active
            )
          )
        )
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = app_private.current_profile_id()
      and membership.is_active
      and membership.role in (
        'STALL_MANAGER'::public.user_role,
        'KITCHEN'::public.user_role
      )
  );
$$;

create or replace function app_private.can_view_cash_shift(p_stall_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_view_stall_financials(p_stall_id)
    or app_private.has_stall_role(
      p_stall_id,
      array['STAFF'::public.user_role]
    );
$$;

revoke all on function app_private.current_profile_id()
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_platform_admin()
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_organization_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.has_organization_role(uuid, public.user_role[])
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_access_stall(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.has_stall_role(uuid, public.user_role[])
  from public, anon, authenticated, service_role;
revoke all on function app_private.effective_stall_product_price(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_access_organization_catalog(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_stall_financials(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.has_organization_wide_staff_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_manage_stall(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_orders(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.stall_business_date(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_current_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_kds(uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.can_view_cash_shift(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  app_private.current_profile_id(),
  app_private.is_platform_admin(),
  app_private.is_organization_member(uuid),
  app_private.has_organization_role(uuid, public.user_role[]),
  app_private.can_access_stall(uuid),
  app_private.has_stall_role(uuid, public.user_role[]),
  app_private.effective_stall_product_price(uuid, uuid),
  app_private.can_access_organization_catalog(uuid),
  app_private.can_view_stall_financials(uuid),
  app_private.has_organization_wide_staff_access(uuid),
  app_private.can_manage_stall(uuid),
  app_private.can_view_orders(uuid),
  app_private.stall_business_date(uuid, timestamptz),
  app_private.is_current_profile(uuid),
  app_private.can_view_kds(uuid),
  app_private.can_view_cash_shift(uuid)
to authenticated;

grant execute on function
  app_private.effective_stall_product_price(uuid, uuid),
  app_private.stall_business_date(uuid, timestamptz),
  app_private.is_current_profile(uuid)
to service_role;

-- Compatibility entry points remain available to trusted SQL callers, but now
-- run as the caller and authorize the requested stall before invoking the
-- hidden implementation. They are no longer privileged Data API RPCs.
create function public.effective_stall_product_price(
  p_stall_id uuid,
  p_product_id uuid
)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.effective_stall_product_price(p_stall_id, p_product_id)
  where current_user in ('postgres', 'service_role')
     or app_private.can_access_stall(p_stall_id);
$$;

create function public.stall_business_date(
  p_stall_id uuid,
  p_timestamp timestamptz
)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.stall_business_date(p_stall_id, p_timestamp)
  where current_user in ('postgres', 'service_role')
     or app_private.can_access_stall(p_stall_id);
$$;

revoke all on function public.effective_stall_product_price(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.stall_business_date(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.effective_stall_product_price(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.stall_business_date(uuid, timestamptz)
  to authenticated, service_role;

-- Replace parallel permissive SELECT policies with one equivalent OR policy
-- per table. This preserves applicant and platform-admin visibility.
drop policy if exists merchant_applications_applicant_select
  on public.merchant_applications;
drop policy if exists merchant_applications_platform_admin_select
  on public.merchant_applications;
drop policy if exists merchant_applications_authorized_select
  on public.merchant_applications;

create policy merchant_applications_authorized_select
on public.merchant_applications
for select to authenticated
using (
  app_private.is_current_profile(applicant_profile_id)
  or app_private.is_platform_admin()
);

drop policy if exists merchant_application_notifications_owner_select
  on public.merchant_application_notifications;
drop policy if exists merchant_application_notifications_platform_admin_select
  on public.merchant_application_notifications;
drop policy if exists merchant_application_notifications_authorized_select
  on public.merchant_application_notifications;

create policy merchant_application_notifications_authorized_select
on public.merchant_application_notifications
for select to authenticated
using (
  app_private.is_current_profile(profile_id)
  or app_private.is_platform_admin()
);

-- New public functions must opt in to Data API execution explicitly.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
