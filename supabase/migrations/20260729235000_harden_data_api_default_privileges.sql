-- Hosted projects created with legacy Data API defaults may automatically grant
-- privileges on new public objects. Future migrations must grant only the
-- privileges their trusted APIs actually require.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Menu snapshots are append-only. The trusted runtime may publish and read a
-- snapshot, while the immutable trigger remains a second enforcement layer.
revoke all privileges on table public.menu_snapshots
  from public, anon, authenticated, service_role;
grant select, insert on table public.menu_snapshots to service_role;
