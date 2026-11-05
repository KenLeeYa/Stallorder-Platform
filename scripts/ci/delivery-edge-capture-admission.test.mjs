import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS,sealEdgeArchive} from './delivery-edge-recovery.mjs';
import {formatArchiveCapture} from './delivery-edge-recovery.capture.mjs';
import {verifyProtectedEdgeCapture} from './delivery-edge-capture-admission.mjs';
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
test('authenticates protected exact-source archive without granting restore or release',()=>{const x=fixture(),out=verifyProtectedEdgeCapture(x);assert.equal(out.archive.functions.length,5);assert.equal(out.evidence.releaseAuthorized,false);assert.equal(out.evidence.restoreVerified,false);assert.equal(out.evidence.controlCommit,controlCommit);assert.ok(!JSON.stringify(out.evidence).includes('wireBase64'));});
for(const [name,change]of [
 ['prerequisite completes after archive',x=>x.job.steps[0].completed_at='2026-11-04T23:00:02Z'],
 ['archive completion follows its published header',x=>x.log=x.log.replace('23:00:01.1000000Z','23:00:00.5000000Z')],
 ['decreasing chunk print times',x=>{const rows=x.log.split('\n');rows[1]=rows[1].replace('23:00:01.1000000Z','23:00:01.0000000Z');x.log=rows.join('\n');}],
 ['log event in future within coarse step second',x=>{x.now=Date.parse('2026-11-04T23:00:02Z');x.job.completed_at='2026-11-04T23:00:02Z';x.log=x.log.replaceAll('23:00:01.1000000Z','23:00:02.6000000Z');}],
 ['foreign repository',x=>x.run.repository={...x.run.repository,id:99}],['fork',x=>x.run.head_repository={...x.run.head_repository,fork:true}],
 ['unprotected branch',x=>x.run.head_branch='staging'],['foreign actor',x=>x.run.actor.login='other'],['foreign triggering actor',x=>x.run.triggering_actor.login='other'],
 ['wrong event',x=>x.run.event='push'],['wrong workflow path',x=>x.run.path='other'],['workflow identity',x=>x.run.workflow_id=301],['job identity',x=>x.job.id=201],
 ['rerun',x=>x.run.run_attempt=2],['wrong source',x=>x.run.head_sha='b'.repeat(40)],['incomplete',x=>x.job.status='in_progress'],['failed',x=>x.run.conclusion='failure'],
 ['self-hosted',x=>x.job.runner_name='my-host'],['wrong runner image',x=>x.job.labels=['ubuntu-latest']],['skipped preflight',x=>x.job.steps[0].conclusion='skipped'],
 ['missing source gate',x=>x.job.steps.shift()],['reordered steps',x=>x.job.steps.reverse()],['workflow bytes',x=>x.workflowBytes=Buffer.from('tampered')],['capture bytes',x=>x.captureBytes=Buffer.from('tampered')],['recovery bytes',x=>x.recoveryBytes=Buffer.from('tampered')],
 ['stale run',x=>x.now+=7*3600000],['future run',x=>x.now-=3600000],['missing completion',x=>x.log=x.log.split('\n').slice(0,-1).join('\n')],
 ['duplicate capture',x=>x.log=x.log.split('\n')[0]+'\n'+x.log],['duplicate chunk',x=>x.log=x.log+'\n'+x.log.split('\n')[1]],['tampered ciphertext',x=>x.log=x.log.replace(/"data":"./,'"data":"!')],
 ['foreign envelope source',x=>x.log=x.log.replace('"controlCommit":"'+controlCommit+'"','"controlCommit":"'+'b'.repeat(40)+'"')],
 ['foreign envelope run',x=>x.log=x.log.replace('"runId":"100"','"runId":"101"')],['envelope timestamp drift',x=>x.log=x.log.replace('2026-11-04T23:00:00.000Z','2026-11-04T22:58:00.000Z')],
 ['record outside capture step',x=>x.log=x.log.replaceAll('23:00:01.1000000Z','22:58:01.1000000Z')],['wrong decryption key',x=>x.token='sbp_'+'b'.repeat(40)],
])test('rejects '+name,()=>{const x=fixture();change(x);assert.throws(()=>verifyProtectedEdgeCapture(x));});
