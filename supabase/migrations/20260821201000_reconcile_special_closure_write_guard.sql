-- Environments that already applied the original 20260821193000 migration
-- have the special-closure table but not its backend write fence. Add the
-- statement-level guard without replacing a guard that is already present.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger existing_trigger
    where existing_trigger.tgrelid = 'public.stall_special_closures'::regclass
      and existing_trigger.tgname = 'backend_writable_guard'
      and not existing_trigger.tgisinternal
  ) then
    create trigger backend_writable_guard
    before insert or update or delete on public.stall_special_closures
    for each statement execute function app_private.enforce_backend_writable();
  end if;
end;
$migration$;
