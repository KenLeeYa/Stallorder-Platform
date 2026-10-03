-- Existing canonical order RPCs finish their audit snapshots in the inserting
-- transaction. Preserve that behavior; committed evidence can never be changed.
create function app_private.guard_persisted_audit_evidence() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.xmin::text::bigint = (pg_current_xact_id()::text::bigint % 4294967296) then
    return new;
  end if;
  raise exception 'AUDIT_EVIDENCE_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function app_private.guard_persisted_audit_evidence() from public, anon, authenticated, service_role;
create trigger audit_committed_evidence_guard before update or delete on public.audit_logs
for each row execute function app_private.guard_persisted_audit_evidence();
create trigger audit_truncate_guard before truncate on public.audit_logs
for each statement execute function app_private.guard_persisted_audit_evidence();
revoke delete, truncate on public.audit_logs from anon, authenticated, service_role;
