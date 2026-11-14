import assert from 'node:assert/strict';
import {createHash,randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const schema='stallorder-delivery-native-preimage-archive/v1',projectId='eyuctbnlvnbnivwasvqr';
const maximum=20*1024*1024,wireMaximum=32*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
const aad=()=>Buffer.from(JSON.stringify({schema,projectId}));
const instant=s=>{assert.equal(typeof s,'string');const n=Date.parse(s);assert.equal(new Date(n).toISOString(),s);return n;};
const protect=fn=>{try{return fn();}catch{throw new Error('DELIVERY_NATIVE_ARCHIVE_REJECTED');}};
function key(token,salt) {
 assert.match(token??'',/^sbp_[a-f0-9]{40}$/);
 return Buffer.from(hkdfSync('sha256',token,salt,schema,32));
}
// Encryption authenticates these bytes, not their provider origin. The protected
// consumer must also authenticate GitHub execution, source, freshness and raw SQL.
function validate(a) {
 assert.deepEqual(Object.keys(a).sort(),['controlCommit','endpoint','finishedAt','interval','preimageSha256','productCommit','productTree','projectId','raw','releaseAuthorized','requestStartedAt','runAttempt','runId','schema','sourceDigests']);
 assert.equal(a.schema,schema);assert.equal(a.projectId,projectId);assert.equal(a.releaseAuthorized,false);
 assert.match(a.controlCommit??'',/^[a-f0-9]{40}$/);assert.match(a.runId??'',/^[1-9][0-9]*$/);
 assert.ok(Number.isSafeInteger(a.runAttempt)&&a.runAttempt>0);
 assert.equal(a.productCommit,'0d2b27144fcf589bb887e669c09e82158e3de7a2');
 assert.equal(a.productTree,'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0');
 const times=[a.requestStartedAt,a.interval.startedAt,a.raw.observedAt,a.interval.finishedAt,a.finishedAt].map(instant);
 assert.ok(times.every((v,i)=>i===0||times[i-1]<=v)&&times.at(-1)-times[0]<=90000);
 assert.deepEqual(Object.keys(a.endpoint).sort(),['database','hostname','port','projectId','username']);
 assert.equal(a.endpoint.projectId,projectId);assert.equal(a.endpoint.port,'5432');
 assert.equal(a.endpoint.username,'postgres.'+projectId);assert.equal(a.endpoint.database,'postgres');
 assert.match(a.endpoint.hostname??'',/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/);
 assert.equal(a.raw.schema,'stallorder-delivery-native-preimage/v1');assert.ok(a.raw.snapshot);
 assert.match(a.preimageSha256??'',/^[a-f0-9]{64}$/);
 assert.ok(a.sourceDigests&&Object.keys(a.sourceDigests).length>0&&Object.keys(a.sourceDigests).length<=16);
 for(const [path,digest]of Object.entries(a.sourceDigests)) {
  assert.match(path,/^(?:scripts\/ci\/[a-z0-9.-]+|\.github\/workflows\/production-delivery-evidence\.yml)$/);
  assert.match(digest??'',/^[a-f0-9]{64}$/);
 }
 assert.ok(Buffer.byteLength(JSON.stringify(a))<=maximum);
 return a;
}
export function sealNativePreimage(archive,token) {return protect(()=>{
 validate(archive);const salt=randomBytes(32),iv=randomBytes(12),derived=key(token,salt);
 try {
  const cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(aad());
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(archive),'utf8'),cipher.final()]);
  return {schema,projectId,algorithm:'AES-256-GCM/HKDF-SHA256',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
 }finally{derived.fill(0);}
});}
export function openNativePreimage(sealed,token) {return protect(()=>{
 assert.deepEqual(Object.keys(sealed).sort(),['algorithm','ciphertext','iv','projectId','salt','schema','tag']);
 assert.equal(sealed.schema,schema);assert.equal(sealed.projectId,projectId);assert.equal(sealed.algorithm,'AES-256-GCM/HKDF-SHA256');
 const b={};for(const k of ['salt','iv','tag','ciphertext']) {
  assert.equal(typeof sealed[k],'string');assert.ok(sealed[k].length>0&&sealed[k].length<=wireMaximum);
  b[k]=Buffer.from(sealed[k],'base64');assert.equal(b[k].toString('base64'),sealed[k]);
 }
 assert.equal(b.salt.length,32);assert.equal(b.iv.length,12);assert.equal(b.tag.length,16);assert.ok(b.ciphertext.length<=maximum);
 const derived=key(token,b.salt);
 try {
  const decipher=createDecipheriv('aes-256-gcm',derived,b.iv);decipher.setAAD(aad());decipher.setAuthTag(b.tag);
  const bytes=Buffer.concat([decipher.update(b.ciphertext),decipher.final()]);
  return validate(JSON.parse(bytes.toString('utf8')));
 }finally{derived.fill(0);}
});}
const summary=a=>Object.fromEntries(['schema','projectId','controlCommit','runId','runAttempt','productCommit','productTree','requestStartedAt','finishedAt','preimageSha256','sourceDigests','releaseAuthorized'].map(k=>[k,a[k]]));
export function formatNativePreimageCapture(sealed,archive) {return protect(()=>{
 validate(archive);const bytes=Buffer.from(JSON.stringify(sealed));assert.ok(bytes.length<=wireMaximum);
 const sha256=hash(bytes),encoded=bytes.toString('base64'),chunks=Math.ceil(encoded.length/12000);
 const events=[{event:'delivery-native-preimage-capture',...summary(archive),sha256,bytes:bytes.length,chunks}];
 for(let i=0;i<chunks;i++)events.push({event:'delivery-native-preimage-chunk',sha256,index:i,data:encoded.slice(i*12000,(i+1)*12000)});
 events.push({event:'delivery-native-preimage-complete',sha256,chunks});return events;
});}
export function readNativePreimageEvents(events,token) {return protect(()=>{
 assert.ok(Array.isArray(events)&&events.length>=3&&events.length<=4002);
 const header=events[0],end=events.at(-1);assert.equal(header.event,'delivery-native-preimage-capture');
 assert.ok(Number.isSafeInteger(header.bytes)&&header.bytes>0&&header.bytes<=wireMaximum);
 assert.ok(Number.isSafeInteger(header.chunks)&&header.chunks>0&&events.length===header.chunks+2);
 assert.match(header.sha256??'',/^[a-f0-9]{64}$/);
 assert.ok(isDeepStrictEqual(end,{event:'delivery-native-preimage-complete',sha256:header.sha256,chunks:header.chunks}));
 const parts=[];for(let i=0;i<header.chunks;i++) {
  const c=events[i+1];assert.deepEqual(Object.keys(c).sort(),['data','event','index','sha256']);
  assert.equal(c.event,'delivery-native-preimage-chunk');assert.equal(c.sha256,header.sha256);assert.equal(c.index,i);
  assert.equal(typeof c.data,'string');assert.ok(c.data.length>0&&c.data.length<=12000);
  if(i<header.chunks-1)assert.equal(c.data.length,12000);parts.push(c.data);
 }
 const encoded=parts.join(''),bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);
 assert.equal(bytes.length,header.bytes);assert.equal(hash(bytes),header.sha256);
 const archive=openNativePreimage(JSON.parse(bytes.toString('utf8')),token);
 assert.ok(isDeepStrictEqual(header,{event:'delivery-native-preimage-capture',...summary(archive),sha256:header.sha256,bytes:header.bytes,chunks:header.chunks}));
 return archive;
});}
