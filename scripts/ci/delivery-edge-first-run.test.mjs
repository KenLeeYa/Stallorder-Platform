import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyFirstPairedRun, loadFirstPairedRun} from './delivery-edge-first-run.mjs';
function fixture() {
 const repo={full_name:'KenLeeYa/Stallorder-Platform',id:1298874780,private:false,fork:false};
 const run={id:123,workflow_id:456,run_number:1,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',
  event:'workflow_dispatch',path:'.github/workflows/production-delivery-edge-rehearsal.yml',status:'in_progress',conclusion:null,
  actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},repository:repo,head_repository:repo,
  created_at:'2026-11-05T10:00:00Z'};
 return {expectedWorkflowId:456,run,inventory:{total_count:1,workflow_runs:[structuredClone(run)]},now:Date.parse('2026-11-05T10:01:00Z')};
}
test('a new workflow first attempt is bounded evidence, not mutation authorization',()=>{
 const f=fixture(),out=verifyFirstPairedRun(f); assert.equal(out.firstRunVerified,true);
 assert.equal(out.workflowId,456);assert.equal(out.runId,123);assert.equal(out.mutationAuthorized,false);
 assert.equal(out.releaseAuthorized,false);assert.equal(out.reusable,false);
});
for(const [label,change] of [
 ['deleted previous run still consumes run number',f=>{f.run.run_number=2;f.inventory.workflow_runs[0].run_number=2;}],
 ['rerun attempt',f=>{f.run.run_attempt=2;}],
 ['additional queued run',f=>{f.inventory.total_count=2;f.inventory.workflow_runs.push({...f.run,id:124,status:'queued'});}],
 ['truncated inventory',f=>{f.inventory.total_count=2;}],
 ['missing current run',f=>{f.inventory.total_count=0;f.inventory.workflow_runs=[];}],
 ['replaced workflow identity',f=>{f.inventory.workflow_runs[0].workflow_id=457;}],
 ['finished current executor',f=>{f.run.status='completed';f.run.conclusion='success';}],
 ['foreign actor',f=>{f.run.actor.login='someone';}],
 ['foreign workflow',f=>{f.run.path='.github/workflows/other.yml';}],
 ['source mismatch',f=>{f.inventory.workflow_runs[0].head_sha='b'.repeat(40);}],
 ['stale current run',f=>{f.now+=7*3600000;}],
 ['future source',f=>{f.now=Date.parse('2026-11-05T09:59:00Z');}],
])test('first-run gate rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>verifyFirstPairedRun(f));});
test('authenticated loader uses the unfiltered fixed workflow listing and final metadata reread',async()=>{
 const f=fixture(),calls=[];const read=async path=>{calls.push(path);return JSON.stringify(path.includes('/workflows/')?f.inventory:f.run);};
 const out=await loadFirstPairedRun({expectedWorkflowId:f.expectedWorkflowId,run:f.run,read,clock:()=>f.now});
 assert.equal(out.firstRunVerified,true);assert.equal(out.mutationAuthorized,false);
 assert.deepEqual(calls,['actions/workflows/456/runs?per_page=100','actions/runs/123','actions/workflows/456/runs?per_page=100']);
});
test('a new concurrent dispatch during the read invalidates the proof',async()=>{
 const f=fixture();let reads=0;const read=async path=>{
  if(path.includes('/workflows/')&&++reads===2){f.inventory.total_count=2;f.inventory.workflow_runs.push({...f.run,id:124});}
  return JSON.stringify(path.includes('/workflows/')?f.inventory:f.run);
 };
 await assert.rejects(loadFirstPairedRun({expectedWorkflowId:f.expectedWorkflowId,run:f.run,read,clock:()=>f.now}),/^Error: EDGE_FIRST_RUN_REJECTED$/);
});
test('untrusted errors are reduced to a fixed diagnostic',async()=>{
 const f=fixture();await assert.rejects(loadFirstPairedRun({expectedWorkflowId:f.expectedWorkflowId,run:f.run,read:()=>{throw Error('synthetic private detail');},clock:()=>f.now}),
 /^Error: EDGE_FIRST_RUN_REJECTED$/);
});

test('a replaced workflow cannot self-attest a new first run identity',async()=>{
 const f=fixture();f.run.workflow_id=888;f.inventory.workflow_runs[0].workflow_id=888;
 const read=async p=>JSON.stringify(p.includes('/workflows/')?f.inventory:f.run);
 await assert.rejects(loadFirstPairedRun({expectedWorkflowId:456,run:f.run,read,clock:()=>f.now}),/^Error: EDGE_FIRST_RUN_REJECTED$/);
});
test('the installer-pinned workflow identity is mandatory',()=>{
 const f=fixture();delete f.expectedWorkflowId;assert.throws(()=>verifyFirstPairedRun(f));
});
