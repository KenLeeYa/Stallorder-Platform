import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { collectExecutor, verifyExecutorSnapshot } from './delivery-database-executor.mjs';

const plan = JSON.parse(readFileSync(new URL('./delivery-executor-contract.json', import.meta.url)));
const now = Date.parse('2026-11-04T20:00:00.000Z');
function snapshot() {
  return { schema: 'stallorder-delivery-executor/v1', proofType: 'migration-connection-query',
    observedAt: '2026-11-04T19:59:59.000Z', currentUser: 'postgres', sessionUser: 'postgres',
    database: 'postgres', serverVersionNum:170006, superuser: false, bypassRls: true, transactionReadOnly: true, backendPid: 12, createPublic: true,
    helperExists: false, functions: plan.database.functions.map(fn => ({ ...structuredClone(fn), executorExecute: true })),
  };
}
const interval = { startedAt: '2026-11-04T19:59:58.000Z', finishedAt: '2026-11-04T20:00:00.000Z' };
test('actual connection snapshot preserves query time and full preimages without granting release', () => {
  const result = verifyExecutorSnapshot(snapshot(), plan, interval, now);
  assert.equal(result.executor.name, 'postgres');
  assert.equal(result.executor.observedAt, snapshot().observedAt);
  assert.equal(result.executor.projectId, plan.database.projectId);
  assert.equal(result.releaseAuthorized, false);
});
for (const [label, edit] of [
  ['unexpected database version', s => { s.serverVersionNum = 170007; }],
  ['superuser', s => { s.superuser = true; }],
  ['role switching', s => { s.sessionUser = 'supabase_admin'; }],
  ['wrong database', s => { s.database = 'template1'; }],
  ['write-enabled probe', s => { s.transactionReadOnly = false; }],
  ['no helper CREATE permission', s => { s.createPublic = false; }],
  ['missing EXECUTE', s => { s.functions[0].executorExecute = false; }],
  ['ACL drift', s => { s.functions[0].acl.push('anon=X/postgres'); }],
  ['definition drift', s => { s.functions[0].definitionSha256 = 'f'.repeat(64); }],
  ['missing function', s => { s.functions.pop(); }],
  ['duplicate function', s => { s.functions[1] = structuredClone(s.functions[0]); }],
  ['helper already exists', s => { s.helperExists = true; }],
  ['catalog label', s => { s.proofType = 'role-catalog'; }],
  ['pre-request timestamp', s => { s.observedAt = '2026-11-04T19:59:57.000Z'; }],
  ['future timestamp', s => { s.observedAt = '2026-11-04T20:00:01.000Z'; }],
]) test(`rejects ${label}`, () => {
  const value = snapshot(); edit(value);
  assert.throws(() => verifyExecutorSnapshot(value, plan, interval, now));
});

test('collector passes the exact approved connection only in the environment, enforces read-only, and sanitizes failures', () => {
  const endpoint = { projectId: plan.database.projectId, hostname: 'aws-fixture.pooler.supabase.com',
    port: '5432', username: `postgres.${plan.database.projectId}`, database: 'postgres' };
  const connection = `postgresql://${endpoint.username}:synthetic-placeholder-password@${endpoint.hostname}:5432/postgres?sslmode=require&connect_timeout=10`;
  let calls = 0;
  const invoke = (binary, args, options) => {
    calls += 1;
    assert.equal(binary, 'psql'); assert.ok(!args.some(arg => arg.includes('synthetic-placeholder-password')));
    assert.ok(!args.includes('--dbname'));
    assert.equal(options.env.PGHOST, endpoint.hostname);
    assert.equal(options.env.PGUSER, endpoint.username);
    assert.equal(options.env.PGDATABASE, 'postgres');
    assert.equal(options.env.PGPASSWORD, 'synthetic-placeholder-password');
    assert.equal(options.env.PGSSLMODE, 'require');
    assert.match(options.env.PGOPTIONS, /default_transaction_read_only=on/);
    assert.match(options.env.PGOPTIONS, /statement_timeout=15000/);
    assert.doesNotMatch(options.env.PGOPTIONS, /jit=true/);
    return JSON.stringify({ ...snapshot(), observedAt: new Date().toISOString() });
  };
  const result = collectExecutor({ connection, endpoint: { ...endpoint, password: 'must-not-copy-extra-field' }, plan, invoke });
  assert.equal(JSON.stringify(result).includes('must-not-copy-extra-field'), false);
  assert.equal(result.releaseAuthorized, false); assert.equal(calls, 1);
  assert.throws(() => collectExecutor({ connection: connection.replace(endpoint.hostname, 'other.pooler.supabase.com'),
    endpoint, plan, invoke }), /ENDPOINT/);
  assert.equal(calls, 1);
  assert.throws(() => collectExecutor({ connection, endpoint, plan,
    invoke: () => { throw new Error(connection); } }), /^Error: DELIVERY_EXECUTOR_QUERY_FAILED$/);
  assert.throws(() => collectExecutor({ connection: connection + '&host=unbound.invalid', endpoint, plan, invoke }), /OPTIONS/);
});

test('database-password mode rejects JIT options and mismatched executor authentication before connecting',()=>{
 const endpoint={projectId:plan.database.projectId,hostname:'aws-fixture.pooler.supabase.com',port:'5432',username:'postgres.'+plan.database.projectId,database:'postgres'};
 const connection='postgresql://'+endpoint.username+':synthetic@'+endpoint.hostname+':5432/postgres?sslmode=require&connect_timeout=10';
 let calls=0;const invoke=()=>{calls++;throw new Error('must not connect');};
 assert.throws(()=>collectExecutor({connection:connection+'&options=-c%20jit%3Dtrue',endpoint,plan,invoke}),/OPTIONS/);
 const changed=structuredClone(plan);changed.database.executor.authentication='jit';
 assert.throws(()=>collectExecutor({connection,endpoint,plan:changed,invoke}),/AUTHENTICATION/);
 assert.equal(calls,0);
});
