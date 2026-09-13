begin;
set local search_path = public, extensions;
select plan(5);
select * from app_private.transition_backend_runtime('PRIMARY',1,'DR','READ_ONLY_STANDBY',1,'Synthetic isolated DR test',null);
select throws_ok($$insert into public.privacy_policy_versions(version,document_sha256,notice_text,lawful_basis)
  values('dr-fence-synthetic',repeat('f',64),'TEST ONLY','TEST')$$, '55000','BACKEND_NOT_WRITABLE','local DR policy writer is fenced');
select throws_ok($$insert into public.security_incidents(organization_id,awareness_at,facts_ciphertext)
  values('11111111-1111-4111-8111-111111111111',now(),'TEST ONLY')$$, '55000','BACKEND_NOT_WRITABLE','local DR incident writer is fenced');
select ok(not exists(select 1 from pg_trigger where tgrelid='public.privacy_requests'::regclass and tgname='governance_writer' and tgenabled in ('A','R')),
  'normal governance write fence is not an ALWAYS or REPLICA trigger');
select ok(not has_function_privilege('service_role','app_private.transition_backend_runtime(text,bigint,text,text,bigint,text,uuid)','EXECUTE'),
  'runtime cannot change the backend role');
select is((select tgenabled::text from pg_trigger where tgrelid='public.audit_logs'::regclass and tgname='audit_committed_evidence_guard'), 'O',
  'audit completion guard does not block logical-replication update apply');
select * from finish();
rollback;
