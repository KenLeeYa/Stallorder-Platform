import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brotliCompressSync} from 'node:zlib';
import {verifyEdgeArchive,sealEdgeArchive,openEdgeArchive,collectEdgeArchive,readEdgeResponse,EDGE_SLUGS} from './delivery-edge-recovery.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const body=brotliCompressSync(Buffer.from('synthetic immutable ESZIP bytes'));
 const wire=Buffer.concat([Buffer.from('EZBR'),body]);
 const records=EDGE_SLUGS.map((slug,i)=>{const metadata={id:'12345678-1234-4234-8234-'+String(i+1).padStart(12,'0'),slug,name:slug,version:35,status:'ACTIVE',verify_jwt:false,entrypoint_path:'file:///source/'+slug+'/index.ts',import_map_path:'file:///source/deno.json',sha256:sha(wire)};return {before:{...metadata},after:{...metadata},body:Buffer.from(body),contentEncoding:'br'};});
 return {project:'eyuctbnlvnbnivwasvqr',startedAt:'2026-11-04T22:00:00.000Z',finishedAt:'2026-11-04T22:00:10.000Z',now:Date.parse('2026-11-04T22:00:11Z'),records};
}
test('binds all five stable deployed bundles without recompressing bytes',()=>{
 const f=fixture(),out=verifyEdgeArchive(f); assert.equal(out.functions.length,5); assert.equal(out.releaseAuthorized,false);
 assert.equal(out.functions[0].wireSha256,f.records[0].before.sha256);
 assert.deepEqual(Buffer.from(out.functions[0].wireBase64,'base64').subarray(4),f.records[0].body);
});
test('accepts an already enveloped exact EZBR binary',()=>{
 const f=fixture();for(const r of f.records){r.body=Buffer.concat([Buffer.from('EZBR'),r.body]);r.contentEncoding='identity';}
 assert.equal(verifyEdgeArchive(f).functions.length,5);
});
for(const [name,mutate] of [
 ['wrong project',f=>f.project='foreign'],['missing bundle',f=>f.records.pop()],['duplicate bundle',f=>f.records[1]=f.records[0]],
 ['changed wire bytes',f=>f.records[0].body[1]^=1],['metadata drift',f=>f.records[0].after.version++],
 ['nonactive function',f=>{f.records[0].before.status='FAILED';f.records[0].after.status='FAILED';}],
 ['missing digest',f=>{delete f.records[0].before.sha256;delete f.records[0].after.sha256;}],
 ['changed JWT policy',f=>f.records[0].after.verify_jwt=true],['unknown encoding',f=>f.records[0].contentEncoding='gzip'],
 ['missing import map',f=>{delete f.records[0].before.import_map_path;delete f.records[0].after.import_map_path;}],
 ['stale capture',f=>f.now+=301000],['future capture',f=>f.finishedAt='2026-11-04T22:00:12.000Z'],
 ['long capture',f=>f.startedAt='2026-11-04T21:50:00.000Z'],
])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyEdgeArchive(f));});
test('encrypted archive is authenticated, bounded to Primary and contains no plaintext credential/source',()=>{
 const a=verifyEdgeArchive(fixture()),token='sbp_'+'a'.repeat(40);const sealed=sealEdgeArchive(a,token);
 assert.ok(!JSON.stringify(sealed).includes(token));assert.ok(!JSON.stringify(sealed).includes(a.functions[0].wireBase64));
 assert.deepEqual(openEdgeArchive(sealed,token),a);
 assert.throws(()=>openEdgeArchive(sealed,'sbp_'+'b'.repeat(40)));
 for(const key of ['ciphertext','tag','salt','iv']) {const b=structuredClone(sealed);const bytes=Buffer.from(b[key],'base64');bytes[0]^=1;b[key]=bytes.toString('base64');assert.throws(()=>openEdgeArchive(b,token));}
 assert.throws(()=>openEdgeArchive({...sealed,project:'foreign'},token));
});

for (const token of ['sbp_'+'c'.repeat(40)+' ', null, 17]) test('rejects invalid credentials without exposing their value: '+typeof token,()=>{
 const archive=verifyEdgeArchive(fixture());
 for (const invoke of [()=>sealEdgeArchive(archive,token),()=>readEdgeResponse({project:archive.project,slug:EDGE_SLUGS[0],token})]) {
  let error; try{invoke();}catch(e){error=e;}
  assert.ok(error); assert.equal(error.message,'EDGE_ARCHIVE_TOKEN'); assert.equal(error.actual,undefined);
 }
});
test('rejects import_map configuration drift',()=>{const f=fixture();for(const r of f.records){r.before.import_map=true;r.after.import_map=true;}f.records[0].after.import_map=false;assert.throws(()=>verifyEdgeArchive(f));});
test('sealed archives reject reversed and excessive capture duration',()=>{for(const startedAt of ['2026-11-04T22:01:00.000Z','2026-11-04T21:50:00.000Z']){const a=verifyEdgeArchive(fixture());a.startedAt=startedAt;assert.throws(()=>sealEdgeArchive(a,'sbp_'+'c'.repeat(40)));}});
test('collector binds all three phases and stops issuing requests at total deadline',async()=>{
 const f=fixture(),calls=[];let time=Date.parse(f.startedAt);
 const request=async args=>{calls.push(args);time+=10000;const r=f.records.find(r=>r.before.slug===args.slug);return args.body?{bytes:r.body,encoding:'br'}:{bytes:Buffer.from(JSON.stringify(r.before)),encoding:'identity'};};
 await assert.rejects(collectEdgeArchive({token:'sbp_'+'c'.repeat(40),request,clock:()=>time}),/DEADLINE/);
 assert.equal(calls.length,12);assert.equal(calls[0].deadlineAt,Date.parse(f.startedAt)+120000);
});
test('collector records only the five stable immutable bundles',async()=>{
 const f=fixture(),calls=[];let time=Date.parse(f.startedAt);
 const request=async args=>{calls.push({slug:args.slug,body:args.body===true});time+=100;const r=f.records.find(r=>r.before.slug===args.slug);return args.body?{bytes:r.body,encoding:'br'}:{bytes:Buffer.from(JSON.stringify(r.before)),encoding:'identity'};};
 const a=await collectEdgeArchive({token:'sbp_'+'c'.repeat(40),request,clock:()=>time});
 assert.equal(a.functions.length,5);assert.equal(calls.length,15);assert.deepEqual(calls.map(c=>c.body),[...Array(5).fill(false),...Array(5).fill(true),...Array(5).fill(false)]);
});

import {EventEmitter} from 'node:events';
function fakeTransport({status=200,encoding='identity',stream}={}){
 const req=new EventEmitter(),res=new EventEmitter();req.destroy=()=>{req.destroyed=true;};res.destroy=()=>{res.destroyed=true;};res.statusCode=status;res.headers={'content-encoding':encoding};res.complete=false;
 return {req,res,get:(options,callback)=>{queueMicrotask(()=>{callback(res);stream?.(res);});return req;}};
}
for(const [status,encoding,error] of [[302,'identity','HTTP_302'],[403,'identity','HTTP_403'],[200,'gzip','ENCODING']])test('aborts rejected response immediately: '+status+' '+encoding,async()=>{
 const t=fakeTransport({status,encoding});await assert.rejects(readEdgeResponse({project:fixture().project,slug:EDGE_SLUGS[0],token:'sbp_'+'d'.repeat(40)},t.get),new RegExp(error));assert.equal(t.req.destroyed,true);assert.equal(t.res.destroyed,true);
});
test('absolute deadline stops a continuously active response',async()=>{
 let interval;const t=fakeTransport({stream:res=>{interval=setInterval(()=>res.emit('data',Buffer.from('x')),2);}});
 try{await assert.rejects(readEdgeResponse({project:fixture().project,slug:EDGE_SLUGS[0],token:'sbp_'+'d'.repeat(40),deadlineAt:Date.now()+40},t.get),/DEADLINE/);assert.equal(t.res.destroyed,true);assert.equal(t.req.destroyed,true);}finally{clearInterval(interval);}
});
test('source encoding errors do not include decoded source or its encoding',()=>{
 const a=verifyEdgeArchive(fixture());a.functions[0].wireBase64+='?';let error;try{sealEdgeArchive(a,'sbp_'+'d'.repeat(40));}catch(e){error=e;}
 assert.ok(error);assert.equal(error.message,'EDGE_ARCHIVE_SOURCE_ENCODING');assert.equal(error.actual,false);assert.ok(!JSON.stringify(error).includes(a.functions[0].wireBase64));
});
test('retains and compares additional provider configuration metadata',()=>{const f=fixture();for(const r of f.records){r.before.unknown_config={enabled:true};r.after.unknown_config={enabled:true};}assert.deepEqual(verifyEdgeArchive(f).functions[0].metadata.unknown_config,{enabled:true});f.records[0].after.unknown_config.enabled=false;assert.throws(()=>verifyEdgeArchive(f));});
test('malformed provider JSON is rejected without printing its bytes',async()=>{const bad='private-synthetic-source';let error;try{await collectEdgeArchive({token:'sbp_'+'d'.repeat(40),request:async()=>({bytes:Buffer.from(bad)})});}catch(e){error=e;}assert.equal(error.message,'EDGE_ARCHIVE_METADATA_JSON');assert.equal(error.actual,undefined);});
