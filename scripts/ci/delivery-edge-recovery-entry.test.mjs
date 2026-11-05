import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {runRecoveryStage,validateRecoveryInstallation,validateRecoveryContext} from './delivery-edge-recovery-entry.mjs';
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

const installation={schema:'stallorder-paired-edge-recovery-installation/v1',repository:'KenLeeYa/Stallorder-Platform',repositoryId:1298874780,
workflow:'.github/workflows/production-delivery-edge-restore.yml',workflowId:91,originalWorkflowId:90,
isolatedProject:'teunnvfakbfzmodajqjz',firstRunNumber:1,maxRunAttempt:1,writerConcurrency:'stallorder-preview-pr389-writer'};
test('installation pins two distinct provider workflows and shared writer lock',()=>{assert.deepEqual(validateRecoveryInstallation(installation),installation);});
for(const [field,value]of [['workflowId',90],['writerConcurrency','other'],['isolatedProject','eyuctbnlvnbnivwasvqr'],['maxRunAttempt',2]])
test('installation rejects '+field,()=>assert.throws(()=>validateRecoveryInstallation({...installation,[field]:value})));
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',
GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'456',
GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'restore',EDGE_RECOVERY_PHASE:'restore',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 2',
GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-edge-restore.yml@refs/heads/main'};
test('context only accepts protected main native recovery phase',()=>assert.equal(validateRecoveryContext(env).runId,'456'));
for(const [field,value]of [['GITHUB_REF','refs/heads/staging'],['GITHUB_RUN_ATTEMPT','2'],['GITHUB_JOB','verify'],['RUNNER_ENVIRONMENT','self-hosted'],['GITHUB_ACTOR','other']])
test('context rejects '+field,()=>assert.throws(()=>validateRecoveryContext({...env,[field]:value})));
function stageFixture(phase='restore-intent'){
 const f=recoveryFixture();f.history.phase=phase;
 f.input={phase,snapshot:f.snapshot,snapshotSha256:f.snapshotSha256,journal:f.journal,read:f.read,apply:f.apply,emit:f.emit,clock:f.clock,
 loadHistory:async()=>structuredClone(f.history),loadProducer:async()=>{throw Error('unexpected producer read');},
 cleanupFixtures:async owned=>({schema:'stallorder-isolated-edge-owned-recovery/v1',project:f.snapshot.project,runId:f.snapshot.runId,
 ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,
 ownedRowsRemainingAtReadback:0,sharedRowsDeleted:0,requestsSettled:null,globalAttemptsReconciled:null,
 sharedRateEffectsSettled:null,cleanupVerified:false,productQualified:false,releaseAuthorized:false})};return f;
}
test('intent stage records the original backup with no provider mutation',async()=>{
 const f=stageFixture(),plan=await runRecoveryStage(f.input);assert.equal(plan.originalRunId,'123');
 assert.equal(f.calls.filter(c=>c.apply).length,0);assert.equal(f.calls.at(-1).event.event,'paired-edge-recovery-intent');
});
test('restore consumes completed intent before five fixed writes; verification never patches Edge',async()=>{
 const f=stageFixture(),plan=await runRecoveryStage(f.input);f.history.phase='restore';f.input.phase='restore';f.calls.length=0;
 f.input.loadProducer=async mode=>{assert.equal(mode,'intent');return {mode,originVerified:true,plan,planSha256:sha(JSON.stringify(plan))};};
 const receipt=await runRecoveryStage(f.input);assert.equal(receipt.edgeStateRestored,true);assert.equal(f.calls.filter(c=>c.apply).length,5);
 f.history.phase='verify';f.input.phase='verify';f.calls.length=0;
 f.input.loadProducer=async mode=>({mode,originVerified:true,plan,planSha256:sha(JSON.stringify(plan))});
 const verified=await runRecoveryStage(f.input);assert.equal(verified.edgeStateRestored,true);assert.equal(verified.cleanupVerified,false);
 assert.equal(f.calls.filter(c=>c.apply).length,0);assert.equal(verified.releaseAuthorized,false);
});
for(const [name,change]of [
 ['untrusted intent',f=>{f.input.loadProducer=async()=>({mode:'intent',originVerified:false});}],
 ['wrong history phase',f=>{f.history.phase='verify';}],
 ['forged intent',f=>{f.input.loadProducer=async()=>({mode:'intent',originVerified:true,plan:{},planSha256:'c'.repeat(64)});}],
 ['stale history',f=>{f.history.readFinishedAt='2026-11-05T10:00:00.000Z';}],
])test('restore refuses '+name+' before any PATCH',async()=>{const f=stageFixture('restore');change(f);await assert.rejects(runRecoveryStage(f.input));assert.equal(f.calls.filter(c=>c.apply).length,0);});

test('verification invokes only the two original owned fixture cleanups and never promotes global certainty',async()=>{
 const f=stageFixture(),plan=await runRecoveryStage(f.input);
 for(const record of f.snapshot.functions){const restored=structuredClone(record);restored.metadata.version+=2;f.state.set(record.slug,restored);}
 f.history.phase='verify';f.input.phase='verify';
 f.input.loadProducer=async mode=>({mode,originVerified:true,plan,planSha256:sha(JSON.stringify(plan))});
 const seen=[];f.input.cleanupFixtures=async owned=>{seen.push(owned);return {schema:'stallorder-isolated-edge-owned-recovery/v1',
  project:f.snapshot.project,runId:f.snapshot.runId,ownedOrganizationId:owned.organizationId,
  ownedStallId:owned.stallId,ownedOrderId:owned.orderId,ownedRowsRemainingAtReadback:0,
  cleanupVerified:false,productQualified:false,releaseAuthorized:false,requestsSettled:null,
  globalAttemptsReconciled:null,sharedRateEffectsSettled:null,sharedRowsDeleted:0};};
 const result=await runRecoveryStage(f.input);assert.deepEqual(seen,f.snapshot.usageFixtures);
 assert.equal(result.ownedFixtureCleanup.length,2);assert.equal(result.cleanupVerified,false);assert.equal(result.releaseAuthorized,false);
});

for(const mode of ['missing cleanup','failed cleanup','overclaimed cleanup'])test('verification rejects '+mode,async()=>{
 const f=stageFixture(),plan=await runRecoveryStage(f.input);
 for(const record of f.snapshot.functions){const restored=structuredClone(record);restored.metadata.version+=2;f.state.set(record.slug,restored);}
 f.history.phase='verify';f.input.phase='verify';f.calls.length=0;
 f.input.loadProducer=async kind=>({mode:kind,originVerified:true,plan,planSha256:sha(JSON.stringify(plan))});
 if(mode==='missing cleanup')delete f.input.cleanupFixtures;
 else if(mode==='failed cleanup')f.input.cleanupFixtures=async()=>{throw Error('synthetic cleanup failed');};
 else {const original=f.input.cleanupFixtures;f.input.cleanupFixtures=async owned=>({...await original(owned),cleanupVerified:true});}
 await assert.rejects(runRecoveryStage(f.input));
 assert.equal(f.calls.filter(c=>c.apply).length,0);
 assert.equal(f.calls.filter(c=>c.event?.event==='paired-edge-recovery-readback').length,0);
});
