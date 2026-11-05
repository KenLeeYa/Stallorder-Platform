import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {planInterruptedEdgeRecovery, executeInterruptedEdgeRecovery} from './delivery-edge-recovery-plan.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(phase='replay') {
 const record=(slug,label,i)=>{const wire=Buffer.from('EZBRsynthetic-'+label+slug),h=sha(wire);
 return {slug,wireBase64:wire.toString('base64'),wireSha256:h,metadata:{id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),
 slug,name:slug,version:10,status:'ACTIVE',verify_jwt:false,sha256:h,entrypoint_path:'file:///source/'+slug+'/index.ts',
 import_map_path:'file:///source/deno.json',import_map:true,unknown_config:{retained:true}}};};
 const before=EDGE_SLUGS.map((s,i)=>record(s,'before',i)),archive={schema:'stallorder-delivery-edge-recovery/v1',
 project:'eyuctbnlvnbnivwasvqr',releaseAuthorized:false,restoreVerified:false,functions:EDGE_SLUGS.map((s,i)=>record(s,'archive',i+10))};
 const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',controlCommit:'a'.repeat(40),
 runId:'123',runAttempt:1,archiveSha256:'b'.repeat(64),startedAt:'2026-11-05T10:00:00.000Z',finishedAt:'2026-11-05T10:00:01.000Z',
 functions:before,replayTargets:archive.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,
 import_map_path:r.metadata.import_map_path,import_map:true})),usageFixtures:[createUsageFixture('123'),createUsageFixture('123')],releaseAuthorized:false};
 const state=new Map(before.map(r=>[r.slug,structuredClone(r)])),calls=[];
 const write=({record:r})=>{const prev=state.get(r.slug),after=structuredClone(r);after.metadata={...prev.metadata,version:prev.metadata.version+1,
 sha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:r.metadata.import_map};state.set(r.slug,after);};
 if(phase==='restore') for(const r of archive.functions)write({record:r});
 const x={snapshot,snapshotSha256:'c'.repeat(64),archive,phase,state,calls,
 read:async({project,slug})=>{assert.equal(project,snapshot.project);calls.push({read:slug});return structuredClone(state.get(slug));},
 apply:async args=>{assert.equal(args.project,snapshot.project);calls.push({apply:args.record.slug});write(args);},
 emit:event=>calls.push({event})};
 x.intent=buildPairedIntent(x);return x;
}

function recoveryFixture() {
 const f=fixture('restore');
 f.journal={schema:'stallorder-paired-interrupted-journal/v1',controlCommit:f.snapshot.controlCommit,runId:f.snapshot.runId,
  runAttempt:1,snapshotSha256:f.snapshotSha256,originVerified:true,requiresRecoveryHistory:true,
  mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false,
  phases:{replay:{mayHaveWritten:true,started:[...EDGE_SLUGS],verified:[...EDGE_SLUGS],complete:true,jobId:100,logSha256:'d'.repeat(64)},
   restore:{mayHaveWritten:false,started:[],verified:[],complete:false,jobId:101}}};
 f.history={schema:'stallorder-paired-recovery-history/v1',originalWorkflowId:90,recoveryWorkflowId:91,
  originalRunId:123,currentRunId:456,controlCommit:f.snapshot.controlCommit,snapshotSha256:f.snapshotSha256,
  phase:'restore-intent',currentJobId:500,historyVerified:true,originVerified:true,historySha256:'e'.repeat(64),
  mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
 f.clock=()=>Date.parse('2026-11-05T12:00:01.000Z');
 f.history.observedAt='2026-11-05T12:00:00.000Z';f.history.readFinishedAt='2026-11-05T12:00:01.000Z';
 return f;
}
test('old backup identity survives a separate restore-only intent',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);
 assert.equal(plan.originalRunId,'123');assert.equal(plan.recoveryRunId,'456');assert.equal(plan.originalSnapshotFinishedAt,f.snapshot.finishedAt);
 assert.equal(plan.operations.length,5);assert.equal(plan.releaseAuthorized,false);assert.equal(plan.mutationAuthorized,false);
 assert.ok(!JSON.stringify(plan).includes('wireBase64'));assert.equal(f.calls.filter(x=>x.apply).length,0);
});
test('restores five settled replay images once after all preflight reads',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);f.calls.length=0;
 f.history.phase='restore';const receipt=await executeInterruptedEdgeRecovery({...f,plan});
 assert.equal(receipt.complete,true);assert.equal(receipt.cleanupVerified,false);assert.equal(receipt.releaseAuthorized,false);
 assert.deepEqual(f.calls.slice(0,5).map(x=>x.read),EDGE_SLUGS);assert.equal(f.calls.filter(x=>x.apply).length,5);
 for(const r of f.state.values())assert.equal(r.metadata.version,12);
});
test('a completely skipped replay permits read-only untouched confirmation',async()=>{
 const f=recoveryFixture();f.journal.phases.replay={mayHaveWritten:false,started:[],verified:[],complete:false,jobId:100};
 for(const r of f.snapshot.functions)f.state.set(r.slug,structuredClone(r));
 const plan=await planInterruptedEdgeRecovery(f);assert.equal(plan.operations.length,0);assert.deepEqual(plan.untouched,EDGE_SLUGS);
});
test('observed restoration never authorizes a duplicate restore',async()=>{
 const f=recoveryFixture();f.journal.phases.restore={mayHaveWritten:true,started:[...EDGE_SLUGS],verified:[...EDGE_SLUGS],complete:true,jobId:101,logSha256:'f'.repeat(64)};
 for(const r of f.snapshot.functions)await f.apply({project:f.snapshot.project,record:r});f.calls.length=0;
 const plan=await planInterruptedEdgeRecovery(f);assert.equal(plan.operations.length,0);assert.deepEqual(plan.restored,EDGE_SLUGS);
 f.history.phase='restore';await executeInterruptedEdgeRecovery({...f,plan});assert.equal(f.calls.filter(x=>x.apply).length,0);
});
for(const [label,change] of [
 ['missing history times',f=>{delete f.history.observedAt;}],
 ['expired history',f=>{f.clock=()=>Date.parse('2026-11-05T12:01:01.001Z');}],
 ['future history',f=>{f.clock=()=>Date.parse('2026-11-05T11:59:59.000Z');}],
 ['reversed history times',f=>{f.history.observedAt='2026-11-05T12:00:02.000Z';}],
 ['untrusted operation journal',f=>{f.journal.originVerified=false;}],
 ['untrusted recovery history',f=>{f.history.originVerified=false;}],
 ['mismatched old backup',f=>{f.journal.snapshotSha256='1'.repeat(64);}],
 ['mismatched original run',f=>{f.history.originalRunId=124;}],
 ['prior restore with missing stdout',f=>{f.journal.phases.restore={mayHaveWritten:true,started:[],verified:[],complete:false,jobId:101,logSha256:'f'.repeat(64)};}],
 ['unchanged version after possible replay',f=>{f.state.set(EDGE_SLUGS[4],structuredClone(f.snapshot.functions[4]));}],
 ['unknown source at fifth function',f=>{f.state.get(EDGE_SLUGS[4]).wireSha256='1'.repeat(64);}],
 ['foreign immutable metadata',f=>{f.state.get(EDGE_SLUGS[4]).metadata.unknown_config={foreign:true};}],
 ['unexpected version',f=>{f.state.get(EDGE_SLUGS[4]).metadata.version=99;}],
])test('rejects '+label+' before writing',async()=>{
 const f=recoveryFixture();change(f);await assert.rejects(planInterruptedEdgeRecovery(f),{message:'EDGE_RECOVERY_PLAN_REJECTED'});
 assert.equal(f.calls.filter(x=>x.apply).length,0);
});
test('changing fifth preimage after durable intent prevents the first PATCH',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);f.state.get(EDGE_SLUGS[4]).metadata.version++;
 f.history.phase='restore';await assert.rejects(executeInterruptedEdgeRecovery({...f,plan}));assert.equal(f.calls.filter(x=>x.apply).length,0);
});
test('timeout retains unknown attempted outcome without retry or automatic cleanup',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);let count=0;f.history.phase='restore';
 f.apply=async()=>{count++;throw Error('synthetic private timeout');};
 await assert.rejects(executeInterruptedEdgeRecovery({...f,plan}),e=>{assert.equal(e.message,'EDGE_RECOVERY_EXECUTION_INCOMPLETE');
  assert.deepEqual(e.receipt.attempted,[EDGE_SLUGS[0]]);assert.deepEqual(e.receipt.verified,[]);assert.equal(e.receipt.cleanupVerified,false);return true;});assert.equal(count,1);
});
test('an awaited emission cannot hide drift before PATCH',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);f.history.phase='restore';
 f.emit=async e=>{if(e.event==='paired-edge-recovery-operation-started')f.state.get(e.slug).metadata.version++;};
 await assert.rejects(executeInterruptedEdgeRecovery({...f,plan}));assert.equal(f.calls.filter(x=>x.apply).length,0);
});
test('mutating adapter arguments cannot rewrite the approved original bytes',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f),base=f.apply;f.history.phase='restore';
 f.apply=async args=>{args.record.wireBase64=Buffer.from('EZBRunapproved').toString('base64');args.record.wireSha256=sha(Buffer.from('EZBRunapproved'));args.record.metadata.sha256=args.record.wireSha256;await base(args);};
 await assert.rejects(executeInterruptedEdgeRecovery({...f,plan}));assert.equal(f.calls.filter(x=>x.apply).length,1);
});
test('history expiring during an awaited event blocks PATCH',async()=>{
 const f=recoveryFixture(),plan=await planInterruptedEdgeRecovery(f);f.history.phase='restore';
 f.emit=async()=>{f.clock=()=>Date.parse('2026-11-05T12:01:01.001Z');};
 await assert.rejects(executeInterruptedEdgeRecovery({...f,plan,clock:()=>f.clock()}));
 assert.equal(f.calls.filter(x=>x.apply).length,0);
});
