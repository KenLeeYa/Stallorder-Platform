begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);
select has_table('public', 'privacy_requests', 'privacy request table exists');
select ok(not has_table_privilege('anon', 'public.privacy_requests', 'SELECT'), 'anonymous direct Data API read denied');
select ok(not has_table_privilege('authenticated', 'public.privacy_requests', 'INSERT'), 'authenticated direct writes denied');
select ok(not has_table_privilege('service_role', 'public.privacy_requests', 'DELETE'), 'service role cannot delete request evidence');
select ok(not has_table_privilege('service_role', 'public.privacy_deletion_tombstones', 'UPDATE'), 'tombstones cannot be updated');
select ok(not has_table_privilege('service_role', 'public.audit_archive_outbox', 'DELETE'), 'archive receipt cannot be erased');
select ok((select rolbypassrls from pg_roles where rolname = 'service_role'), 'readback explicitly records privileged service-role residual risk');
insert into public.privacy_policy_versions(version, document_sha256, notice_text, lawful_basis, approved_by, effective_at)
values ('synthetic-test-v1', repeat('a',64), 'SYNTHETIC QA policy only', 'TEST_ONLY', '55555555-5555-4555-8555-555555555551', now());
select throws_ok($$update public.privacy_policy_versions set notice_text='changed' where version='synthetic-test-v1'$$,
 '42501','GOVERNANCE_EVIDENCE_IMMUTABLE','notice versions are immutable');
insert into public.privacy_requests(organization_id, subject_profile_id, receipt_hash, operation_id, request_digest, request_type, policy_version, details_ciphertext, due_at)
values('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555551',repeat('b',64),gen_random_uuid(),repeat('c',64),'ACCESS','synthetic-test-v1','synthetic-ciphertext',now()+interval '15 days'),
('11111111-1111-4111-8111-111111111112','55555555-5555-4555-8555-555555555551',repeat('d',64),gen_random_uuid(),repeat('e',64),'DELETE','synthetic-test-v1','synthetic-ciphertext',now()+interval '30 days');
select throws_ok($$update public.privacy_requests set extension_days=16 where receipt_hash=repeat('b',64)$$,
 '23514',null,'access extensions cannot exceed 15 days');
select throws_ok($$update public.privacy_requests set extension_days=10 where receipt_hash=repeat('b',64)$$,
 '23514',null,'extension requires written notification evidence');
create role compliance_fixture_runtime nologin nobypassrls;
grant service_role to compliance_fixture_runtime;
grant compliance_fixture_runtime to postgres;
grant usage on schema extensions to compliance_fixture_runtime;
set local role compliance_fixture_runtime;
select is((select count(*) from public.privacy_requests), 0::bigint, 'non-bypass runtime without scope sees no rows');
select set_config('app.compliance_organization_id','11111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.privacy_requests), 1::bigint, 'non-bypass runtime sees only the bound tenant');
select is((select count(*) from public.privacy_requests where organization_id='11111111-1111-4111-8111-111111111112'), 0::bigint, 'cross-tenant select is denied by actual RLS');
update public.privacy_requests set status='REVIEWING' where organization_id='11111111-1111-4111-8111-111111111112';
reset role;
select is((select status from public.privacy_requests where receipt_hash=repeat('d',64)), 'RECEIVED', 'cross-tenant update affects no rows');
select ok(not exists(select 1 from pg_policy where polrelid='public.privacy_requests'::regclass and polroles @> array[(select oid from pg_roles where rolname='anon')]::oid[]),'no permissive anonymous policy');
select * from finish();
rollback;
