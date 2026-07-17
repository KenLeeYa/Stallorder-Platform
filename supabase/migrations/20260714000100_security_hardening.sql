-- Least-privilege RLS, safe column grants, and concurrency guards.

create or replace function public.has_organization_wide_staff_access(p_organization_id uuid)
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
      and (
        membership.role = 'ORGANIZATION_OWNER'::public.user_role
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  );
$$;

create or replace function public.can_manage_stall(p_stall_id uuid)
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
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and membership.role = 'STALL_MANAGER'::public.user_role
  );
$$;

create or replace function public.can_view_orders(p_stall_id uuid)
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
        or (
          membership.role = 'ORGANIZATION_ADMIN'::public.user_role
          and membership.all_stalls
        )
      )
  ) or exists (
    select 1
    from public.stall_memberships membership
    where membership.stall_id = p_stall_id
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and membership.role in (
        'STALL_MANAGER'::public.user_role,
        'STAFF'::public.user_role,
        'KITCHEN'::public.user_role
      )
  );
$$;

revoke all on function public.has_organization_wide_staff_access(uuid) from public, anon;
revoke all on function public.can_manage_stall(uuid) from public, anon;
revoke all on function public.can_view_orders(uuid) from public, anon;
grant execute on function public.has_organization_wide_staff_access(uuid) to authenticated;
grant execute on function public.can_manage_stall(uuid) to authenticated;
grant execute on function public.can_view_orders(uuid) to authenticated;

revoke select on public.profiles from authenticated;
grant select (
  id, email, display_name, avatar_url, is_active, last_login_at, created_at, updated_at
) on public.profiles to authenticated;

revoke select on public.orders from authenticated;
grant select (
  id, organization_id, stall_id, order_no, source, customer_name, table_label,
  note, status, payment_status, total, pickup_verified_at,
  confirmation_expires_at, confirmed_at, expired_at, completed_at,
  created_at, updated_at, paid_at
) on public.orders to authenticated;

drop policy if exists profiles_self_or_team_select on public.profiles;
create policy profiles_self_or_team_select on public.profiles
for select to authenticated
using (
  id = public.current_profile_id()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.organization_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.has_organization_wide_staff_access(target_membership.organization_id)
  )
  or exists (
    select 1
    from public.stall_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.can_manage_stall(target_membership.stall_id)
  )
);

drop policy if exists organization_memberships_authorized_select on public.organization_memberships;
create policy organization_memberships_authorized_select on public.organization_memberships
for select to authenticated
using (
  profile_id = public.current_profile_id()
  or public.has_organization_wide_staff_access(organization_id)
);

drop policy if exists stall_memberships_authorized_select on public.stall_memberships;
create policy stall_memberships_authorized_select on public.stall_memberships
for select to authenticated
using (
  profile_id = public.current_profile_id()
  or public.can_manage_stall(stall_id)
);

drop policy if exists orders_stall_select on public.orders;
create policy orders_stall_select on public.orders
for select to authenticated using (public.can_view_orders(stall_id));

drop policy if exists order_items_stall_select on public.order_items;
create policy order_items_stall_select on public.order_items
for select to authenticated using (public.can_view_orders(stall_id));

drop policy if exists order_events_stall_select on public.order_events;
create policy order_events_stall_select on public.order_events
for select to authenticated using (public.can_view_orders(stall_id));

drop policy if exists audit_logs_manager_select on public.audit_logs;
create policy audit_logs_manager_select on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (
    stall_id is null
    and organization_id is not null
    and public.has_organization_wide_staff_access(organization_id)
  )
  or (
    stall_id is not null
    and public.can_manage_stall(stall_id)
  )
);

drop policy if exists operational_events_authorized_select on public.operational_events;
create policy operational_events_authorized_select on public.operational_events
for select to authenticated
using (
  public.can_view_orders(stall_id)
  and (
    event_type <> 'PAYMENT_RECORDED'
    or public.can_manage_stall(stall_id)
    or public.has_stall_role(stall_id, array['STAFF'::public.user_role])
  )
);

drop policy if exists operational_alerts_authorized_select on public.operational_alerts;
create policy operational_alerts_authorized_select on public.operational_alerts
for select to authenticated
using (
  public.can_manage_stall(stall_id)
  or public.has_stall_role(stall_id, array['STAFF'::public.user_role])
);

drop policy if exists subscriptions_financial_select on public.subscriptions;
create policy subscriptions_financial_select on public.subscriptions
for select to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);

drop policy if exists additional_stall_approvals_financial_select on public.additional_stall_approvals;
create policy additional_stall_approvals_financial_select on public.additional_stall_approvals
for select to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);

drop policy if exists invoices_financial_select on public.invoices;
create policy invoices_financial_select on public.invoices
for select to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);

drop policy if exists invoice_line_items_financial_select on public.invoice_line_items;
create policy invoice_line_items_financial_select on public.invoice_line_items
for select to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);

drop policy if exists usage_events_financial_select on public.usage_events;
create policy usage_events_financial_select on public.usage_events
for select to authenticated
using (
  public.has_organization_role(
    organization_id,
    array['ORGANIZATION_OWNER'::public.user_role]
  )
);

drop policy if exists organization_invitations_manager_select on public.organization_invitations;
create policy organization_invitations_manager_select on public.organization_invitations
for select to authenticated
using (
  (
    stall_id is null
    and public.has_organization_wide_staff_access(organization_id)
  )
  or (
    stall_id is not null
    and public.can_manage_stall(stall_id)
  )
);

create unique index if not exists qr_codes_stall_token_version_key
  on public.qr_codes (stall_id, token_version);

create or replace function public.enforce_pending_order_device_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pending_limit integer;
  pending_count integer;
begin
  if new.source <> 'QR_MENU'
     or new.status <> 'WAITING_CONFIRMATION'::public.order_status then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.stall_id::text || ':' || new.device_hash, 0)
  );

  select settings.max_pending_orders_per_device
  into pending_limit
  from public.stall_ordering_settings settings
  where settings.stall_id = new.stall_id;
  pending_limit := coalesce(pending_limit, 3);

  select count(*)::integer
  into pending_count
  from public.orders existing_order
  where existing_order.stall_id = new.stall_id
    and existing_order.device_hash = new.device_hash
    and existing_order.status = 'WAITING_CONFIRMATION'::public.order_status;

  if pending_count >= pending_limit then
    raise exception 'TOO_MANY_PENDING_ORDERS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_pending_device_cap_before_insert on public.orders;
create trigger orders_pending_device_cap_before_insert
before insert on public.orders
for each row execute function public.enforce_pending_order_device_cap();

revoke all on function public.enforce_pending_order_device_cap() from public, anon, authenticated;
grant execute on function public.enforce_pending_order_device_cap() to service_role;
