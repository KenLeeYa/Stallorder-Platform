-- Separate kitchen production access from the broader staff order boundary.
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
        'STAFF'::public.user_role
      )
  );
$$;

create or replace function public.can_view_kds(p_stall_id uuid)
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
      and membership.profile_id = public.current_profile_id()
      and membership.is_active
      and membership.role in (
        'STALL_MANAGER'::public.user_role,
        'KITCHEN'::public.user_role
      )
  );
$$;

revoke all on function public.can_view_orders(uuid) from public, anon;
revoke all on function public.can_view_kds(uuid) from public, anon;
grant execute on function public.can_view_orders(uuid) to authenticated;
grant execute on function public.can_view_kds(uuid) to authenticated;

drop policy if exists kitchen_stations_authorized_select on public.kitchen_stations;
create policy kitchen_stations_authorized_select on public.kitchen_stations
for select to authenticated using (public.can_view_kds(stall_id));

drop policy if exists kitchen_station_assignments_authorized_select
  on public.kitchen_station_assignments;
create policy kitchen_station_assignments_authorized_select
on public.kitchen_station_assignments
for select to authenticated using (public.can_view_kds(stall_id));

drop policy if exists order_production_tasks_authorized_select
  on public.order_production_tasks;
create policy order_production_tasks_authorized_select
on public.order_production_tasks
for select to authenticated using (public.can_view_kds(stall_id));
