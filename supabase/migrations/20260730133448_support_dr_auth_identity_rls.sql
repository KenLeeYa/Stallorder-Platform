-- Supabase Auth user IDs are project-local. Keep the Primary ID on profiles
-- for backward compatibility, while allowing the DR Auth project to resolve
-- the same profile through the explicit project identity mapping.

create or replace function app_private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with current_auth as (
    select auth.uid() as user_id
  ),
  candidate_profiles as (
    select profile.id as profile_id
    from public.profiles profile
    cross join current_auth
    where current_auth.user_id is not null
      and profile.auth_user_id = current_auth.user_id
      and profile.is_active

    union

    select identity.profile_id
    from public.profile_auth_identities identity
    join public.profiles profile
      on profile.id = identity.profile_id
     and profile.is_active
    cross join current_auth
    where current_auth.user_id is not null
      and identity.auth_user_id = current_auth.user_id
  )
  select (array_agg(profile_id order by profile_id))[1]
  from candidate_profiles
  having count(*) = 1;
$$;

create or replace function app_private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = app_private.current_profile_id()
      and profile.is_active
      and profile.platform_role = 'PLATFORM_ADMIN'::public.user_role
  );
$$;

create or replace function app_private.is_current_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.current_profile_id() = p_profile_id,
    false
  );
$$;

revoke all on function app_private.current_profile_id()
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_platform_admin()
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_current_profile(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  app_private.current_profile_id(),
  app_private.is_platform_admin(),
  app_private.is_current_profile(uuid)
to authenticated;

grant execute on function app_private.is_current_profile(uuid)
  to service_role;

comment on function app_private.current_profile_id() is
  'Fail-closed profile resolver for the legacy Primary Auth ID and project-local DR Auth mappings.';
