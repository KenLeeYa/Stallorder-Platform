import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RECOVERY_SIGNATURES} from './delivery-database-recovery.mjs';
import {encodeNativePostimageTemplate,materializeNativePostimage} from './delivery-database-postimage.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const path='supabase/migrations/20261029090000_public_delivery_ordering_hours.sql';
const section=readFileSync(new URL('./delivery-source/candidate.patch',import.meta.url),'utf8').split(`diff --git a/${path} b/${path}\n`)[1].split('\ndiff --git ')[0];
const migration=section.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n')+'\n';
function fixture() {
 const before={principal:{currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true},
  functions:RECOVERY_SIGNATURES.map((signature,i)=>({signature,oid:i<4?100+i:null,
   definition:i<4?`CREATE OR REPLACE FUNCTION public.example${i}() RETURNS text LANGUAGE sql AS 'SELECT ''before''::text';`:null,
   owner:i<4?'postgres':null,acl:i<4?['postgres=X/postgres']:null,config:i<4?['search_path=""']:null,securityDefiner:i<4?true:null})),
  migrations:Array.from({length:146},(_,i)=>({version:String(20200101000000+i),name:'original',statements:['SELECT 1'],created_by:null}))};
 const after=structuredClone(before);
 after.functions.forEach((f,i)=>Object.assign(f,{oid:100+i,definition:`CREATE OR REPLACE FUNCTION public.example${i}() RETURNS text LANGUAGE sql AS 'SELECT ''after''::text';`,owner:'postgres',acl:i<4?['postgres=X/postgres']:['postgres=X/postgres','service_role=X/postgres'],config:['search_path=""'],securityDefiner:true}));
 after.migrations.push({version:'20261029090000',name:'public_delivery_ordering_hours',statements:[migration],created_by:null});
 return {before,after,migration};
}
test('materializes qualified source using exact native baseline OIDs and complete history',()=>{
 const f=fixture(),encoded=encodeNativePostimageTemplate(f),native=structuredClone(f.before);
 native.functions.slice(0,4).forEach(f=>f.oid+=10000);native.migrations[0].statements=['SELECT 42'];
 const out=materializeNativePostimage({before:native,bytes:encoded.bytes,sha256:encoded.sha256});
 assert.deepEqual(out.snapshot.migrations.slice(0,146),native.migrations);
 assert.deepEqual(out.snapshot.functions.slice(0,4).map(f=>f.oid),native.functions.slice(0,4).map(f=>f.oid));
 assert.equal(out.snapshot.functions[4].oid,1);assert.equal(out.releaseAuthorized,false);
 assert.equal(encoded.sourceOnly,true);assert.equal(hash(encoded.bytes),encoded.sha256);
 assert.deepEqual(out.snapshot.migrations[146],f.after.migrations[146]);
});
test('template contains only five postimage definitions and the new history record',()=>{
 const f=fixture(),out=encodeNativePostimageTemplate(f),template=JSON.parse(out.bytes);
 assert.equal(template.functions.length,5);assert.equal(template.functions.some(f=>'oid' in f),false);
 assert.equal('principal' in template,false);assert.equal('migrations' in template,false);
 assert.ok(!out.bytes.toString().includes('SELECT 1'));assert.ok(!out.bytes.toString().includes("''before''"));
 const reordered=structuredClone(f);reordered.after.migrations[146]={created_by:null,statements:[migration],name:'public_delivery_ordering_hours',version:'20261029090000'};
 assert.equal(encodeNativePostimageTemplate(reordered).sha256,out.sha256);
});
for(const [name,edit]of[
 ['wrong product',t=>t.productCommit='a'.repeat(40)],['wrong tree',t=>t.productTree='a'.repeat(40)],
 ['wrong migration',t=>t.migrationSha256='a'.repeat(64)],['unknown root field',t=>t.extra=true],
 ['function array imitation',t=>t.functions={...t.functions,length:5}],['missing function',t=>t.functions.pop()],
 ['foreign signature',t=>t.functions[0].signature='public.other()'],['added OID',t=>t.functions[0].oid=1],
 ['wrong ACL',t=>t.functions[0].acl.push('anon=X/postgres')],['changed owner',t=>t.functions[0].owner='other'],
 ['wrong history version',t=>t.migrationRecord.version='20261030090000'],
 ['history column drift',t=>t.migrationRecord.new_column=null],
])test('rejects postimage template '+name,()=>{
 const f=fixture(),encoded=encodeNativePostimageTemplate(f),t=JSON.parse(encoded.bytes);edit(t);
 const bytes=Buffer.from(JSON.stringify(t));
 assert.throws(()=>materializeNativePostimage({before:f.before,bytes,sha256:hash(bytes)}),{message:'DELIVERY_NATIVE_POSTIMAGE_REJECTED'});
});
test('rejects source-byte drift despite otherwise valid state',()=>{
 const f=fixture(),e=encodeNativePostimageTemplate(f);
 assert.throws(()=>materializeNativePostimage({before:f.before,bytes:Buffer.concat([e.bytes,Buffer.from(' ')]),sha256:e.sha256}),{message:'DELIVERY_NATIVE_POSTIMAGE_REJECTED'});
});
test('encoder rejects unreviewed migration and unrelated baseline changes',()=>{
 const f=fixture();assert.throws(()=>encodeNativePostimageTemplate({...f,migration:migration+'SELECT 1;'}),{message:'DELIVERY_NATIVE_POSTIMAGE_REJECTED'});
 f.after.migrations[0].name='changed';assert.throws(()=>encodeNativePostimageTemplate(f),{message:'DELIVERY_NATIVE_POSTIMAGE_REJECTED'});
});
