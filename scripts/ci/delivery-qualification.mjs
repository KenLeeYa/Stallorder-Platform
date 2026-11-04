import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyNaturalExpiry } from './delivery-expiry-evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const repository = 'KenLeeYa/Stallorder-Platform';
const repositoryId = 1298874780;
export const REQUIRED_STEPS = Object.freeze([
  'Verify source bundle and reconstruct the exact product', 'Install dependencies', 'Dependency audit',
  'Generate Prisma Client', 'Lint', 'UI control audit', 'Typecheck', 'Unit tests', 'Start isolated Supabase',
  'Configure local E2E runtime', 'Rebuild isolated database from all migrations',
  'Actual application DB principal and definer owner parity', 'Database tests', 'Database lint',
  'Production guardrails', 'Enable isolated legacy Google OAuth compatibility', 'Build',
  'Verify independent status Worker bundle', 'Install Playwright Chromium and WebKit',
  'WebPRNT native recovery on Chromium and WebKit', 'Exact delivery API and responsive history acceptance',
  'Playwright end-to-end tests', 'Production-mode resilience smoke',
  "Stop only this runner's Supabase test project", 'Record exact source and result',
]);
export const REQUIRED_CHECKS = Object.freeze([
  'hosted-owned-runner', 'exact-product-commit', 'restricted-app-role', 'helper-acl',
  'anonymous-cannot-read-runtime-principal', 'actual-next-http-runtime-principal',
  'revoked-admin-cannot-read-runtime-principal', 'staff-cannot-read-runtime-principal',
  'sse-own-order-mutation-correlated', 'staff-sees-waiting-delivery', 'confirmed-order-persisted',
  'edge-confirm-menu-open', 'edge-order-staff-confirmation', 'edge-line-link-status-without-external-message',
  'edge-reorder-preserves-delivery-context', 'edge-confirmed-order-cannot-reorder',
  'closed-session-refused', 'closed-existing-session-submit-refused',
  'edge-closed-session-refused', 'edge-closed-existing-session-submit-refused', 'closed-does-not-create-order',
  'expiry-is-idempotent', 'confirmed-order-does-not-expire', 'history-does-not-leak-other-tenant',
  'expired-order-read-only', 'expired-history-edit-refused', 'expired-payment-edit-refused',
  'cross-tenant-history-refused', 'cross-stall-order-mutation-refused',
  'postgres-microsecond-boundary-regressions', 'natural-ten-minute-cron-expiry',
  'natural-expiry-visible-in-history', 'natural-expiry-not-active', 'edge-expired-order-cannot-reorder',
  'expired-readonly-browser-1280', 'expired-readonly-browser-390',
  'owned-circuit-override-removed', 'owned-auth-sessions-removed', 'owned-primary-fixtures-removed',
]);
const instant = value => {
  assert.equal(typeof value, 'string');
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const at = Date.parse(value);
  assert.equal(new Date(at).toISOString(), value.includes('.') ? value : value.replace('Z', '.000Z'));
  return at;
};

// Input bytes must come from the fixed GitHub API and the protected caller's
// immutable contract. This verifies one actual job, not a Production approval.
export function verifyDeliveryQualification({ contract, run, job, workflowBytes, flowBytes, log, now }) {
  for (const name of ['productCommit', 'productTree', 'controlCommit']) assert.match(contract[name], /^[a-f0-9]{40}$/);
  for (const name of ['workflowSha256', 'flowSha256']) assert.match(contract[name], /^[a-f0-9]{64}$/);
  for (const name of ['runId', 'jobId']) assert.ok(Number.isSafeInteger(contract[name]) && contract[name] > 0);
  assert.equal(contract.runAttempt, 1);
  assert.equal(hash(workflowBytes), contract.workflowSha256); assert.equal(hash(flowBytes), contract.flowSha256);
  assert.equal(run.repository?.full_name, repository); assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.repository.id, repositoryId); assert.equal(run.head_repository.id, repositoryId);
  assert.equal(run.repository.private, false); assert.equal(run.repository.fork, false);
  assert.equal(run.id, contract.runId); assert.equal(run.workflow_id, 407163998);
  assert.equal(run.head_sha, contract.controlCommit); assert.equal(run.run_attempt, contract.runAttempt);
  assert.equal(run.event, 'push'); assert.equal(run.head_branch, 'codex/primary-only-preparation');
  assert.equal(run.path, '.github/workflows/delivery-candidate-ci.yml'); assert.equal(run.status, 'completed');
  assert.ok(['success', 'failure'].includes(run.conclusion));
  assert.equal(job.id, contract.jobId); assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, run.head_sha); assert.equal(job.name, 'verify');
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
  assert.deepEqual(job.labels, ['ubuntu-24.04']); assert.match(job.runner_name, /^GitHub Actions \d+$/);
  const created = instant(run.created_at), started = instant(job.started_at), completed = instant(job.completed_at);
  assert.ok(Number.isFinite(now) && created <= started && started <= completed && completed <= now
    && now - created <= 6 * 3600_000, 'qualification execution time invalid');
  assert.ok(Array.isArray(job.steps) && new Set(job.steps.map(s => s.name)).size === job.steps.length);
  let prior = 0;
  for (const name of REQUIRED_STEPS) {
    const step = job.steps.find(s => s.name === name);
    assert.ok(step && Number.isSafeInteger(step.number) && step.number > prior, 'required step absent or reordered');
    prior = step.number; assert.equal(step.status, 'completed'); assert.equal(step.conclusion, 'success', name);
  }
  for (const step of job.steps) {
    assert.equal(step.status, 'completed');
    assert.ok(step.conclusion === 'success' || (step.name === 'Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
      && step.conclusion === 'skipped'), 'unexpected failed or skipped step');
  }
  assert.ok(typeof log === 'string' && Buffer.byteLength(log) > 0 && Buffer.byteLength(log) <= 64 * 1024 * 1024);
  const lines = log.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const match = /^(\S+Z) (?:\[(\d+)\] )?(\{.*)$/.exec(line);
    if (!match) continue;
    let value;
    try { value = JSON.parse(match[3]); } catch (error) {
      assert.ok(!/"(?:runId|controlCommit)"\s*:/.test(match[3]), 'malformed evidence record');
      continue;
    }
    if (!value || (!Object.hasOwn(value, 'runId') && !Object.hasOwn(value, 'controlCommit'))) continue;
    assert.match(match[1], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/);
    const capturedAt = instant(match[1].replace(/(\.\d{3})\d{4}Z$/, '$1Z'));
    const eventRecord = Object.hasOwn(value, 'runId');
    assert.equal(match[2], eventRecord ? '1' : undefined, 'unexpected evidence process');
    const step = job.steps.find(s => s.name === (eventRecord
      ? 'Exact delivery API and responsive history acceptance'
      : 'Verify source bundle and reconstruct the exact product'));
    // GitHub's step/job timestamps have whole-second precision. The log has
    // 100ns precision, so include only the remainder of that final second.
    assert.ok(started <= capturedAt && capturedAt < completed + 1000
      && instant(step.started_at) <= capturedAt && capturedAt < instant(step.completed_at) + 1000,
    'evidence outside its provider execution interval');
    if (eventRecord) {
      const emittedAt = instant(value.at);
      // The Playwright wrapper prints execFile stdout after the collector exits.
      // Bind buffered events to that real provider step, not a fictitious live
      // streaming delay. The capture itself is bounded by the same step above.
      assert.ok(instant(step.started_at) <= emittedAt && emittedAt <= capturedAt,
        'evidence capture time invalid');
    }
    records.push({ value, eventRecord });
  }
  const sources = records.filter(r => !r.eventRecord).map(r => r.value);
  assert.equal(sources.length, 1); const source = sources[0];
  assert.equal(source.controlCommit, contract.controlCommit); assert.equal(source.commit, contract.productCommit);
  assert.equal(source.tree, contract.productTree); assert.equal(source.sourceVerified, true); assert.equal(source.releaseQualified, false);
  const events = records.filter(r => r.eventRecord).map(r => r.value);
  assert.ok(events.length > 0 && new Set(events.map(e => e.runId)).size === 1);
  assert.match(events[0].runId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  let priorTime = started;
  for (const event of events) {
    const at = instant(event.at); assert.ok(at >= priorTime && at <= completed); priorTime = at;
    assert.ok(!['failure', 'cleanup-failure', 'sse-close-failed'].includes(event.event));
  }
  const one = name => { const matches = events.filter(e => e.event === name); assert.equal(matches.length, 1, name); return matches[0]; };
  assert.equal(one('sources').controlFlowSha256, contract.flowSha256);
  const principal = one('next-http-runtime-principal');
  assert.equal(principal.schema, 'stallorder-database-principal/v1');
  assert.equal(principal.currentUser, 'postgres'); assert.equal(principal.sessionUser, 'postgres');
  assert.equal(principal.database, 'postgres'); assert.equal(principal.superuser, false); assert.equal(principal.bypassRls, true);
  assert.equal(principal.helperExists, true); assert.equal(principal.helperExecute, true);
  assert.equal(principal.productionRuntimeVerified, false);
  assert.ok(started <= instant(principal.requestStartedAt) && instant(principal.requestStartedAt) <= instant(principal.observedAt)
    && instant(principal.observedAt) <= instant(principal.requestFinishedAt) && instant(principal.requestFinishedAt) <= instant(principal.at));
  const natural = one('natural-expiry-evidence');
  assert.equal(natural.deadlineModified, false); assert.equal(natural.manualExpiryDuringWait, false);
  verifyNaturalExpiry(natural);
  assert.ok(started <= instant(natural.before.createdAt) && instant(natural.observedAt) <= instant(natural.at));
  const flow = one('flow-complete');
  assert.equal(flow.edgeCircuitAOrderFlowVerified, true); assert.equal(flow.realCronTimingVerified, true);
  assert.equal(flow.productionSchedulerVerified, false); assert.equal(flow.notificationDeliveryVerified, false);
  assert.deepEqual(flow.edgeFunctionsExercised, ['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder']);
  // This reviewed collector spreads SSE detail after event: 'check', so its
  // native correlation record is tagged 'orders'. Preserve the raw bytes and
  // accept only that specific check with its complete, bounded evidence shape.
  for (const event of events.filter(e => e.event === 'orders')) {
    assert.equal(event.name, 'sse-own-order-mutation-correlated');
    for (const key of ['orderId', 'databaseEventId']) {
      assert.match(event[key] ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    }
    assert.equal(event.databaseEventType, 'PUBLIC_ORDER_CREATED');
    assert.equal(event.streamPayloadContainsOrderId, false);
  }
  const checks = events.filter(e => e.event === 'check' || e.event === 'orders');
  assert.ok(checks.every(e => e.passed === true));
  for (const name of REQUIRED_CHECKS) assert.equal(checks.filter(e => e.name === name).length, 1, name);
  const cleanup = one('cleanup'); assert.equal(cleanup.completed, true);
  for (const field of ['remainingOrders', 'remainingQr', 'remainingProduct', 'remainingStall']) assert.equal(cleanup[field], 0);
  const summary = one('summary'); assert.equal(events.at(-1), summary);
  const phases = ['sources', 'next-http-runtime-principal', 'natural-expiry-evidence', 'flow-complete', 'cleanup', 'summary']
    .map(name => events.indexOf(one(name)));
  assert.ok(phases.every((index, i) => i === 0 || index > phases[i - 1]), 'evidence phases reordered');
  const cleanupNames = ['owned-circuit-override-removed', 'owned-auth-sessions-removed', 'owned-primary-fixtures-removed'];
  const uiNames = ['browser-login-1280', 'expired-readonly-browser-1280', 'browser-login-390', 'expired-readonly-browser-390'];
  const firstCleanupCheck = Math.min(...checks.filter(e => cleanupNames.includes(e.name)).map(e => events.indexOf(e)));
  for (const check of checks) {
    const index = events.indexOf(check);
    assert.ok(cleanupNames.includes(check.name) ? phases[3] < index && index < phases[4]
      : uiNames.includes(check.name) ? phases[3] < index && index < firstCleanupCheck
        : index < phases[3], 'check outside its execution phase');
  }
  assert.equal(summary.passed, true); assert.equal(summary.checkCount, checks.length);
  assert.equal(summary.failure, null); assert.equal(summary.cleanupFailure, null);
  assert.equal(summary.syntheticOnly, true); assert.equal(summary.releaseQualified, false);
  return { verificationPassed: true, releaseAuthorized: false, productCommit: contract.productCommit,
    productTree: contract.productTree, controlCommit: contract.controlCommit, runId: run.id, jobId: job.id,
    runAttempt: run.run_attempt, completedAt: job.completed_at, sourceRunConclusion: run.conclusion,
    logSha256: hash(log), checkCount: checks.length, nextPrincipal: principal,
    productionRuntimeVerified: false, productionSchedulerVerified: false, notificationDeliveryVerified: false };
}
