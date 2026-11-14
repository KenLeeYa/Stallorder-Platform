import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {RECOVERY_SIGNATURES} from './delivery-database-recovery.mjs';
import {verifyNativePreimage, NATIVE_PREIMAGE_SQL} from './delivery-database-preimage.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const at='2026-11-14T03:30:00.000Z';
function fixture() {
 const versions=Array.from({length:146},(_,i)=>String(20200101000000+i));
 const functions=RECOVERY_SIGNATURES.map((signature,i)=>({signature,oid:i<4?100+i:null,
  definition:i<4?'CREATE OR REPLACE FUNCTION synthetic_'+i+'() RETURNS void LANGUAGE sql AS $$ SELECT; $$\n':null,
  owner:i<4?'postgres':null,acl:i<4?['postgres=X/postgres','service_role=X/postgres']:null,
  config:i<4?['search_path=""']:null,securityDefiner:i<4?true:null}));
 const plan={productCommit:'0d2b27144fcf589bb887e669c09e82158e3de7a2',productTree:'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0',
  database:{projectId:'eyuctbnlvnbnivwasvqr',serverVersionNum:170006,functions:functions.slice(0,4).map(f=>({signature:f.signature,
   definitionSha256:hash(f.definition),owner:f.owner,acl:f.acl}))}};
 const value={schema:'stallorder-delivery-native-preimage/v1',observedAt:at,backendPid:123,serverVersionNum:170006,
  transactionReadOnly:true,createPublic:true,functionsExecutable:true,snapshot:{
   principal:{currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true},functions,
   migrations:versions.map(version=>({version,name:'original',statements:['SELECT 1;'],created_by:null}))}};
 return {value,plan,versions,interval:{startedAt:at,finishedAt:at},now:Date.parse(at)};
}
test('retains complete function definitions and every migration field without granting release',()=>{
 const input=fixture(),before=structuredClone(input),out=verifyNativePreimage(input);
 assert.deepEqual(input,before);assert.deepEqual(out.snapshot,input.value.snapshot);
 assert.equal(out.historyVerified,true);assert.equal(out.releaseAuthorized,false);
 assert.match(out.preimageSha256,/^[a-f0-9]{64}$/);
 const reordered=fixture();reordered.value.snapshot.migrations[0]={created_by:null,statements:['SELECT 1;'],name:'original',version:reordered.versions[0]};
 assert.equal(verifyNativePreimage(reordered).preimageSha256,out.preimageSha256);
 reordered.value.snapshot.migrations[0].statements=['SELECT 2;'];
 assert.notEqual(verifyNativePreimage(reordered).preimageSha256,out.preimageSha256);
});
for(const [name,edit]of[
 ['wrong role',x=>x.value.snapshot.principal.sessionUser='supabase_admin'],
 ['write enabled',x=>x.value.transactionReadOnly=false],
 ['wrong server',x=>x.value.serverVersionNum=170007],
 ['missing create privilege',x=>x.value.createPublic=false],
 ['missing execute privilege',x=>x.value.functionsExecutable=false],
 ['missing OID',x=>x.value.snapshot.functions[0].oid=null],
 ['definition drift',x=>x.value.snapshot.functions[0].definition+='-- changed'],
 ['ACL drift',x=>x.value.snapshot.functions[0].acl=['anon=X/postgres']],
 ['search path drift',x=>x.value.snapshot.functions[0].config=['search_path=public']],
 ['helper already present',x=>x.value.snapshot.functions[4].oid=999],
 ['missing history row',x=>x.value.snapshot.migrations.pop()],
 ['duplicate history row',x=>x.value.snapshot.migrations[1]=structuredClone(x.value.snapshot.migrations[0])],
 ['foreign history version',x=>x.value.snapshot.migrations[0].version='19990101000000'],
 ['future observation',x=>x.value.observedAt='2026-11-14T03:30:01.000Z'],
 ['expired observation',x=>x.now+=300001],
 ['wrong product',x=>x.plan.productCommit='a'.repeat(40)],
 ['wrong project',x=>x.plan.database.projectId='teunnvfakbfzmodajqjz'],
 ['extra envelope field',x=>x.value.unexpected='PRIVATE-SOURCE-MARKER'],
 ['function array imitation',x=>x.value.snapshot.functions={...x.value.snapshot.functions,length:5}],
 ['migration array imitation',x=>x.value.snapshot.migrations={...x.value.snapshot.migrations,length:146}],
])test('rejects native preimage '+name,()=>{const input=fixture();edit(input);assert.throws(()=>verifyNativePreimage(input));});
test('invalid sensitive state produces only a fixed redacted error without raw assertion fields',()=>{
 const input=fixture();input.value.snapshot.functions[4].definition='PRIVATE-SOURCE-MARKER';
 assert.throws(()=>verifyNativePreimage(input),error=>{
  assert.equal(error.message,'DELIVERY_NATIVE_PREIMAGE_REJECTED');
  assert.equal(error.cause,undefined);assert.equal(error.actual,undefined);assert.equal(error.expected,undefined);
  assert.ok(!JSON.stringify(error).includes('PRIVATE-SOURCE-MARKER'));return true;
 });
});
test('SQL uses one full-state catalog statement and records actual read-only/session evidence',()=>{
 assert.match(NATIVE_PREIMAGE_SQL,/current_setting\('transaction_read_only'\)/);
 assert.match(NATIVE_PREIMAGE_SQL,/pg_backend_pid\(\)/);
 assert.match(NATIVE_PREIMAGE_SQL,/pg_get_functiondef/);
 assert.match(NATIVE_PREIMAGE_SQL,/to_jsonb\(m\)/);
 assert.doesNotMatch(NATIVE_PREIMAGE_SQL,/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\s/);
});
