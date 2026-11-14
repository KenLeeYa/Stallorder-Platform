import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateSnapshots,RECOVERY_SIGNATURES} from './delivery-database-recovery.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const productCommit='0d2b27144fcf589bb887e669c09e82158e3de7a2',productTree='e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0';
const migrationSha256='adf00cba767ae8aac8f057a8003e40e67be04558d09bc0f0ca8774648db88bb2';
const schema='stallorder-delivery-native-postimage-template/v1';
const fields=['signature','definition','owner','acl','config','securityDefiner'];
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const protect=fn=>{try{return fn();}catch{throw new Error('DELIVERY_NATIVE_POSTIMAGE_REJECTED');}};
function template(after) {
 return {schema,productCommit,productTree,migrationSha256,sourceOnly:true,
  functions:after.functions.map(f=>Object.fromEntries(fields.map(k=>[k,structuredClone(f[k])]))),
  migrationRecord:structuredClone(after.migrations[146])};
}
// Only the owned frozen-product migration rehearsal produces this source
// template. No captured baseline rows, OIDs, credentials or authority are encoded.
export function encodeNativePostimageTemplate({before,after,migration}) {return protect(()=>{
 assert.equal(typeof migration,'string');assert.equal(hash(migration),migrationSha256);
 validateSnapshots(before,after);
 const bytes=Buffer.from(JSON.stringify(canonical(template(after)))+'\n');
 assert.ok(bytes.length<=1024*1024);
 return {bytes,sha256:hash(bytes),sourceOnly:true,releaseAuthorized:false};
});}
// Caller must independently authenticate the complete native baseline and bind
// sha256 to the reviewed template qualified by the actual frozen-product run.
// The helper OID is a placeholder only; applySql replaces it with the target's
// newly allocated OID before comparison. Recovery needs the actual post-read.
export function materializeNativePostimage({before,bytes,sha256}) {return protect(()=>{
 assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=1024*1024);
 assert.match(sha256??'',/^[a-f0-9]{64}$/);assert.equal(hash(bytes),sha256);
 const t=JSON.parse(bytes.toString('utf8'));
 assert.deepEqual(Object.keys(t).sort(),['functions','migrationRecord','migrationSha256','productCommit','productTree','schema','sourceOnly']);
 assert.equal(t.schema,schema);assert.equal(t.productCommit,productCommit);assert.equal(t.productTree,productTree);
 assert.equal(t.migrationSha256,migrationSha256);assert.equal(t.sourceOnly,true);
 assert.ok(Array.isArray(t.functions)&&t.functions.length===5);
 for(let i=0;i<5;i++) {
  assert.deepEqual(Object.keys(t.functions[i]).sort(),[...fields].sort());assert.equal(t.functions[i].signature,RECOVERY_SIGNATURES[i]);
 }
 assert.ok(Array.isArray(before.migrations)&&before.migrations.length===146);
 const columns=Object.keys(t.migrationRecord).sort();
 for(const row of before.migrations)assert.deepEqual(Object.keys(row).sort(),columns);
 const after={principal:structuredClone(before.principal),
  functions:t.functions.map((f,i)=>({...structuredClone(f),oid:i<4?before.functions[i].oid:1})),
  migrations:[...structuredClone(before.migrations),structuredClone(t.migrationRecord)]};
 validateSnapshots(before,after);
 return {snapshot:after,templateSha256:sha256,releaseAuthorized:false};
});}
