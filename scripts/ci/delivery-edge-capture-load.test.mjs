import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS,sealEdgeArchive} from './delivery-edge-recovery.mjs';
import {formatArchiveCapture} from './delivery-edge-recovery.capture.mjs';
import {loadProtectedEdgeCapture} from './delivery-edge-capture-load.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const token='sbp_'+'a'.repeat(40),controlCommit='a'.repeat(40);
function fixture(){
 const workflowBytes=Buffer.from('reviewed protected workflow'),captureBytes=Buffer.from('reviewed capture'),recoveryBytes=Buffer.from('reviewed recovery');
 const contract={controlCommit,runId:100,runAttempt:1,jobId:200,workflowId:300,workflowSha256:hash(workflowBytes),captureSha256:hash(captureBytes),recoverySha256:hash(recoveryBytes)};
 const at='2026-11-04T23:00:00.000Z',end='2026-11-04T23:00:01.000Z';
 const archive={schema:'stallorder-delivery-edge-recovery/v1',project:'eyuctbnlvnbnivwasvqr',startedAt:at,finishedAt:end,functions:EDGE_SLUGS.map((slug,i)=>{const body=Buffer.from('EZBRsynthetic-'+slug),sha256=hash(body);return{slug,metadata:{id:'12345678-1234-1234-1234-12345678900'+i,slug,status:'ACTIVE',version:1,verify_jwt:false,entrypoint_path:'file:///source/'+slug+'/index.ts',import_map_path:'file:///source/deno.json',sha256},wireSha256:sha256,wireBase64:body.toString('base64')};}),releaseAuthorized:false,restoreVerified:false};
 const summary={project:archive.project,startedAt:at,finishedAt:end,functions:archive.functions.map(f=>({slug:f.slug,id:f.metadata.id,version:f.metadata.version,sha256:f.wireSha256}))};
 const events=formatArchiveCapture({sealed:sealEdgeArchive(archive,token),provenance:{controlCommit,runId:'100',runAttempt:1},summary});
 const repo={full_name:'KenLeeYa/Stallorder-Platform',id:1298874780,private:false,fork:false};
 const run={id:100,workflow_id:300,run_attempt:1,head_sha:controlCommit,head_branch:'main',path:'.github/workflows/production-delivery-evidence.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',repository:repo,head_repository:repo,actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},created_at:'2026-11-04T22:59:00Z'};
 const names=['Require current protected control and identical verified staging tree','Verify bounded evidence and encrypted recovery controls','Reconstruct the exact product without executing it','Authenticate exact functional and complete reviewed security evidence','Verify actual Primary migration session privileges without JIT changes','Capture only the five current Primary Edge binaries as an authenticated encrypted archive'];
 const job={id:200,run_id:100,run_attempt:1,head_sha:controlCommit,name:'capture',status:'completed',conclusion:'success',labels:['ubuntu-24.04'],runner_name:'GitHub Actions 1',started_at:'2026-11-04T22:59:01Z',completed_at:'2026-11-04T23:00:03Z',steps:names.map((name,i)=>({name,number:i+1,status:'completed',conclusion:'success',started_at:i===5?'2026-11-04T23:00:00Z':'2026-11-04T22:59:0'+(i+1)+'Z',completed_at:i===5?'2026-11-04T23:00:02Z':'2026-11-04T22:59:0'+(i+2)+'Z'}))};
 const log=events.map(e=>'2026-11-04T23:00:01.1000000Z '+JSON.stringify(e)).join('\n');
 return {contract,run,job,workflowBytes,captureBytes,recoveryBytes,log,now:Date.parse('2026-11-04T23:01:00Z'),token};
}

function reader(x, change=()=>{}) {
 const calls=[], counts={};
 return {calls,read:async path=>{
  calls.push(path);counts[path]=(counts[path]??0)+1;
  let value;
  if(path==='actions/runs/100')value=structuredClone(x.run);
  else if(path==='actions/jobs/200')value=structuredClone(x.job);
  else if(path==='actions/jobs/200/logs')return x.log;
  else {
   const p=path.slice('contents/'.length).split('?ref=')[0];
   const bytes=p.endsWith('.yml')?x.workflowBytes:p.endsWith('.capture.mjs')?x.captureBytes:x.recoveryBytes;
   value={type:'file',path:p,encoding:'base64',size:bytes.length,content:bytes.toString('base64')+'\n'};
  }
  change(value,path,counts[path]);return JSON.stringify(value);
 }};
}
test('fetches only fixed immutable sources and rechecks the full run and job before returning',async()=>{
 const x=fixture(),r=reader(x),out=await loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now});
 assert.equal(r.calls.length,8);assert.deepEqual(r.calls.slice(-2),['actions/runs/100','actions/jobs/200']);
 assert.equal(r.calls.filter(p=>p.startsWith('contents/')).length,3);
 assert.equal(out.archive.functions.length,5);assert.equal(out.evidence.releaseAuthorized,false);assert.equal(out.evidence.restoreVerified,false);
 assert.ok(!JSON.stringify(out.evidence).includes('wireBase64'));
 assert.equal(out.evidence.observedAt,new Date(x.now).toISOString());
});
for(const key of ['controlCommit','runId','jobId','workflowId','runAttempt'])test('rejects malformed contract before network: '+key,async()=>{
 const x=fixture(),r=reader(x);x.contract[key]='../other';
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read}),/EDGE_CAPTURE_LOAD_CONTRACT/);assert.equal(r.calls.length,0);
});
for(const key of ['run_attempt','head_sha','conclusion','path','triggering_actor'])test('rejects final run drift: '+key,async()=>{
 const x=fixture(),r=reader(x,(v,p,n)=>{if(p==='actions/runs/100'&&n===2)v[key]='changed';});
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now}),/EDGE_CAPTURE_LOAD_FINAL_READBACK/);
});
test('rejects final step evidence drift even when run identity is unchanged',async()=>{
 const x=fixture(),r=reader(x,(v,p,n)=>{if(p==='actions/jobs/200'&&n===2)v.steps[0].conclusion='skipped';});
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now}),/EDGE_CAPTURE_LOAD_FINAL_READBACK/);
});
for(const key of ['path','type','encoding','content','size'])test('rejects substituted source response: '+key,async()=>{
 const x=fixture(),r=reader(x,(v,p)=>{if(p.startsWith('contents/'))v[key]=key==='size'?999:'substituted';});
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now}),/EDGE_CAPTURE_LOAD_SOURCE/);
});
test('rejects validly encoded but unreviewed source',async()=>{
 const x=fixture(),r=reader(x);x.captureBytes=Buffer.from('different');
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now}),/EDGE_CAPTURE_LOAD_VERIFY/);
});
test('revalidates freshness after final readback',async()=>{
 const x=fixture(),r=reader(x);let count=0;
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now+(count++===2?7*3600000:0)}),/EDGE_CAPTURE_LOAD_FINAL_VERIFY/);
});
test('rejects clock rollback across initial and final verification',async()=>{
 const x=fixture(),r=reader(x);let count=0;
 await assert.rejects(loadProtectedEdgeCapture({...x,read:r.read,clock:()=>x.now-(count++>0?1000:0)}),/EDGE_CAPTURE_LOAD_FINAL_READBACK/);
});
test('does not leak upstream credentials, signed URLs or malformed provider bytes',async()=>{
 const x=fixture(),marker='private-synthetic-source';
 for(const read of [async()=>{throw new Error(marker);},async()=>marker]){
  await assert.rejects(loadProtectedEdgeCapture({...x,read,clock:()=>x.now}),e=>e.message==='EDGE_CAPTURE_LOAD_EXECUTION'&&!JSON.stringify(e).includes(marker));
 }
});
