-- A canonical RPC can insert its snapshot in a PL/pgSQL exception subtransaction.
-- xmin then differs from the top-level XID. A row being updated is locked and
-- MVCC-visible; an in-progress inserting XID therefore belongs to this transaction,
-- including its children. Concurrent uncommitted rows cannot pass this visibility.
create or replace function app_private.guard_persisted_audit_evidence() returns trigger
language plpgsql set search_path='' as $$
declare current_xid numeric; inserting_xid numeric;
begin
  if tg_op='UPDATE' and old.xmin::text::numeric >= 3 then
    current_xid := pg_current_xact_id()::text::numeric;
    inserting_xid := trunc(current_xid / 4294967296) * 4294967296 + old.xmin::text::numeric;
    -- Reconstruct xid8 around the current transaction, including wraparound.
    if inserting_xid-current_xid > 2147483647 then inserting_xid := inserting_xid-4294967296;
    elsif current_xid-inserting_xid > 2147483647 then inserting_xid := inserting_xid+4294967296;
    end if;
    if inserting_xid >= 3 and pg_xact_status(inserting_xid::text::xid8)='in progress' then return new; end if;
  end if;
  raise exception 'AUDIT_EVIDENCE_IMMUTABLE' using errcode='42501';
end $$;
revoke all on function app_private.guard_persisted_audit_evidence() from public,anon,authenticated,service_role;
