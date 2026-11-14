import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {githubReadArguments} from './delivery-admission.mjs';
import {NATIVE_PREIMAGE_SOURCE_PATHS} from './delivery-database-preimage.capture.mjs';
import {readNativePreimageEvents} from './delivery-database-preimage.archive.mjs';
import {verifyNativePreimage} from './delivery-database-preimage.mjs';

const repository='KenLeeYa/Stallorder-Platform',workflowId=408045286;
export const NATIVE_PREIMAGE_CAPTURE_STEP='Capture the complete native Primary preimage as an authenticated encrypted archive';
const required=['Require current protected control and identical verified staging tree',
 'Verify bounded evidence and encrypted recovery controls','Reconstruct the exact product without executing it',
 'Authenticate exact functional and complete reviewed security evidence','Record the native PostgreSQL client used for the executor probe',
 'Verify actual Primary migration session privileges without JIT changes',NATIVE_PREIMAGE_CAPTURE_STEP,
 'Capture only the five current Primary Edge binaries as an authenticated encrypted archive'];
const hash=b=>createHash('sha256').update(b).digest('hex');
function instant(s) {
 assert.match(s??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
 const n=Date.parse(s);assert.ok(Number.isSafeInteger(n));assert.equal(new Date(n).toISOString(),s.includes('.')?s:s.replace('Z','.000Z'));return n;
}
function validateContract(c) {
 assert.match(c.controlCommit??'',/^[a-f0-9]{40}$/);assert.equal(c.workflowId,workflowId);assert.equal(c.runAttempt,1);
 for(const k of ['runId','jobId'])assert.ok(Number.isSafeInteger(c[k])&&c[k]>0);
 assert.deepEqual(Object.keys(c.sourceDigests).sort(),[...NATIVE_PREIMAGE_SOURCE_PATHS].sort());
 for(const v of Object.values(c.sourceDigests))assert.match(v??'',/^[a-f0-9]{64}$/);
}
function verify({contract:c,run:r,job:j,sourceBytes,log,now,token,versions}) {
 validateContract(c);assert.ok(Number.isSafeInteger(now));
 assert.deepEqual(Object.keys(sourceBytes).sort(),[...NATIVE_PREIMAGE_SOURCE_PATHS].sort());
 for(const path of NATIVE_PREIMAGE_SOURCE_PATHS) {
  const b=sourceBytes[path];assert.ok(Buffer.isBuffer(b)&&b.length>0&&b.length<=1024*1024);assert.equal(hash(b),c.sourceDigests[path]);
 }
 const plan=JSON.parse(sourceBytes['scripts/ci/delivery-executor-contract.json'].toString('utf8'));
 assert.equal(plan.database.executor.authentication,'database-password');
 for(const repo of [r.repository,r.head_repository]) {
  assert.equal(repo.id,1298874780);assert.equal(repo.full_name,repository);assert.equal(repo.private,false);assert.equal(repo.fork,false);
 }
 assert.equal(r.id,c.runId);assert.equal(r.workflow_id,workflowId);assert.equal(r.run_attempt,1);assert.equal(r.head_sha,c.controlCommit);
 assert.equal(r.head_branch,'main');assert.equal(r.event,'workflow_dispatch');assert.equal(r.path,NATIVE_PREIMAGE_SOURCE_PATHS[0]);
 assert.equal(r.actor.login,'KenLeeYa');assert.equal(r.triggering_actor.login,'KenLeeYa');assert.equal(r.status,'completed');assert.equal(r.conclusion,'success');
 assert.equal(j.id,c.jobId);assert.equal(j.run_id,r.id);assert.equal(j.run_attempt,1);assert.equal(j.head_sha,r.head_sha);
 assert.equal(j.name,'capture');assert.equal(j.status,'completed');assert.equal(j.conclusion,'success');
 assert.deepEqual(j.labels,['ubuntu-24.04']);assert.match(j.runner_name??'',/^GitHub Actions \d+$/);
 assert.equal(j.runner_group_name,'GitHub Actions');assert.equal(j.runner_group_id,0);
 assert.ok(Number.isSafeInteger(j.runner_id)&&j.runner_id>0);
 const created=instant(r.created_at),start=instant(j.started_at),end=instant(j.completed_at);
 assert.ok(created<=start&&start<=end&&end<=now&&now-created<=6*3600000);
 assert.ok(Array.isArray(j.steps)&&j.steps.length>0&&j.steps.length<=100);
 assert.equal(new Set(j.steps.map(s=>s.name)).size,j.steps.length);
 let prior=0,lastEnd=start;
 for(const s of j.steps) {
  assert.ok(Number.isSafeInteger(s.number)&&s.number>prior);prior=s.number;
  assert.equal(s.status,'completed');assert.equal(s.conclusion,'success');
  const began=instant(s.started_at),finished=instant(s.completed_at);assert.ok(lastEnd<=began&&began<=finished&&finished<=end);lastEnd=finished;
 }
 prior=0;for(const name of required){const s=j.steps.find(s=>s.name===name);assert.ok(s&&s.number>prior);prior=s.number;}
 const step=j.steps.find(s=>s.name===NATIVE_PREIMAGE_CAPTURE_STEP),stepStart=instant(step.started_at),stepEnd=instant(step.completed_at);
 assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=192*1024*1024);
 const events=[],printed=[];
 for(const line of log.split(/\r?\n/)) {
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (.*)$/.exec(line);if(!match)continue;
  const payload=match[2].trimStart();if(!payload.startsWith('{'))continue;
  const value=JSON.parse(payload);if(typeof value.event!=='string'||!value.event.startsWith('delivery-native-preimage-'))continue;
  const time=instant(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
  assert.ok(stepStart<=time&&time<stepEnd+1000&&time<=now&&(printed.length===0||printed.at(-1)<=time));
  printed.push(time);events.push(value);
 }
 const archive=readNativePreimageEvents(events,token);
 assert.equal(archive.controlCommit,c.controlCommit);assert.equal(archive.runId,String(c.runId));assert.equal(archive.runAttempt,1);
 assert.ok(isDeepStrictEqual(archive.sourceDigests,c.sourceDigests));
 assert.equal(archive.productCommit,plan.productCommit);assert.equal(archive.productTree,plan.productTree);
 assert.ok(stepStart<=instant(archive.requestStartedAt)&&instant(archive.finishedAt)<stepEnd+1000&&instant(archive.finishedAt)<=printed[0]);
 const verified=verifyNativePreimage({value:archive.raw,plan,versions,interval:archive.interval,now});
 assert.equal(verified.preimageSha256,archive.preimageSha256);
 return {snapshot:verified.snapshot,endpoint:archive.endpoint,raw:archive.raw,evidence:{
  schema:'stallorder-protected-native-preimage-admission/v1',controlCommit:r.head_sha,runId:r.id,jobId:j.id,workflowId,runAttempt:1,
  projectId:archive.projectId,productCommit:archive.productCommit,productTree:archive.productTree,authentication:'database-password',
  sourceDigests:{...c.sourceDigests},logSha256:hash(log),archiveSha256:events[0].sha256,preimageSha256:verified.preimageSha256,
  observedAt:verified.observedAt,requestStartedAt:archive.requestStartedAt,finishedAt:archive.finishedAt,historyVerified:true,releaseAuthorized:false}};
}
// The protected caller must bind contract digests and versions to its reviewed
// immutable control/product. This pure verifier authenticates no network input.
export function verifyProtectedNativePreimage(input) {
 try{return verify(input);}catch{throw new Error('DELIVERY_NATIVE_ADMISSION_REJECTED');}
}
const github=path=>execFileSync('gh',githubReadArguments(path),{encoding:'utf8',maxBuffer:192*1024*1024,timeout:60000,windowsHide:true,stdio:['ignore','pipe','pipe']});
export async function loadProtectedNativePreimage({contract,token,versions,read=github,clock=Date.now}) {
 let stage='CONTRACT';
 try {
  validateContract(contract);
  const json=async path=>{const s=await read(path);assert.ok(typeof s==='string'&&Buffer.byteLength(s)<=2*1024*1024);return JSON.parse(s);};
  stage='EXECUTION';const runPath=`actions/runs/${contract.runId}`,jobPath=`actions/jobs/${contract.jobId}`;
  const run=await json(runPath),job=await json(jobPath);
  stage='SOURCE';const sourceBytes={};
  for(const path of NATIVE_PREIMAGE_SOURCE_PATHS) {
   const f=await json(`contents/${path}?ref=${contract.controlCommit}`);
   assert.equal(f.path,path);assert.equal(f.type,'file');assert.equal(f.encoding,'base64');assert.equal(typeof f.content,'string');
   const encoded=f.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,f.size);sourceBytes[path]=bytes;
  }
  stage='LOG';const log=await read(`${jobPath}/logs`);
  stage='VERIFY';const verifiedAt=clock();verifyProtectedNativePreimage({contract,run,job,sourceBytes,log,now:verifiedAt,token,versions});
  stage='FINAL_READBACK';const observedAt=clock(),finalRun=await json(runPath),finalJob=await json(jobPath);
  assert.ok(isDeepStrictEqual(finalRun,run)&&isDeepStrictEqual(finalJob,job));
  const now=clock();assert.ok(Number.isSafeInteger(observedAt)&&verifiedAt<=observedAt&&observedAt<=now);
  stage='FINAL_VERIFY';const result=verifyProtectedNativePreimage({contract,run:finalRun,job:finalJob,sourceBytes,log,now,token,versions});
  return {...result,evidence:{...result.evidence,providerReadbackStartedAt:new Date(observedAt).toISOString(),providerReadbackFinishedAt:new Date(now).toISOString()}};
 }catch{throw new Error('DELIVERY_NATIVE_LOAD_'+stage);}
}
