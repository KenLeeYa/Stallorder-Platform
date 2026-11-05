import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openEdgeArchive} from './delivery-edge-recovery.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const repository='KenLeeYa/Stallorder-Platform',project='eyuctbnlvnbnivwasvqr';
const captureStep='Capture only the five current Primary Edge binaries as an authenticated encrypted archive';
const required=[
 'Require current protected control and identical verified staging tree',
 'Verify bounded evidence and encrypted recovery controls',
 'Reconstruct the exact product without executing it',
 'Authenticate exact functional and complete reviewed security evidence',
 'Verify actual Primary migration session privileges without JIT changes',captureStep,
];
function instant(value){
 assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
 const at=Date.parse(value);assert.ok(Number.isFinite(at));
 assert.equal(new Date(at).toISOString(),value.includes('.')?value:value.replace('Z','.000Z'));return at;
}
// The protected caller supplies the immutable reviewed contract. Run/job/source
// bytes must be read from the fixed GitHub API, with unchanged final readback.
// No transport, file writes, restoration or release authorization is performed.
export function verifyProtectedEdgeCapture({contract,run,job,workflowBytes,captureBytes,recoveryBytes,log,now,token}){
 assert.match(contract.controlCommit??'',/^[a-f0-9]{40}$/);
 for(const name of ['runId','jobId','workflowId','runAttempt'])assert.ok(Number.isSafeInteger(contract[name])&&contract[name]>0);
 for(const [name,bytes]of [['workflowSha256',workflowBytes],['captureSha256',captureBytes],['recoverySha256',recoveryBytes]]){assert.match(contract[name]??'',/^[a-f0-9]{64}$/);assert.equal(hash(bytes),contract[name]);}
 for(const repo of [run.repository,run.head_repository]){assert.equal(repo?.full_name,repository);assert.equal(repo.id,1298874780);assert.equal(repo.private,false);assert.equal(repo.fork,false);}
 assert.equal(run.id,contract.runId);assert.equal(run.workflow_id,contract.workflowId);assert.equal(run.run_attempt,contract.runAttempt);
 assert.equal(run.head_sha,contract.controlCommit);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
 assert.equal(run.path,'.github/workflows/production-delivery-evidence.yml');assert.equal(run.actor?.login,'KenLeeYa');assert.equal(run.triggering_actor?.login,'KenLeeYa');
 assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 assert.equal(job.id,contract.jobId);assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,run.run_attempt);assert.equal(job.head_sha,run.head_sha);
 assert.equal(job.name,'capture');assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
 assert.deepEqual(job.labels,['ubuntu-24.04']);assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
 const created=instant(run.created_at),start=instant(job.started_at),end=instant(job.completed_at);
 assert.ok(Number.isFinite(now)&&created<=start&&start<=end&&end<=now&&now-created<=6*3600000);
 assert.ok(Array.isArray(job.steps)&&new Set(job.steps.map(s=>s.name)).size===job.steps.length);
 let prior=0;
 for(const name of required){const step=job.steps.find(s=>s.name===name);assert.ok(step&&Number.isSafeInteger(step.number)&&step.number>prior);prior=step.number;assert.equal(step.status,'completed');assert.equal(step.conclusion,'success');}
 let previousStep=0,previousEnd=start;
 for(const step of job.steps){assert.ok(Number.isSafeInteger(step.number)&&step.number>previousStep);previousStep=step.number;assert.equal(step.status,'completed');assert.equal(step.conclusion,'success');const began=instant(step.started_at),finished=instant(step.completed_at);assert.ok(previousEnd<=began&&began<=finished&&finished<=end);previousEnd=finished;}
 const step=job.steps.find(s=>s.name===captureStep),stepStart=instant(step.started_at),stepEnd=instant(step.completed_at);
 assert.ok(start<=stepStart&&stepStart<=stepEnd&&stepEnd<=end);
 assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=192*1024*1024);
 const events=[],printedTimes=[];
 for(const line of log.split(/\r?\n/)){
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*)$/.exec(line);if(!match)continue;
  let value;try{value=JSON.parse(match[2]);}catch{assert.ok(!match[2].includes('edge-recovery-'));continue;}
  if(typeof value?.event!=='string'||!value.event.startsWith('edge-recovery-'))continue;
  const printed=instant(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
  assert.ok(stepStart<=printed&&printed<stepEnd+1000&&printed<=now&&(printedTimes.length===0||printedTimes.at(-1)<=printed));printedTimes.push(printed);events.push(value);
 }
 assert.ok(events.length>=3);const header=events[0],complete=events.at(-1);
 assert.equal(header.event,'edge-recovery-capture');assert.equal(header.schema,'stallorder-edge-encrypted-capture/v1');
 assert.equal(header.project,project);assert.equal(header.controlCommit,contract.controlCommit);assert.equal(header.runId,String(run.id));assert.equal(header.runAttempt,run.run_attempt);
 assert.equal(header.releaseAuthorized,false);assert.equal(header.restoreVerified,false);assert.match(header.sha256??'',/^[a-f0-9]{64}$/);
 assert.ok(Number.isSafeInteger(header.bytes)&&header.bytes>0&&header.bytes<=160*1024*1024);
 assert.ok(Number.isSafeInteger(header.chunks)&&header.chunks>0&&header.chunks<=20000);assert.equal(events.length,header.chunks+2);
 assert.equal(complete.event,'edge-recovery-complete');assert.equal(complete.sha256,header.sha256);assert.equal(complete.chunks,header.chunks);
 const data=[];
 for(let i=0;i<header.chunks;i++){const chunk=events[i+1];assert.equal(chunk.event,'edge-recovery-chunk');assert.equal(chunk.sha256,header.sha256);assert.equal(chunk.index,i);
  assert.equal(typeof chunk.data,'string');assert.ok(chunk.data.length>0&&chunk.data.length<=12000);assert.match(chunk.data,/^[A-Za-z0-9+/]+={0,2}$/);if(i<header.chunks-1)assert.equal(chunk.data.length,12000);data.push(chunk.data);}
 const encoded=data.join(''),bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,header.bytes);assert.equal(hash(bytes),header.sha256);
 const archive=openEdgeArchive(JSON.parse(bytes.toString('utf8')),token);
 assert.equal(archive.project,header.project);assert.equal(archive.startedAt,header.startedAt);assert.equal(archive.finishedAt,header.finishedAt);
 assert.ok(stepStart<=instant(archive.startedAt)&&instant(archive.finishedAt)<stepEnd+1000&&instant(archive.finishedAt)<=printedTimes[0]&&instant(archive.finishedAt)<=now);
 assert.deepEqual(archive.functions.map(f=>({slug:f.slug,id:f.metadata.id,version:f.metadata.version,sha256:f.wireSha256})),header.functions);
 return {archive,evidence:{schema:'stallorder-protected-edge-capture-admission/v1',controlCommit:run.head_sha,runId:run.id,runAttempt:run.run_attempt,jobId:job.id,
  workflowSha256:contract.workflowSha256,captureSha256:contract.captureSha256,recoverySha256:contract.recoverySha256,logSha256:hash(log),archiveSha256:header.sha256,
  project,startedAt:archive.startedAt,finishedAt:archive.finishedAt,functions:header.functions,releaseAuthorized:false,restoreVerified:false}};
}
