import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {nativeReadOnlyEnvironment,nativeReadFailure as nativeFailure} from './delivery-native-read-connection.mjs';

class ExecutorError extends Error {}
export function executorFailureCode(error) {
  return error instanceof ExecutorError ? error.message : null;
}
// Database-password collector for the reviewed native migration path. The
// protected caller must bind Apply to this same endpoint and authentication.
export function verifyExecutorSnapshot(value, plan, interval, now = Date.now()) {
  assert.equal(value?.schema, 'stallorder-delivery-executor/v1');
  assert.equal(value.proofType, 'migration-connection-query');
  const observed = Date.parse(value.observedAt);
  const started = Date.parse(interval.startedAt), finished = Date.parse(interval.finishedAt);
  assert.ok(Number.isFinite(now) && Number.isFinite(observed) && started <= observed
    && observed <= finished && finished <= now && now - started <= 300_000, 'DELIVERY_EXECUTOR_TIME');
  assert.equal(value.currentUser, 'postgres'); assert.equal(value.sessionUser, 'postgres');
  assert.equal(value.database, 'postgres'); assert.equal(value.serverVersionNum, plan.database.serverVersionNum); assert.equal(value.superuser, false);
  assert.equal(value.bypassRls, true); assert.equal(value.transactionReadOnly, true);
  assert.equal(value.createPublic, true);
  assert.ok(Number.isSafeInteger(value.backendPid) && value.backendPid > 0);
  assert.equal(value.helperExists, false);
  assert.equal(plan.database.functions.length, 4);
  assert.equal(value.functions?.length, 4);
  assert.equal(new Set(value.functions.map(fn => fn.signature)).size, 4);
  for (const expected of plan.database.functions) {
    const actual = value.functions.find(fn => fn.signature === expected.signature);
    assert.equal(actual?.definitionSha256, expected.definitionSha256);
    assert.equal(actual?.owner, expected.owner);
    assert.ok(Array.isArray(actual?.acl));
    assert.deepEqual([...actual.acl].sort(), [...expected.acl].sort());
    assert.equal(actual.executorExecute, true);
  }
  const receiptSha256 = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { executor: { name: value.currentUser, sessionUser: value.sessionUser,
    superuser: value.superuser, bypassRls: value.bypassRls, projectId: plan.database.projectId,
    proofType: value.proofType, observedAt: value.observedAt, receiptSha256 },
  functions: value.functions, helperExists: value.helperExists, releaseAuthorized: false };
}

export function collectExecutor({ connection, endpoint, plan, invoke = execFileSync }) {
  const env = nativeReadOnlyEnvironment({connection,endpoint,plan});
  const startedAt = new Date().toISOString();
  let text;
  try {
    text = invoke('psql', ['--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--tuples-only', '--no-align', '--file', fileURLToPath(new URL('./delivery-database-executor.sql', import.meta.url))],
    { env, encoding: 'utf8', timeout: 25000, maxBuffer: 128 * 1024, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] });
  } catch(error) { throw new ExecutorError(nativeFailure(error)); }
  const finishedAt = new Date().toISOString();
  let value;
  try { value = JSON.parse(text); } catch { throw new ExecutorError('DELIVERY_EXECUTOR_OUTPUT_INVALID'); }
  let verified;
  try { verified=verifyExecutorSnapshot(value,plan,{startedAt,finishedAt}); }
  catch { throw new ExecutorError('DELIVERY_EXECUTOR_SNAPSHOT_REJECTED'); }
  return { ...verified,
    authentication: 'database-password', requestStartedAt: startedAt, requestFinishedAt: finishedAt,
    endpoint: { projectId: endpoint.projectId, hostname: endpoint.hostname, port: endpoint.port,
      username: endpoint.username, database: endpoint.database }, raw: value, requiresAuthenticatedRun: true };
}
