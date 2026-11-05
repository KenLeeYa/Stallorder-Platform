import assert from 'node:assert/strict';
import {createHash,randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {get} from 'node:https';
import {isDeepStrictEqual} from 'node:util';
export const EDGE_SLUGS=Object.freeze(['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder']);
const projectRef='eyuctbnlvnbnivwasvqr';
const schema='stallorder-delivery-edge-recovery/v1';
const maximum=16*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
function metadata(m,slug){
 assert.equal(m.slug,slug);assert.equal(m.status,'ACTIVE');assert.equal(m.verify_jwt,false);
 assert.match(m.id??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 assert.ok(Number.isSafeInteger(m.version)&&m.version>0);
 const digest=m.sha256??m.ezbr_sha256;assert.match(digest??'',/^[a-f0-9]{64}$/);
 if(m.sha256&&m.ezbr_sha256)assert.equal(m.sha256,m.ezbr_sha256);
 for(const key of ['entrypoint_path','import_map_path'])assert.ok(typeof m[key]==='string'&&m[key].length>0&&m[key].length<4096&&!/[\x00-\x1f\x7f]/.test(m[key]));
 return {...structuredClone(m),sha256:digest};
}
function timestamp(s){assert.equal(typeof s,'string');const n=Date.parse(s);assert.equal(new Date(n).toISOString(),s);return n;}
export function verifyEdgeArchive({project,records,startedAt,finishedAt,now}){
 assert.equal(project,projectRef);assert.ok(Array.isArray(records)&&records.length===5);
 const start=timestamp(startedAt),finish=timestamp(finishedAt);
 assert.ok(Number.isFinite(now)&&start<=finish&&finish<=now&&finish-start<=120000&&now-finish<=300000);
 const functions=EDGE_SLUGS.map(slug=>{
  const matches=records.filter(r=>r.before?.slug===slug);assert.equal(matches.length,1);const r=matches[0];
  const before=metadata(r.before,slug);assert.ok(isDeepStrictEqual(metadata(r.after,slug),before),'deployed function changed during capture');
  assert.ok(Buffer.isBuffer(r.body)&&r.body.length>0&&r.body.length<=maximum);
  assert.ok(['identity','br'].includes(r.contentEncoding));
  // API download may omit the documented EZBR magic while returning the original
  // Brotli payload. Reattach only those four fixed bytes and require the deployed
  // digest. Never decompress, rebundle or recompress a supposed recovery artifact.
  const wire=r.body.subarray(0,4).equals(Buffer.from('EZBR'))?Buffer.from(r.body):
   r.contentEncoding==='br'?Buffer.concat([Buffer.from('EZBR'),r.body]):null;
  assert.ok(wire&&wire.length<=maximum);assert.equal(hash(wire),before.sha256,'deployed binary digest mismatch');
  return {slug,metadata:before,wireSha256:hash(wire),wireBase64:wire.toString('base64')};
 });
 return {schema,project,startedAt,finishedAt,functions,releaseAuthorized:false,restoreVerified:false};
}
function validateStored(a){
 assert.equal(a.schema,schema);assert.equal(a.project,projectRef);assert.equal(a.releaseAuthorized,false);
 assert.equal(a.restoreVerified,false);assert.ok(Array.isArray(a.functions)&&a.functions.length===5);
 const start=timestamp(a.startedAt),finish=timestamp(a.finishedAt);assert.ok(start<=finish&&finish-start<=120000,'EDGE_ARCHIVE_CHRONOLOGY');
 for(const slug of EDGE_SLUGS){
  const matches=a.functions.filter(f=>f.slug===slug);assert.equal(matches.length,1);const f=matches[0];
  metadata(f.metadata,slug);assert.equal(typeof f.wireBase64,'string');assert.ok(f.wireBase64.length<=maximum*4/3+4);
  const bytes=Buffer.from(f.wireBase64,'base64');assert.ok(bytes.toString('base64')===f.wireBase64,'EDGE_ARCHIVE_SOURCE_ENCODING');
  assert.ok(bytes.length<=maximum&&bytes.subarray(0,4).equals(Buffer.from('EZBR')));
  assert.equal(hash(bytes),f.wireSha256);assert.equal(f.wireSha256,f.metadata.sha256);
 }
}
function validateToken(token){if(typeof token!=='string'||!/^sbp_[a-f0-9]{40}$/.test(token))throw new Error('EDGE_ARCHIVE_TOKEN');}
function key(token,salt){validateToken(token);return Buffer.from(hkdfSync('sha256',token,salt,schema,32));}
const aad=()=>Buffer.from(JSON.stringify({schema,project:projectRef}));
export function sealEdgeArchive(archive,token){
 validateStored(archive);const salt=randomBytes(32),iv=randomBytes(12),derived=key(token,salt);
 try{const cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(aad());
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(archive),'utf8'),cipher.final()]);
  return {schema,project:projectRef,algorithm:'AES-256-GCM/HKDF-SHA256',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
 }finally{derived.fill(0);}
}
export function openEdgeArchive(sealed,token){
 assert.equal(sealed.schema,schema);assert.equal(sealed.project,projectRef);assert.equal(sealed.algorithm,'AES-256-GCM/HKDF-SHA256');
 const values={};for(const k of ['salt','iv','tag','ciphertext']){assert.equal(typeof sealed[k],'string');assert.ok(sealed[k].length<=maximum*10);values[k]=Buffer.from(sealed[k],'base64');assert.equal(values[k].toString('base64'),sealed[k]);}
 assert.equal(values.salt.length,32);assert.equal(values.iv.length,12);assert.equal(values.tag.length,16);
 const derived=key(token,values.salt);
 try{const decipher=createDecipheriv('aes-256-gcm',derived,values.iv);decipher.setAAD(aad());decipher.setAuthTag(values.tag);
  const bytes=Buffer.concat([decipher.update(values.ciphertext),decipher.final()]);const archive=JSON.parse(bytes.toString('utf8'));validateStored(archive);return archive;
 }finally{derived.fill(0);}
}
// Fixed read-only Management API transport. No redirects or transparent decoding.
// The injected transport exists only for offline tests; provider inputs stay literal.
export function readEdgeResponse({project,slug,body=false,token,deadlineAt=Date.now()+20000},transport=get){
 assert.equal(project,projectRef);assert.ok(EDGE_SLUGS.includes(slug));validateToken(token);
 const remaining=Math.min(20000,deadlineAt-Date.now());
 if(!Number.isFinite(remaining)||remaining<=0)return Promise.reject(new Error('EDGE_ARCHIVE_DEADLINE'));
 return new Promise((resolve,reject)=>{
  let req,res,timer,settled=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(error){res?.destroy();req?.destroy();reject(error);}else resolve(result);
  };
  timer=setTimeout(()=>finish(new Error('EDGE_ARCHIVE_DEADLINE')),remaining);
  const path='/v1/projects/'+project+'/functions/'+slug+(body?'/body':'');
  try{req=transport({hostname:'api.supabase.com',path,headers:{Authorization:'Bearer '+token,Accept:body?'application/octet-stream':'application/json','Accept-Encoding':'identity'}},response=>{
   res=response;res.on('error',()=>finish(new Error('EDGE_ARCHIVE_STREAM')));
   if(res.statusCode!==200){finish(new Error('EDGE_ARCHIVE_HTTP_'+res.statusCode));return;}
   const encoding=res.headers['content-encoding']??'identity';
   if(!['identity','br'].includes(encoding)||(!body&&encoding!=='identity')){finish(new Error('EDGE_ARCHIVE_ENCODING'));return;}
   const parts=[];let total=0;
   res.on('data',chunk=>{if(settled)return;total+=chunk.length;if(total>(body?maximum:1048576))finish(new Error('EDGE_ARCHIVE_TOO_LARGE'));else parts.push(chunk);});
   res.on('end',()=>{if(!res.complete){finish(new Error('EDGE_ARCHIVE_INCOMPLETE'));return;}finish(null,{bytes:Buffer.concat(parts),encoding});});
   res.on('close',()=>{if(!res.complete)finish(new Error('EDGE_ARCHIVE_INCOMPLETE'));});
  });
  req.on('error',()=>finish(new Error('EDGE_ARCHIVE_TRANSPORT')));
  if(settled)req.destroy();
  }catch{finish(new Error('EDGE_ARCHIVE_TRANSPORT'));}
 });
}
export async function collectEdgeArchive({token,request=readEdgeResponse,clock=()=>Date.now()}){
 validateToken(token);
 const start=clock(),startedAt=new Date(start).toISOString(),deadlineAt=start+120000,records=[];
 const read=async args=>{
  if(clock()>=deadlineAt)throw new Error('EDGE_ARCHIVE_DEADLINE');
  const result=await request({project:projectRef,token,deadlineAt,...args});
  if(clock()>=deadlineAt)throw new Error('EDGE_ARCHIVE_DEADLINE');return result;
 };
 const parse=r=>{try{return JSON.parse(r.bytes.toString('utf8'));}catch{throw new Error('EDGE_ARCHIVE_METADATA_JSON');}};
 // Capture every preimage first, then every byte body, then every postimage.
 for(const slug of EDGE_SLUGS){const before=parse(await read({slug}));metadata(before,slug);records.push({before});}
 for(const r of records){const b=await read({slug:r.before.slug,body:true});r.body=b.bytes;r.contentEncoding=b.encoding;}
 for(const r of records)r.after=parse(await read({slug:r.before.slug}));
 const finishedAt=new Date(clock()).toISOString();
 return verifyEdgeArchive({project:projectRef,records,startedAt,finishedAt,now:clock()});
}
