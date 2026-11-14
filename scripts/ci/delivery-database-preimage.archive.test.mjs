import assert from 'node:assert/strict';
import test from 'node:test';
import {sealNativePreimage,openNativePreimage,formatNativePreimageCapture,readNativePreimageEvents} from './delivery-database-preimage.archive.mjs';

const token='sbp_'+'a'.repeat(40);
const fixture=()=>({schema:'stallorder-delivery-native-preimage-archive/v1',projectId:'eyuctbnlvnbnivwasvqr',
 controlCommit:'b'.repeat(40),runId:'123',runAttempt:1,productCommit:'0d2b27144fcf589bb887e669c09e82158e3de7a2',
 productTree:'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0',requestStartedAt:'2026-11-14T04:00:00.000Z',
 finishedAt:'2026-11-14T04:00:01.000Z',endpoint:{projectId:'eyuctbnlvnbnivwasvqr',hostname:'aws-0-ap-northeast-1.pooler.supabase.com',port:'5432',username:'postgres.eyuctbnlvnbnivwasvqr',database:'postgres'},
 sourceDigests:{'scripts/ci/delivery-database-preimage.mjs':'c'.repeat(64)},
 preimageSha256:'d'.repeat(64),raw:{schema:'stallorder-delivery-native-preimage/v1',observedAt:'2026-11-14T04:00:00.000Z',snapshot:{private:'PRIVATE-SOURCE-MARKER'}},
 interval:{startedAt:'2026-11-14T04:00:00.000Z',finishedAt:'2026-11-14T04:00:00.500Z'},releaseAuthorized:false});
test('full native archive is encrypted, authenticated, and randomly sealed without credentials',()=>{
 const a=fixture(),sealed=sealNativePreimage(a,token),again=sealNativePreimage(a,token);
 assert.deepEqual(openNativePreimage(sealed,token),a);assert.notEqual(sealed.iv,again.iv);assert.notEqual(sealed.salt,again.salt);
 assert.ok(!JSON.stringify(sealed).includes('PRIVATE-SOURCE-MARKER'));assert.ok(!JSON.stringify(sealed).includes(token));
});
for(const field of ['salt','iv','tag','ciphertext'])test('rejects altered native encrypted '+field,()=>{
 const s=sealNativePreimage(fixture(),token),b=Buffer.from(s[field],'base64');b[0]^=1;s[field]=b.toString('base64');
 assert.throws(()=>openNativePreimage(s,token),{message:'DELIVERY_NATIVE_ARCHIVE_REJECTED'});
});
for(const kind of ['key','project','schema','algorithm','unknown','encoding','truncated'])test('rejects native archive '+kind,()=>{
 const s=sealNativePreimage(fixture(),token);let key=token;
 if(kind==='key')key='sbp_'+'e'.repeat(40);
 if(kind==='project')s.projectId='teunnvfakbfzmodajqjz';
 if(kind==='schema')s.schema='other';if(kind==='algorithm')s.algorithm='AES-128-GCM';
 if(kind==='unknown')s.extra='PRIVATE-SOURCE-MARKER';if(kind==='encoding')s.iv+='\n';
 if(kind==='truncated')s.ciphertext=s.ciphertext.slice(4);
 assert.throws(()=>openNativePreimage(s,key),error=>error.message==='DELIVERY_NATIVE_ARCHIVE_REJECTED'&&!error.cause&&!error.actual);
});
test('encrypted chunks have a strict complete ordered envelope and no plaintext source',()=>{
 const a=fixture(),s=sealNativePreimage(a,token),events=formatNativePreimageCapture(s,a);
 assert.deepEqual(readNativePreimageEvents(events,token),a);
 assert.ok(!JSON.stringify(events).includes('PRIVATE-SOURCE-MARKER'));
 assert.ok(!JSON.stringify(events).includes('raw'));
 for(const edit of [e=>e.pop(),e=>e.splice(1,0,e[1]),e=>e[1].index++,e=>e[0].bytes++,e=>e[0].sha256='0'.repeat(64),e=>e[0].runId='124']) {
  const copy=structuredClone(events);edit(copy);assert.throws(()=>readNativePreimageEvents(copy,token),{message:'DELIVERY_NATIVE_ARCHIVE_REJECTED'});
 }
});
test('refuses invalid source-bound archive input before encryption',()=>{
 for(const edit of [a=>a.releaseAuthorized=true,a=>a.runId='0',a=>a.productCommit='f'.repeat(40),a=>a.sourceDigests.a='bad',a=>a.endpoint.hostname='attacker.invalid',a=>a.finishedAt='2026-11-14T03:00:00.000Z']) {
  const a=fixture();edit(a);assert.throws(()=>sealNativePreimage(a,token),{message:'DELIVERY_NATIVE_ARCHIVE_REJECTED'});
 }
});
