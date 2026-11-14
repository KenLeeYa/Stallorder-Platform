import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {RECOVERY_SIGNATURES} from './delivery-database-recovery.mjs';
import {verifyNativePreimage} from './delivery-database-preimage.mjs';
import {NATIVE_PREIMAGE_SOURCE_PATHS} from './delivery-database-preimage.capture.mjs';
import {sealNativePreimage,formatNativePreimageCapture} from './delivery-database-preimage.archive.mjs';
import {verifyProtectedNativePreimage,loadProtectedNativePreimage,NATIVE_PREIMAGE_CAPTURE_STEP} from './delivery-database-preimage.load.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),at='2026-11-14T04:00:00.000Z',token='sbp_'+'a'.repeat(40);
const later=n=>new Date(Date.parse(at)+n*1000).toISOString();
function fixture() {
 const versions=Array.from({length:146},(_,i)=>String(20200101000000+i));
 const functions=RECOVERY_SIGNATURES.map((signature,i)=>({signature,oid:i<4?100+i:null,
  definition:i<4?'CREATE OR REPLACE FUNCTION synthetic_'+i+'() RETURNS void LANGUAGE sql AS $$ SELECT; $$\n':null,
  owner:i<4?'postgres':null,acl:i<4?['postgres=X/postgres','service_role=X/postgres']:null,config:i<4?['search_path=""']:null,securityDefiner:i<4?true:null}));
 const plan={productCommit:'0d2b27144fcf589bb887e669c09e82158e3de7a2',productTree:'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0',database:{projectId:'eyuctbnlvnbnivwasvqr',serverVersionNum:170006,executor:{authentication:'database-password'},functions:functions.slice(0,4).map(f=>({signature:f.signature,definitionSha256:hash(f.definition),owner:f.owner,acl:f.acl}))}};
 const raw={schema:'stallorder-delivery-native-preimage/v1',observedAt:later(10),backendPid:123,serverVersionNum:170006,transactionReadOnly:true,createPublic:true,functionsExecutable:true,snapshot:{principal:{currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true},functions,migrations:versions.map(version=>({version,name:'original',statements:['SELECT 1;']}))}};
 const interval={startedAt:later(9),finishedAt:later(11)},now=Date.parse(later(20));
 const verified=verifyNativePreimage({value:raw,plan,versions,interval,now});
 const sourceBytes=Object.fromEntries(NATIVE_PREIMAGE_SOURCE_PATHS.map(p=>[p,Buffer.from(p.endsWith('delivery-executor-contract.json')?JSON.stringify(plan):'synthetic source '+p)]));
 const sourceDigests=Object.fromEntries(Object.entries(sourceBytes).map(([k,v])=>[k,hash(v)]));
 const contract={controlCommit:'b'.repeat(40),runId:123,jobId:456,workflowId:408045286,runAttempt:1,sourceDigests};
 const archive={schema:'stallorder-delivery-native-preimage-archive/v1',projectId:plan.database.projectId,controlCommit:contract.controlCommit,runId:'123',runAttempt:1,productCommit:plan.productCommit,productTree:plan.productTree,requestStartedAt:later(8),finishedAt:later(12),endpoint:{projectId:plan.database.projectId,hostname:'aws-1-ap-northeast-1.pooler.supabase.com',port:'5432',username:'postgres.'+plan.database.projectId,database:'postgres'},sourceDigests,raw,interval,preimageSha256:verified.preimageSha256,releaseAuthorized:false};
 const events=formatNativePreimageCapture(sealNativePreimage(archive,token),archive);
 const log=events.map(e=>later(13).replace('.000Z','.0000000Z')+' '+JSON.stringify(e)).join('\n');
 const repo={id:1298874780,full_name:'KenLeeYa/Stallorder-Platform',private:false,fork:false};
 const run={id:123,workflow_id:408045286,run_attempt:1,head_sha:contract.controlCommit,head_branch:'main',event:'workflow_dispatch',path:NATIVE_PREIMAGE_SOURCE_PATHS[0],actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},repository:repo,head_repository:repo,status:'completed',conclusion:'success',created_at:at};
 const names=['Require current protected control and identical verified staging tree','Verify bounded evidence and encrypted recovery controls','Reconstruct the exact product without executing it','Authenticate exact functional and complete reviewed security evidence','Record the native PostgreSQL client used for the executor probe','Verify actual Primary migration session privileges without JIT changes',NATIVE_PREIMAGE_CAPTURE_STEP,'Capture only the five current Primary Edge binaries as an authenticated encrypted archive'];
 const job={id:456,run_id:123,run_attempt:1,head_sha:contract.controlCommit,name:'capture',status:'completed',conclusion:'success',labels:['ubuntu-24.04'],runner_id:42,runner_name:'GitHub Actions 42',runner_group_id:0,runner_group_name:'GitHub Actions',started_at:at,completed_at:later(20),steps:names.map((name,i)=>({name,number:i+1,status:'completed',conclusion:'success',started_at:later(i===7?15:i),completed_at:later(i===6?15:i===7?20:i+1)}))};
 return {contract,run,job,sourceBytes,log,now,token,versions,raw};
}
test('authenticates complete native encrypted history and immutable source without release authority',()=>{
 const f=fixture(),out=verifyProtectedNativePreimage(f);assert.deepEqual(out.snapshot,f.raw.snapshot);
 assert.equal(out.evidence.historyVerified,true);assert.equal(out.evidence.releaseAuthorized,false);
});
for(const [name,edit]of[
 ['wrong workflow',f=>f.run.workflow_id++],['rerun',f=>f.run.run_attempt++],['foreign owner',f=>f.run.actor.login='other'],
 ['wrong source',f=>f.sourceBytes[NATIVE_PREIMAGE_SOURCE_PATHS[3]]=Buffer.from('changed')],
 ['job failure',f=>f.job.conclusion='failure'],['skipped step',f=>f.job.steps[4].conclusion='skipped'],
 ['unprotected branch',f=>f.run.head_branch='staging'],['wrong head',f=>f.run.head_sha='e'.repeat(40)],
 ['private fork',f=>f.run.repository={...f.run.repository,fork:true}],['self hosted',f=>f.job.labels=['self-hosted']],
 ['spoofed hosted group',f=>{f.job.runner_group_id=99;f.job.runner_group_name='Untrusted self-hosted group';}],
 ['missing runner identity',f=>delete f.job.runner_id],
 ['expired native state',f=>f.now+=300001],['missing record',f=>f.log=f.log.slice(f.log.indexOf('\n')+1)],
 ['outside step',f=>f.log=f.log.replaceAll('04:00:13','04:00:19')],['malformed JSON',f=>f.log+='\n2026-11-14T04:00:13.0000000Z {"event":"delivery-native-preimage-'],
 ['wrong key',f=>f.token='sbp_'+'d'.repeat(40)],['wrong version list',f=>f.versions[0]='19990101000000'],
])test('native admission rejects '+name,()=>{const f=fixture();edit(f);assert.throws(()=>verifyProtectedNativePreimage(f),{message:'DELIVERY_NATIVE_ADMISSION_REJECTED'});});
function reader(f,mutate) {
 let runs=0;return async path=>{
  if(path==='actions/runs/123'){runs++;return JSON.stringify(mutate&&runs===2?{...f.run,conclusion:'failure'}:f.run);}
  if(path==='actions/jobs/456')return JSON.stringify(f.job);
  if(path==='actions/jobs/456/logs')return f.log;
  const p=path.match(/^contents\/(.+)\?ref=([a-f0-9]{40})$/);assert.ok(p);assert.equal(p[2],f.contract.controlCommit);
  const bytes=f.sourceBytes[p[1]];assert.ok(bytes);return JSON.stringify({path:p[1],type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});
 };
}
test('loader authenticates final metadata readback and only fixed source/run/job paths',async()=>{
 const f=fixture(),out=await loadProtectedNativePreimage({contract:f.contract,token,versions:f.versions,read:reader(f),clock:()=>f.now});
 assert.deepEqual(out.snapshot,f.raw.snapshot);assert.equal(out.evidence.releaseAuthorized,false);
});
test('loader rejects changed final metadata and redacts provider errors',async()=>{
 const f=fixture();await assert.rejects(()=>loadProtectedNativePreimage({contract:f.contract,token,versions:f.versions,read:reader(f,true),clock:()=>f.now}),{message:'DELIVERY_NATIVE_LOAD_FINAL_READBACK'});
 await assert.rejects(()=>loadProtectedNativePreimage({contract:f.contract,token,versions:f.versions,read:()=>{throw new Error('PRIVATE-SOURCE-MARKER');},clock:()=>f.now}),{message:'DELIVERY_NATIVE_LOAD_EXECUTION'});
});
test('loader rechecks native freshness after the final provider readback',async()=>{
 const f=fixture(),times=[f.now,f.now,f.now+300001];
 await assert.rejects(()=>loadProtectedNativePreimage({contract:f.contract,token,versions:f.versions,read:reader(f),clock:()=>times.shift()}),{message:'DELIVERY_NATIVE_LOAD_FINAL_VERIFY'});
});
test('loader rejects a backward clock during final readback',async()=>{
 const f=fixture(),times=[f.now,f.now-1,f.now];
 await assert.rejects(()=>loadProtectedNativePreimage({contract:f.contract,token,versions:f.versions,read:reader(f),clock:()=>times.shift()}),{message:'DELIVERY_NATIVE_LOAD_FINAL_READBACK'});
});
