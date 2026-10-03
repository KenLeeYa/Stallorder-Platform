import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Explicitly disposable clone only; never accepts a remote/original database argument.
const container = 'd11af555754b';
const database = 'stallorder_release_upgrade_20261002';
const [state] = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }));
assert.equal(state.Config.Labels['com.supabase.cli.project'], 'stallorder-responsive-20260930');
assert.ok(state.State.Running);
assert.equal(state.NetworkSettings.Ports['5432/tcp'][0].HostPort, '56822');
const fixture = readFileSync('supabase/fixtures/primary_notification_read_receipts_backfill.sql', 'utf8');
// Execute the exact fixture statements inside this test transaction; only its transaction envelope is removed.
const body = fixture.replace(/^BEGIN;\r?$/m, '').replace(/^COMMIT;\r?$/m, '');
assert.ok(!body.includes('$fixture$'));
const sql = `BEGIN;
SET LOCAL search_path=public,extensions;
SELECT plan(7);
CREATE TEMP TABLE original_runtime AS SELECT * FROM public.backend_runtime_state;
CREATE FUNCTION pg_temp.run_fixture() RETURNS void LANGUAGE plpgsql AS $test$
BEGIN EXECUTE $fixture$${body}$fixture$; END;
$test$;
UPDATE public.backend_runtime_state SET backend_code='BACKFILL_QA_DR',enforcement_enabled=true WHERE is_current;
SELECT throws_ok('SELECT pg_temp.run_fixture()', '55000', 'PRIMARY_NOTIFICATION_BACKFILL_TARGET_DENIED', 'non-Primary is rejected');
UPDATE public.backend_runtime_state SET backend_code='PRIMARY',backend_role='ACTIVE_WRITER',writes_enabled=true,enforcement_enabled=false WHERE is_current;
SELECT throws_ok('SELECT pg_temp.run_fixture()', '55000', 'PRIMARY_NOTIFICATION_BACKFILL_TARGET_DENIED', 'disabled fencing is rejected');
UPDATE public.backend_runtime_state SET enforcement_enabled=true WHERE is_current;
INSERT INTO public.merchant_application_notifications(id,application_id,profile_id,type,title,message,read_at)
SELECT 'ad74a57e-b901-4345-b544-000000000001',application_id,profile_id,'BACKFILL_QA','QA','Disposable fixture regression','2026-09-01T00:00:00Z'
FROM public.merchant_application_notifications LIMIT 1;
SELECT lives_ok('SELECT pg_temp.run_fixture()', 'Primary active fenced fixture succeeds');
SELECT is((SELECT count(*) FROM public.merchant_application_notifications n WHERE n.read_at IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM public.notification_read_receipts r WHERE r.profile_id=n.profile_id AND r.application_notification_id=n.id)),0::bigint,'zero missing historical reads');
SELECT is((SELECT read_at::text FROM public.notification_read_receipts WHERE application_notification_id='ad74a57e-b901-4345-b544-000000000001'),
 '2026-09-01 00:00:00+00','original read time preserved');
UPDATE public.notification_read_receipts SET read_at='2026-09-02T00:00:00Z' WHERE application_notification_id='ad74a57e-b901-4345-b544-000000000001';
SELECT lives_ok('SELECT pg_temp.run_fixture()', 'fixture rerun succeeds');
SELECT is((SELECT read_at::text FROM public.notification_read_receipts WHERE application_notification_id='ad74a57e-b901-4345-b544-000000000001'),
 '2026-09-02 00:00:00+00','rerun preserves existing receipt');
SELECT * FROM finish();
ROLLBACK;
`;
const query = statement => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At'], { input: statement, encoding: 'utf8' });
const before = query('SELECT row_to_json(r) FROM backend_runtime_state r ORDER BY backend_code;');
const result = query(sql);
assert.doesNotMatch(result, /not ok|Looks like you failed/);
assert.equal(query('SELECT row_to_json(r) FROM backend_runtime_state r ORDER BY backend_code;'), before);
console.log(JSON.stringify({ database, fixtureSha256: createHash('sha256').update(fixture).digest('hex'), tests: 7, runtimeRestored: true, productionExecuted: false }));
console.log(result);
