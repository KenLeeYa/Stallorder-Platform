import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyDeliveryQualification, REQUIRED_STEPS, REQUIRED_CHECKS } from './delivery-qualification.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const commit = 'a'.repeat(40), tree = 'b'.repeat(40), control = 'c'.repeat(40);
const time = '2026-11-04T20:00:00.000Z';
function fixture() {
  const workflowBytes = Buffer.from('source reviewed workflow'), flowBytes = Buffer.from('source reviewed collector');
  const contract = { productCommit: commit, productTree: tree, controlCommit: control, runId: 12,
    runAttempt: 1, jobId: 13, workflowSha256: hash(workflowBytes), flowSha256: hash(flowBytes) };
  const run = { id: 12, run_attempt: 1, workflow_id: 407163998, head_sha: control,
    repository: { id: 1298874780, full_name: 'KenLeeYa/Stallorder-Platform', private: false, fork: false },
    head_repository: { id: 1298874780, full_name: 'KenLeeYa/Stallorder-Platform' },
    event: 'push', head_branch: 'codex/primary-only-preparation', path: '.github/workflows/delivery-candidate-ci.yml',
    status: 'completed', conclusion: 'failure', created_at: '2026-11-04T19:40:00Z' };
  const job = { id: 13, run_id: 12, run_attempt: 1, head_sha: control, name: 'verify', status: 'completed',
    conclusion: 'success', labels: ['ubuntu-24.04'], runner_name: 'GitHub Actions 3',
    started_at: '2026-11-04T19:40:01Z', completed_at: '2026-11-04T20:01:00Z',
    steps: REQUIRED_STEPS.map((name, i) => ({ name, number: i + 1, status: 'completed', conclusion: 'success',
      started_at: '2026-11-04T19:40:01Z', completed_at: '2026-11-04T20:01:00Z' })) };
  const before = { id: 'owned', status: 'WAITING_CONFIRMATION', createdAt: '2026-11-04T19:45:00.000Z',
    confirmationExpiresAt: '2026-11-04T19:55:00.000Z' };
  const scheduler = { jobid: 1, jobname: 'stallorder-expire-unconfirmed-orders', schedule: '* * * * *',
    command: 'select public.expire_unconfirmed_orders()', database: 'postgres', username: 'postgres', active: true };
  const events = [
    { event: 'sources', controlFlowSha256: hash(flowBytes) },
    { event: 'next-http-runtime-principal', schema: 'stallorder-database-principal/v1',
      currentUser: 'postgres', sessionUser: 'postgres', database: 'postgres', superuser: false, bypassRls: true,
      helperExists: true, helperExecute: true, productionRuntimeVerified: false,
      observedAt: '2026-11-04T19:44:00.000Z', requestStartedAt: '2026-11-04T19:43:59.000Z', requestFinishedAt: '2026-11-04T19:44:01.000Z' },
    { event: 'natural-expiry-evidence', before, after: { ...before, status: 'EXPIRED', expiredAt: '2026-11-04T19:55:30.002Z' },
      job: scheduler, execution: { ...scheduler, runid: 2, status: 'succeeded',
        start_time: '2026-11-04T19:55:30.001Z', end_time: '2026-11-04T19:55:30.010Z',
        start_time_raw: '2026-11-04T19:55:30.001000Z', end_time_raw: '2026-11-04T19:55:30.010000Z' },
      startedAt: '2026-11-04T19:46:00.000Z', observedAt: time, eventCount: 1, confirmedStatus: 'CONFIRMED',
      deadlineModified: false, manualExpiryDuringWait: false },
    { event: 'flow-complete', edgeCircuitAOrderFlowVerified: true, realCronTimingVerified: true,
      edgeFunctionsExercised: ['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder'],
      productionSchedulerVerified: false, notificationDeliveryVerified: false },
    ...REQUIRED_CHECKS.map(name => ({ event: 'check', name, passed: true })),
    { event: 'cleanup', completed: true, remainingOrders: 0, remainingQr: 0, remainingProduct: 0, remainingStall: 0 },
    { event: 'summary', passed: true, checkCount: REQUIRED_CHECKS.length, failure: null, cleanupFailure: null,
      releaseQualified: false, syntheticOnly: true },
  ].map(e => ({ at: time, runId: '12345678-1234-4234-8234-123456789abc', ...e }));
  const apiChecks = events.filter(e => e.event === 'check' && !e.name.startsWith('owned-') && !e.name.startsWith('expired-readonly-browser-'));
  for (const entry of apiChecks) events.splice(events.indexOf(entry), 1);
  events.splice(events.findIndex(e => e.event === 'flow-complete'), 0, ...apiChecks);
  events.find(e => e.event === 'natural-expiry-evidence').observedAt = '2026-11-04T19:55:31.000Z';
  const input = { contract, run, job, workflowBytes, flowBytes, now: Date.parse('2026-11-04T20:02:00.000Z') };
  const encode = () => [JSON.stringify({ controlCommit: control, commit, tree, sourceVerified: true, releaseQualified: false }),
    ...events.map(e => '[1] ' + JSON.stringify(e))].map(line => '2026-11-04T20:00:01.0000000Z ' + line).join('\n');
  return { input, events, encode };
}
test('qualifies exact successful verify evidence while retaining raw scan failure and separate release gates', () => {
  const f = fixture();
  const r = verifyDeliveryQualification({ ...f.input, log: f.encode() });
  assert.equal(r.verificationPassed, true); assert.equal(r.releaseAuthorized, false);
  assert.equal(r.productionRuntimeVerified, false); assert.equal(r.sourceRunConclusion, 'failure');
});
for (const [name, mutate] of [
  ['wrong source', f => { f.input.run.head_sha = 'f'.repeat(40); }],
  ['private repository', f => { f.input.run.repository.private = true; }],
  ['wrong repository id', f => { f.input.run.repository.id += 1; }],
  ['incomplete job', f => { f.input.job.status = 'in_progress'; }],
  ['skipped required test', f => { f.input.job.steps[5].conclusion = 'skipped'; }],
  ['failed cleanup', f => { f.input.job.steps.find(s => s.name.includes('Stop only')).conclusion = 'failure'; }],
  ['different workflow', f => { f.input.workflowBytes = Buffer.from('changed'); }],
  ['different collector', f => { f.input.flowBytes = Buffer.from('changed'); }],
  ['stale run', f => { f.input.now += 7 * 3600_000; }],
  ['foreign evidence', f => { f.events[0].runId = 'foreign'; }],
  ['duplicate summary', f => { f.events.push({ ...f.events.at(-1) }); }],
  ['missing natural expiry', f => { f.events.splice(f.events.findIndex(e => e.event === 'natural-expiry-evidence'),1); }],
  ['deadline changed', f => { f.events.find(e => e.event === 'natural-expiry-evidence').deadlineModified = true; }],
  ['fake runtime role', f => { f.events.find(e => e.event === 'next-http-runtime-principal').superuser = true; }],
  ['browser check removed', f => { f.events.splice(f.events.findIndex(e => e.name === 'expired-readonly-browser-390'),1); }],
  ['leftover order', f => { f.events.find(e => e.event === 'cleanup').remainingOrders = 1; }],
]) test(`rejects ${name}`, () => {
  const f = fixture(); mutate(f);
  assert.throws(() => verifyDeliveryQualification({ ...f.input, log: f.encode() }));
});

for (const [name, transform] of [
  ['reordered failure properties', log => log + '\n2026-11-04T20:00:02.0000000Z [1] ' + JSON.stringify({ event:'failure', at:time, runId:'12345678-1234-4234-8234-123456789abc' })],
  ['failure on another process', log => log + '\n2026-11-04T20:00:02.0000000Z [0] ' + JSON.stringify({ at:time, runId:'12345678-1234-4234-8234-123456789abc', event:'failure' })],
  ['source timestamp after job', log => log.replace(/^\S+Z/, '2026-11-05T20:00:01.0000000Z')],
  ['all timestamps after job', log => log.replaceAll('2026-11-04T20:00:01.0000000Z', '2026-11-05T20:00:01.0000000Z')],
  ['provider timestamp before event', log => log.replaceAll('2026-11-04T20:00:01.0000000Z', '2026-11-04T19:59:59.0000000Z')],
  ['capture after acceptance completion', log => log.replaceAll('2026-11-04T20:00:01.0000000Z', '2026-11-04T20:01:01.0000000Z')],
]) test('rejects ' + name, () => {
  const f=fixture(); assert.throws(() => verifyDeliveryQualification({...f.input,log:transform(f.encode())}));
});
for (const [name, mutate] of [
  ['cleanup before runtime', f => {const i=f.events.findIndex(e=>e.event==='cleanup');f.events.splice(1,0,f.events.splice(i,1)[0]);}],
  ['API check after flow-complete', f => {const i=f.events.findIndex(e=>e.name==='edge-confirm-menu-open');const e=f.events.splice(i,1)[0];f.events.splice(f.events.findIndex(e=>e.event==='cleanup'),0,e);}],
  ['browser check before flow-complete', f => {const i=f.events.findIndex(e=>e.name==='expired-readonly-browser-390');f.events.splice(1,0,f.events.splice(i,1)[0]);}],
  ['cleanup check before flow-complete', f => {const i=f.events.findIndex(e=>e.name==='owned-primary-fixtures-removed');f.events.splice(1,0,f.events.splice(i,1)[0]);}],
  ['event outside acceptance step', f => {f.input.job.steps.find(s=>s.name==='Exact delivery API and responsive history acceptance').completed_at='2026-11-04T19:59:00Z';}],
  ['source outside materialize step', f => {f.input.job.steps[0].completed_at='2026-11-04T19:59:00Z';}],
]) test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyDeliveryQualification({...f.input,log:f.encode()}));});

test('accepts collector stdout buffered until the end of its actual provider step', () => {
  const f = fixture();
  const source = f.events.find(e => e.event === 'sources');
  source.at = '2026-11-04T19:44:00.000Z';
  const principal = f.events.find(e => e.event === 'next-http-runtime-principal');
  principal.at = '2026-11-04T19:44:01.000Z';
  const result = verifyDeliveryQualification({ ...f.input, log: f.encode() });
  assert.equal(result.verificationPassed, true);
  assert.equal(result.releaseAuthorized, false);
});

test('rejects a buffered event emitted before its actual provider step', () => {
  const f = fixture();
  f.events[0].at = '2026-11-04T19:41:00.000Z';
  f.input.job.steps.find(s => s.name === 'Exact delivery API and responsive history acceptance')
    .started_at = '2026-11-04T19:42:00Z';
  assert.throws(() => verifyDeliveryQualification({ ...f.input, log: f.encode() }));
});

// Native run13 logs retain the SSE event name because the collector's detail
// object supplies event: 'orders'. Validate that exact record, not a missing check.
function nativeSse(f) {
  return Object.assign(f.events.find(e => e.name === 'sse-own-order-mutation-correlated'), {
    event: 'orders', orderId: '603005f5-7c7c-4f4f-881d-ff12e0d8c2a6',
    databaseEventId: '332a6692-71b3-490a-a025-9a1e9e15abca',
    databaseEventType: 'PUBLIC_ORDER_CREATED', streamPayloadContainsOrderId: false,
  });
}
test('admits the exact native SSE correlation record and counts it once', () => {
  const f=fixture(); nativeSse(f);
  const result=verifyDeliveryQualification({...f.input,log:f.encode()});
  assert.equal(result.checkCount, REQUIRED_CHECKS.length);
  assert.equal(result.releaseAuthorized,false);
});
for (const [name, change] of [
  ['wrong SSE event', e => { e.event='heartbeat'; }],
  ['failed SSE check', e => { e.passed=false; }],
  ['unrelated SSE name', e => { e.name='another-check'; }],
  ['missing owned order', e => { delete e.orderId; }],
  ['missing database event', e => { delete e.databaseEventId; }],
  ['unrelated database event type', e => { e.databaseEventType='OTHER'; }],
  ['payload correlation falsely claimed', e => { e.streamPayloadContainsOrderId=true; }],
]) test('rejects native '+name,()=>{
  const f=fixture(); change(nativeSse(f));
  assert.throws(()=>verifyDeliveryQualification({...f.input,log:f.encode()}));
});
test('rejects a duplicate native SSE record',()=>{
  const f=fixture(); const e=nativeSse(f);f.events.splice(f.events.indexOf(e),0,{...e});
  assert.throws(()=>verifyDeliveryQualification({...f.input,log:f.encode()}));
});
