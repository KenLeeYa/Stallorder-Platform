-- Committed synthetic evidence deliberately remains in this disposable local database.
begin;
set local search_path = public, extensions;
select plan(5);
insert into public.audit_logs(id, organization_id, action, entity_type, entity_id, outcome, request_id, created_at)
values(gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'COMPLIANCE_SYNTHETIC_TEST', 'TEST', gen_random_uuid(), 'SUCCESS', gen_random_uuid()::text, now())
returning id as audit_id \gset
select lives_ok(format('update public.audit_logs set after_json = %L::jsonb where id = %L::uuid', '{"completedSnapshot":true}', :'audit_id'),
  'canonical RPC can finish its new snapshot in the inserting transaction');
commit;
begin;
set local search_path = public, extensions;
select throws_ok(format('update public.audit_logs set after_json = %L::jsonb where id = %L::uuid', '{}', :'audit_id'),
  '42501', 'AUDIT_EVIDENCE_IMMUTABLE', 'committed audit update fails');
select throws_ok(format('delete from public.audit_logs where id = %L::uuid', :'audit_id'),
  '42501', 'AUDIT_EVIDENCE_IMMUTABLE', 'committed audit delete fails');
select throws_ok('truncate public.audit_logs cascade', '42501', 'AUDIT_EVIDENCE_IMMUTABLE', 'truncate cannot bypass row protection');
select ok(not has_table_privilege('service_role', 'public.audit_logs', 'DELETE'), 'service role has no audit delete permission');
select * from finish();
rollback;
