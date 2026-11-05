import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {validatePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {inspectInterruptedPairedRecovery} from './delivery-edge-rehearsal.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const integer=value=>assert.ok(Number.isSafeInteger(value)&&value>0);
function freshHistory(history,now) {
  assert.ok(Number.isFinite(now));
  const values=['observedAt','readFinishedAt'].map(key=>{
    assert.match(history[key]??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const value=Date.parse(history[key]);assert.ok(Number.isFinite(value));
    assert.equal(new Date(value).toISOString(),history[key]);return value;
  });
  assert.ok(values[0]<=values[1]&&values[1]<=now&&now-values[1]<=60000);
}
function lineage(snapshot,snapshotSha256,journal,history) {
  validatePairedSnapshot(snapshot);assert.equal(snapshot.runAttempt,1);
  assert.match(snapshotSha256??'',/^[a-f0-9]{64}$/);
  assert.equal(journal.schema,'stallorder-paired-interrupted-journal/v1');
  assert.equal(journal.originVerified,true);assert.equal(journal.requiresRecoveryHistory,true);
  assert.equal(journal.controlCommit,snapshot.controlCommit);assert.equal(journal.runId,snapshot.runId);
  assert.equal(journal.runAttempt,1);assert.equal(journal.snapshotSha256,snapshotSha256);
  assert.equal(history.schema,'stallorder-paired-recovery-history/v1');
  assert.equal(history.originVerified,true);assert.equal(history.historyVerified,true);
  assert.equal(history.controlCommit,snapshot.controlCommit);assert.equal(history.originalRunId,Number(snapshot.runId));
  assert.equal(history.snapshotSha256,snapshotSha256);assert.match(history.historySha256??'',/^[a-f0-9]{64}$/);
  for(const key of ['originalWorkflowId','recoveryWorkflowId','originalRunId','currentRunId','currentJobId'])integer(history[key]);
  assert.notEqual(history.originalRunId,history.currentRunId);assert.notEqual(history.originalWorkflowId,history.recoveryWorkflowId);
  assert.ok(['restore-intent','restore','verify'].includes(history.phase));
  for(const value of [journal,history])for(const key of ['mutationAuthorized','cleanupVerified','productQualified','releaseAuthorized'])assert.equal(value[key],false);
  for(const phase of ['replay','restore']) {
    const p=journal.phases[phase];integer(p.jobId);
    assert.equal(typeof p.mayHaveWritten,'boolean');assert.equal(typeof p.complete,'boolean');
    assert.ok(Array.isArray(p.started)&&Array.isArray(p.verified));
    assert.deepEqual(p.started,EDGE_SLUGS.slice(0,p.started.length));
    assert.deepEqual(p.verified,p.started.slice(0,p.verified.length));
    assert.ok(p.started.length<=5&&p.verified.length<=p.started.length);
    if(p.mayHaveWritten)assert.match(p.logSha256??'',/^[a-f0-9]{64}$/);
    else {assert.deepEqual(p.started,[]);assert.deepEqual(p.verified,[]);assert.equal(p.complete,false);}
    if(p.complete)assert.deepEqual(p.verified,EDGE_SLUGS);
  }
  if(journal.phases.restore.mayHaveWritten)assert.equal(journal.phases.replay.complete,true);
}
async function inspect(snapshot,records) {
  return inspectInterruptedPairedRecovery({snapshot,read:async({slug})=>records.find(r=>r.slug===slug)});
}
// Recovery requires the authenticated original journal and fresh independently
// pinned recovery history. A possible earlier PATCH is never retried. Unknown
// v0 after an executed replay, or v1 after an executed restore, stays unresolved.
// This pure plan cannot authenticate its caller or authorize a provider write.
export async function planInterruptedEdgeRecovery({snapshot,snapshotSha256,journal,history,read,clock=Date.now}) {
  try {
    snapshot=structuredClone(snapshot);journal=structuredClone(journal);history=structuredClone(history);
    lineage(snapshot,snapshotSha256,journal,history);freshHistory(history,clock());assert.equal(typeof read,'function');
    const records=[];
    for(const slug of EDGE_SLUGS)records.push(structuredClone(await read({project:snapshot.project,slug})));
    const classification=await inspect(snapshot,records),untouched=[],restored=[],eligible=[];
    for(const slug of EDGE_SLUGS) {
      const current=records.find(r=>r.slug===slug),before=snapshot.functions.find(r=>r.slug===slug);
      assert.ok(current);
      if(current.metadata.version===before.metadata.version) {
        assert.equal(journal.phases.replay.mayHaveWritten,false);assert.deepEqual(current,before);untouched.push(slug);
      } else if(classification.candidates.some(r=>r.slug===slug)) {
        assert.equal(journal.phases.replay.mayHaveWritten,true);
        assert.equal(journal.phases.restore.mayHaveWritten,false);eligible.push(slug);
      } else {
        assert.ok(classification.restored.includes(slug));assert.equal(journal.phases.restore.mayHaveWritten,true);restored.push(slug);
      }
    }
    const base=buildPairedIntent({snapshot,snapshotSha256,phase:'restore'});
    freshHistory(history,clock());
    return {schema:'stallorder-paired-recovery-intent/v1',project:snapshot.project,
      controlCommit:snapshot.controlCommit,originalRunId:snapshot.runId,originalRunAttempt:1,
      recoveryRunId:String(history.currentRunId),recoveryRunAttempt:1,
      originalWorkflowId:history.originalWorkflowId,recoveryWorkflowId:history.recoveryWorkflowId,
      snapshotSha256,originalSnapshotFinishedAt:snapshot.finishedAt,journalSha256:digest(journal),
      untouched,restored,preimages:records.map(r=>({slug:r.slug,sha256:digest(r)})),
      operations:base.operations.filter(op=>eligible.includes(op.slug)).map(op=>({...op,
        operationId:digest([op.operationId,history.recoveryWorkflowId,history.currentRunId])})),
      recoveryOnly:true,mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
  } catch {throw new Error('EDGE_RECOVERY_PLAN_REJECTED');}
}
// The native protected entry must authenticate the separate completed intent
// producer and shared writer lock before calling this fixed-project executor.
export async function executeInterruptedEdgeRecovery({snapshot,snapshotSha256,journal,history,plan,read,apply,emit,clock=Date.now}) {
  const attempted=[],verified=[];
  try {
    snapshot=structuredClone(snapshot);journal=structuredClone(journal);history=structuredClone(history);plan=structuredClone(plan);
    assert.equal(history.phase,'restore');for(const fn of [read,apply,emit])assert.equal(typeof fn,'function');
    const expected=await planInterruptedEdgeRecovery({snapshot,snapshotSha256,journal,history,read,clock});assert.deepEqual(plan,expected);
    const check=async slug=>{
      const current=await read({project:snapshot.project,slug});
      assert.equal(digest(current),plan.preimages.find(r=>r.slug===slug).sha256);return current;
    };
    for(const operation of plan.operations) {
      const slug=operation.slug;await check(slug);
      await emit({event:'paired-edge-recovery-operation-started',operationId:operation.operationId,slug,
        expectedVersion:operation.expectedVersion,resultVersion:operation.resultVersion});
      await check(slug);freshHistory(history,clock());attempted.push(slug);
      await apply({project:snapshot.project,record:structuredClone(snapshot.functions.find(r=>r.slug===slug))});
      const after=await read({project:snapshot.project,slug});
      const result=await inspect(snapshot,snapshot.functions.map(r=>r.slug===slug?after:r));
      assert.ok(result.restored.includes(slug));assert.equal(after.metadata.version,operation.resultVersion);verified.push(slug);
      await emit({event:'paired-edge-recovery-operation-verified',operationId:operation.operationId,slug,
        version:after.metadata.version,wireSha256:after.wireSha256});
    }
    const final=[];for(const slug of EDGE_SLUGS)final.push(await read({project:snapshot.project,slug}));
    const result=await inspect(snapshot,final);
    for(const slug of EDGE_SLUGS) {
      if(plan.untouched.includes(slug))assert.deepEqual(final.find(r=>r.slug===slug),snapshot.functions.find(r=>r.slug===slug));
      else assert.ok(result.restored.includes(slug));
    }
    return {schema:'stallorder-paired-recovery-execution/v1',project:snapshot.project,
      controlCommit:snapshot.controlCommit,originalRunId:snapshot.runId,recoveryRunId:plan.recoveryRunId,
      snapshotSha256,planSha256:digest(plan),attempted,verified,complete:true,edgeStateRestored:true,
      cleanupVerified:false,productQualified:false,releaseAuthorized:false};
  } catch {
    const error=new Error('EDGE_RECOVERY_EXECUTION_INCOMPLETE');
    error.receipt={schema:'stallorder-paired-recovery-execution/v1',attempted,verified,complete:false,
      edgeStateRestored:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};throw error;
  }
}
