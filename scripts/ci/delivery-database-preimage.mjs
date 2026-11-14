import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RECOVERY_SIGNATURES, SNAPSHOT_SQL} from './delivery-database-recovery.mjs';

const schema='stallorder-delivery-native-preimage/v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const instant=value=>{assert.equal(typeof value,'string');const n=Date.parse(value);assert.equal(new Date(n).toISOString(),value);return n;};
const signature=value=>(value.includes('.')?value:'public.'+value).replaceAll('timestamp with time zone','timestamptz');

// The protected native transport must enforce read-only before this statement.
// No customer rows or application writes are involved; the complete migration
// records and function source must stay in memory or an encrypted archive.
export const NATIVE_PREIMAGE_SQL=`SELECT jsonb_build_object(
 'schema','${schema}',
 'observedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'backendPid',pg_backend_pid(),'serverVersionNum',current_setting('server_version_num')::integer,
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'createPublic',has_schema_privilege(current_user,'public','CREATE'),
 'functionsExecutable',(SELECT bool_and(COALESCE(has_function_privilege(current_user,to_regprocedure(s),'EXECUTE'),false))
   FROM unnest(ARRAY[${RECOVERY_SIGNATURES.slice(0,4).map(s=>"'"+s+"'").join(',')}]) AS s),
 'snapshot',(${SNAPSHOT_SQL})
);\n`;

// plan and versions must be bound to the independently verified frozen product
// by the protected caller. This pure function authenticates neither its inputs
// nor a database connection and grants no Apply/recovery authority.
function verify({value,plan,versions,interval,now}) {
 assert.equal(plan.productCommit,'0d2b27144fcf589bb887e669c09e82158e3de7a2');
 assert.equal(plan.productTree,'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0');
 assert.equal(plan.database.projectId,'eyuctbnlvnbnivwasvqr');
 assert.equal(value.schema,schema);assert.equal(value.serverVersionNum,plan.database.serverVersionNum);
 assert.deepEqual(Object.keys(value).sort(),['backendPid','createPublic','functionsExecutable','observedAt','schema','serverVersionNum','snapshot','transactionReadOnly']);
 assert.equal(value.transactionReadOnly,true);assert.equal(value.createPublic,true);assert.equal(value.functionsExecutable,true);
 assert.ok(Number.isSafeInteger(value.backendPid)&&value.backendPid>0);
 const start=instant(interval.startedAt),observed=instant(value.observedAt),finish=instant(interval.finishedAt);
 assert.ok(Number.isSafeInteger(now)&&start<=observed&&observed<=finish&&finish<=now&&now-start<=300000&&finish-start<=90000);
 const state=value.snapshot;
 assert.ok(Buffer.byteLength(JSON.stringify(state))<=16*1024*1024);
 assert.deepEqual(Object.keys(state).sort(),['functions','migrations','principal']);
 assert.ok(Array.isArray(state.functions)&&Array.isArray(state.migrations));
 assert.deepEqual(state.principal,{currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true});
 assert.equal(state.functions.length,5);assert.equal(plan.database.functions.length,4);
 assert.equal(new Set(plan.database.functions.map(f=>signature(f.signature))).size,4);
 for(let i=0;i<5;i++) {
  const f=state.functions[i];assert.equal(f.signature,RECOVERY_SIGNATURES[i]);
  assert.deepEqual(Object.keys(f).sort(),['acl','config','definition','oid','owner','securityDefiner','signature']);
  if(i===4) {for(const key of ['acl','config','definition','oid','owner','securityDefiner'])assert.equal(f[key],null);continue;}
  const expected=plan.database.functions.find(e=>signature(e.signature)===f.signature);assert.ok(expected);
  assert.ok(Number.isSafeInteger(f.oid)&&f.oid>0);assert.equal(f.owner,'postgres');assert.equal(f.owner,expected.owner);
  assert.equal(f.securityDefiner,true);assert.deepEqual(f.config,['search_path=""']);
  assert.equal(typeof f.definition,'string');assert.ok(f.definition.startsWith('CREATE OR REPLACE FUNCTION '));
  assert.equal(hash(f.definition),expected.definitionSha256);
  assert.ok(Array.isArray(f.acl));assert.deepEqual([...f.acl].sort(),[...expected.acl].sort());
 }
 assert.ok(Array.isArray(versions)&&versions.length===146&&new Set(versions).size===146);
 for(const version of versions)assert.match(version,/^[0-9]{14}$/);
 assert.deepEqual([...versions].sort(),versions);
 assert.equal(state.migrations.length,146);assert.deepEqual(state.migrations.map(m=>m.version),versions);
 for(const row of state.migrations) {
  assert.ok(row.name===null||typeof row.name==='string');
  assert.ok(row.statements===null||(Array.isArray(row.statements)&&row.statements.every(s=>typeof s==='string')));
 }
 return {schema,projectId:plan.database.projectId,productCommit:plan.productCommit,productTree:plan.productTree,
  observedAt:value.observedAt,requestStartedAt:interval.startedAt,requestFinishedAt:interval.finishedAt,
  backendPid:value.backendPid,serverVersionNum:value.serverVersionNum,snapshot:structuredClone(state),
  preimageSha256:hash(JSON.stringify(canonical(state))),historyVerified:true,requiresAuthenticatedRun:true,releaseAuthorized:false};
}

export function verifyNativePreimage(input) {
 try {return verify(input);}
 catch {throw new Error('DELIVERY_NATIVE_PREIMAGE_REJECTED');}
}
