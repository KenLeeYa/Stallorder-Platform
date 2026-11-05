import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';
const workflow='.github/workflows/production-delivery-edge-rehearsal.yml';
const identity=run=>Object.fromEntries(['id','workflow_id','run_number','run_attempt','head_sha','head_branch',
 'event','path','status','conclusion','actor','triggering_actor','repository','head_repository','created_at'].map(k=>[k,run[k]]));
// This is a deliberately one-use acceptance entry, not a reusable journal.
// A failed or deleted prior run consumes it. No reset, new workflow name, or
// amended run number is an accepted way to retry an uncertain provider write.
export function verifyFirstPairedRun({expectedWorkflowId,run,inventory,now}) {
 assert.ok(Number.isSafeInteger(expectedWorkflowId)&&expectedWorkflowId>0);
 for(const key of ['id','workflow_id'])assert.ok(Number.isSafeInteger(run[key])&&run[key]>0);
 assert.equal(run.workflow_id,expectedWorkflowId);
 assert.equal(run.run_number,1);assert.equal(run.run_attempt,1);
 assert.match(run.head_sha??'',/^[a-f0-9]{40}$/);assert.equal(run.head_branch,'main');
 assert.equal(run.path,workflow);assert.equal(run.event,'workflow_dispatch');
 assert.equal(run.status,'in_progress');assert.equal(run.conclusion,null);
 for(const key of ['actor','triggering_actor'])assert.equal(run[key]?.login,'KenLeeYa');
 for(const repo of [run.repository,run.head_repository]) {
  assert.equal(repo?.full_name,'KenLeeYa/Stallorder-Platform');assert.equal(repo.id,1298874780);
  assert.equal(repo.private,false);assert.equal(repo.fork,false);
 }
 assert.match(run.created_at??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
 const started=Date.parse(run.created_at);assert.equal(new Date(started).toISOString(),run.created_at.replace('Z','.000Z'));
 assert.ok(Number.isFinite(now)&&started<=now&&now-started<=6*3600000);
 assert.equal(inventory.total_count,1);assert.ok(Array.isArray(inventory.workflow_runs));
 assert.equal(inventory.workflow_runs.length,1);assert.deepEqual(identity(inventory.workflow_runs[0]),identity(run));
 return {schema:'stallorder-paired-first-run/v1',firstRunVerified:true,workflowId:run.workflow_id,runId:run.id,
  runNumber:1,runAttempt:1,reusable:false,mutationAuthorized:false,releaseAuthorized:false};
}
function github(path) {
 return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,
  stdio:['ignore','pipe','pipe']});
}
// expectedWorkflowId must come from the reviewed immutable installation contract,
// never from the current run being admitted. The protected caller still authenticates
// source, actual executor, completed
// per-phase intent and the shared Preview writer lock before any PATCH.
export async function loadFirstPairedRun({expectedWorkflowId,run,read=github,clock=Date.now}) {
 try {
  run=structuredClone(run);
  assert.ok(Number.isSafeInteger(expectedWorkflowId)&&expectedWorkflowId>0);
  assert.equal(run.workflow_id,expectedWorkflowId);
  for(const key of ['id','workflow_id'])assert.ok(Number.isSafeInteger(run[key])&&run[key]>0);
  const json=async path=>{const bytes=await read(path);assert.ok(typeof bytes==='string'&&Buffer.byteLength(bytes)<=2*1024*1024);return JSON.parse(bytes);};
  const path='actions/workflows/'+run.workflow_id+'/runs?per_page=100';
  const inventory=await json(path),firstNow=clock();verifyFirstPairedRun({expectedWorkflowId,run,inventory,now:firstNow});
  const observedAt=clock(),finalRun=await json('actions/runs/'+run.id),finalInventory=await json(path);
  assert.deepEqual(identity(finalRun),identity(run));const now=clock();assert.ok(firstNow<=observedAt&&observedAt<=now);
  return {...verifyFirstPairedRun({expectedWorkflowId,run:finalRun,inventory:finalInventory,now}),
   observedAt:new Date(observedAt).toISOString(),readFinishedAt:new Date(now).toISOString()};
 } catch {throw new Error('EDGE_FIRST_RUN_REJECTED');}
}
