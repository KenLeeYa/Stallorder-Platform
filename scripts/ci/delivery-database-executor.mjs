import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

class ExecutorError extends Error {}
export function executorFailureCode(error) {
  return error instanceof ExecutorError ? error.message : null;
}
function nativeFailure(error) {
  // stderr can contain connection details. Match only fixed categories and
  // discard the original bytes, message, stack and cause from public output.
  const stderr=Buffer.isBuffer(error?.stderr)?error.stderr.toString('utf8'):error?.stderr;
  if(typeof stderr==='string'&&Buffer.byteLength(stderr)<=128*1024) {
    if(/password authentication failed/i.test(stderr))return 'DELIVERY_EXECUTOR_AUTH_REJECTED';
    if(/permission denied/i.test(stderr))return 'DELIVERY_EXECUTOR_PERMISSION_REJECTED';
    if(/unsupported startup parameter/i.test(stderr))return 'DELIVERY_EXECUTOR_STARTUP_REJECTED';
    if(/connection timed out|connection refused|could not translate host name|network is unreachable/i.test(stderr))return 'DELIVERY_EXECUTOR_CONNECTION_FAILED';
  }
  return 'DELIVERY_EXECUTOR_QUERY_FAILED';
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
  assert.equal(plan.database.executor.authentication, 'database-password', 'DELIVERY_EXECUTOR_AUTHENTICATION');
  assert.ok(typeof connection === 'string' && connection.length <= 65536 && !/[\x00-\x1f\x7f]/.test(connection), 'DELIVERY_EXECUTOR_ENDPOINT');
  let url;
  try { url = new URL(connection); } catch { throw new Error('DELIVERY_EXECUTOR_ENDPOINT'); }
  assert.ok(endpoint.projectId === plan.database.projectId
    && /^[a-z]{20}$/.test(endpoint.projectId)
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(endpoint.hostname)
    && endpoint.port === '5432' && endpoint.username === `postgres.${endpoint.projectId}`
    && endpoint.database === 'postgres' && url.protocol === 'postgresql:'
    && url.hostname === endpoint.hostname && url.port === endpoint.port
    && decodeURIComponent(url.username) === endpoint.username && url.pathname === '/postgres'
    && url.password.length > 0 && !url.hash, 'DELIVERY_EXECUTOR_ENDPOINT');
  const params = [...url.searchParams];
  assert.ok(params.length === 2 && new Set(params.map(([key]) => key)).size === 2
    && url.searchParams.get('sslmode') === 'require' && url.searchParams.get('connect_timeout') === '10', 'DELIVERY_EXECUTOR_OPTIONS');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  // Use native libpq fields, not a URI in PGDATABASE (which is a database name).
  Object.assign(env, { PGHOST: endpoint.hostname, PGPORT: endpoint.port,
    PGUSER: endpoint.username, PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: endpoint.database, PGSSLMODE: 'require', PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000 -c search_path=pg_catalog,public' });
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
