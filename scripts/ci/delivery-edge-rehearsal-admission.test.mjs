import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {sealPairedSnapshot,formatPairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {createRatePeriodLedger,recordRatePeriods,verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';
import {formatPairedUsageEvidence,verifyPairedUsageReceipt} from './delivery-edge-usage-evidence.mjs';
import {verifyCompletedPairedRehearsal,loadCompletedPairedRehearsal} from './delivery-edge-rehearsal-admission.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex'),base=Date.parse('2026-11-14T05:00:00Z');
const at=n=>new Date(base+n*1000).toISOString();
const frame=(events,n)=>events.map(e=>at(n).replace('Z','0000Z')+' '+JSON.stringify(e)).join('\n');
const workflow='.github/workflows/production-delivery-edge-rehearsal.yml';
const sourcePaths=[workflow,...['delivery-edge-rehearsal-entry','delivery-edge-intent','delivery-edge-usage-evidence',
  'delivery-edge-usage','delivery-edge-usage-fixture','delivery-edge-rate-expiry','delivery-edge-usage-references'].map(n=>'scripts/ci/'+n+'.mjs')];
const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
const stageNames=['Capture encrypted isolated Edge preimages before any write','Persist immutable paired Edge mutation intent',
  'Apply exact paired Edge phase once and verify each postimage','Run five real Edge calls and verify owned cleanup',
  'Persist immutable paired Edge mutation intent','Apply exact paired Edge phase once and verify each postimage',
  'Run five real Edge calls and verify owned cleanup','Verify restored bytes and authenticated usage receipts'];
function fixture() {
  const controlCommit='a'.repeat(40),token='sbp_'+'1'.repeat(40),runId=1234,workflowId=408525851;
  const repo={full_name:'KenLeeYa/Stallorder-Platform',id:1298874780,private:false,fork:false};
  const run={id:runId,head_sha:controlCommit,head_branch:'main',event:'workflow_dispatch',run_number:1,run_attempt:1,
    workflow_id:workflowId,path:workflow,repository:repo,head_repository:repo,actor:{login:'KenLeeYa'},
    triggering_actor:{login:'KenLeeYa'},status:'completed',conclusion:'success',created_at:at(0)};
  const jobs=names.map((name,i)=>({id:5678+i,name,run_id:runId,run_attempt:1,head_sha:controlCommit,
    status:'completed',conclusion:'success',labels:['ubuntu-24.04'],runner_name:'GitHub Actions 5',
    runner_id:1,runner_group_id:0,runner_group_name:'GitHub Actions',started_at:at(i*30),completed_at:at(i?i*30+25:5),
    steps:[{number:1,name:'Require current protected control and identical verified staging tree',status:'completed',
      conclusion:'success',started_at:at(i*30),completed_at:at(i*30+1)},
    {number:2,name:stageNames[i],status:'completed',conclusion:'success',started_at:at(i*30+1),completed_at:at(i?i*30+24:4)}]}));
  const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',controlCommit,
    runId:String(runId),runAttempt:1,archiveSha256:'b'.repeat(64),startedAt:at(1),finishedAt:at(2),releaseAuthorized:false,
    functions:EDGE_SLUGS.map((slug,i)=>{const wire=Buffer.from('EZBR-owned-'+slug),sha256=hash(wire);return {
      slug,wireSha256:sha256,wireBase64:wire.toString('base64'),metadata:{id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),
        slug,status:'ACTIVE',version:10,verify_jwt:false,sha256,entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json'}};})};
  snapshot.replayTargets=snapshot.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,
    import_map_path:r.metadata.import_map_path,import_map:null}));
  snapshot.usageFixtures=[createUsageFixture(snapshot.runId),createUsageFixture(snapshot.runId)];
  const encrypted=formatPairedSnapshot(sealPairedSnapshot(snapshot,token),snapshot),snapshotSha256=encrypted[0].sha256;
  const logs={[jobs[0].id]:frame([{event:'paired-edge-first-run-admission',receipt:{schema:'stallorder-paired-first-run/v1',
    firstRunVerified:true,workflowId,runId,runNumber:1,runAttempt:1,reusable:false,mutationAuthorized:false,
    releaseAuthorized:false,observedAt:at(1),readFinishedAt:at(1)}}],1)+'\n'+frame(encrypted,3)};
  const summaries={};
  for(const [phase,index] of [['replay',2],['restore',5]]) {
    const plan=buildPairedIntent({snapshot,snapshotSha256,phase}),planSha256=hash(JSON.stringify(plan));
    logs[jobs[index-1].id]=frame([{event:'paired-edge-mutation-intent',plan,planSha256}],(index-1)*30+2);
    const events=plan.operations.flatMap(op=>[
      {event:'paired-edge-operation-started',operationId:op.operationId,phase,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
      {event:'paired-edge-operation-verified',operationId:op.operationId,phase,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
    events.push({event:'paired-edge-phase-complete',receipt:{schema:'stallorder-paired-edge-phase/v1',project:snapshot.project,
      controlCommit,runId:snapshot.runId,runAttempt:1,phase,planSha256,attempted:EDGE_SLUGS,verified:EDGE_SLUGS,
      complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false}});
    logs[jobs[index].id]=frame(events,index*30+2);
    summaries[phase]={schema:'stallorder-paired-edge-phase-completion/v1',phase,phaseComplete:true,jobId:jobs[index].id,
      planSha256,logSha256:hash(logs[jobs[index].id]),originVerified:true,mutationAuthorized:false,releaseAuthorized:false};
  }
  const receipts={};
  for(const [phase,index,ownedIndex] of [['usage-archive',3,0],['usage-candidate',6,1]]) {
    const owned=snapshot.usageFixtures[ownedIndex],ledger=createRatePeriodLedger();
    for(let i=0;i<10;i++)recordRatePeriods(ledger,{observedAt:at(index*30+2+i),rows:[]});
    const before=Object.fromEntries(['organizations','stalls','orders','order_sessions','subscriptions','products',
      'product_categories','stall_products','qr_codes','stall_ordering_settings','stall_capacity_settings','order_items'].map(n=>[n,1]));
    before.stall_business_hours=7;
    const receipt={schema:'stallorder-isolated-five-edge-usage/v1',project:snapshot.project,runId:snapshot.runId,
      ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,ownedOrderSessionIds:[randomUUID()],
      calls:EDGE_SLUGS.map((slug,i)=>({slug,status:i===1?201:200,requestId:randomUUID(),observedAt:ledger.snapshots[i*2].observedAt})),
      fixtureCleanup:{before,after:Object.fromEntries(Object.keys(before).map(n=>[n,0])),attempts:{before:[],afterCount:0}},
      rateCleanup:verifyRateExpiry(ledger,at(index*30+12),true),failureStages:[],rateEvidenceComplete:true,
      rateSnapshots:ledger.snapshots,ownedFixtureRowsRemaining:0,requestsSettled:true,releaseAuthorized:false};
    receipt.fixtureCleanup.attempts.before=['SESSION_ISSUE','ORDER_SUBMIT'].map((eventType,i)=>({id:randomUUID(),
      requestId:receipt.calls[i].requestId,organizationId:owned.organizationId,stallId:owned.stallId,qrCodeId:owned.qrId,
      orderSessionId:receipt.ownedOrderSessionIds[0],eventType,outcome:'ALLOWED',reasonCode:i===0?'SESSION_ISSUED':'ORDER_CREATED'}));
    receipt.evidenceSha256=hash(JSON.stringify(receipt));receipts[phase]=receipt;
    const input={snapshot,snapshotSha256,phase,receipt};
    logs[jobs[index].id]=frame(formatPairedUsageEvidence(input),index*30+15);
    summaries[phase]={...verifyPairedUsageReceipt(input),jobId:jobs[index].id,logSha256:hash(logs[jobs[index].id]),originVerified:true};
  }
  for(const [i,phase] of ['replay','restore','usage-archive','usage-candidate'].entries())
    Object.assign(summaries[phase],{consumerJobId:jobs[7].id,observedAt:at(212+i*2),readFinishedAt:at(213+i*2)});
  const receipt={schema:'stallorder-paired-edge-rehearsal/v2',project:snapshot.project,controlCommit,runId:snapshot.runId,
    runAttempt:1,snapshotSha256,replay:summaries.replay,restored:summaries.restore,archivedUsage:summaries['usage-archive'],
    candidateUsage:summaries['usage-candidate'],cleanupVerified:true,productionRecoveryVerified:false,releaseAuthorized:false};
  const refresh=()=>{logs[jobs[7].id]=frame([{event:'paired-edge-rehearsal-complete',receipt}],230);};refresh();
  const sourceDigests={},responses=new Map([['actions/runs/'+runId,run],
    [`actions/runs/${runId}/attempts/1/jobs?per_page=100`,{total_count:8,jobs}],
    ['git/commits/'+controlCommit,{sha:controlCommit,tree:{sha:'c'.repeat(40)}}]]);
  for(const path of sourcePaths) {
    const bytes=Buffer.from('synthetic immutable '+path);sourceDigests[path]=hash(bytes);
    responses.set(`contents/${path}?ref=${controlCommit}`,{path,type:'file',encoding:'base64',content:bytes.toString('base64'),size:bytes.length});
  }
  for(const job of jobs)responses.set('actions/jobs/'+job.id,job);
  const calls=[],read=async path=>{calls.push(path);if(path.endsWith('/logs'))return logs[path.split('/')[2]];
    assert.ok(responses.has(path),path);return JSON.stringify(responses.get(path));};
  const contract={controlCommit,controlTree:'c'.repeat(40),runId,jobId:jobs[0].id,runAttempt:1,workflowId,
    archiveSha256:snapshot.archiveSha256,sourceDigests};
  return {snapshot,snapshotSha256,expectedWorkflowId:workflowId,run,jobs,logs,now:base+240000,
    contract,token,clock:()=>base+240000,read,responses,calls,receipt,receipts,refresh};
}
test('terminal success verifies both five-Edge phases, real-use receipts and cleanup without claiming App/Production qualification',()=>{
  const x=fixture(),out=verifyCompletedPairedRehearsal(x);
  assert.equal(out.cleanupVerified,true);assert.equal(out.edgeRehearsalVerified,true);assert.equal(out.originVerified,false);
  assert.equal(out.productQualified,false);assert.equal(out.productionRecoveryVerified,false);assert.equal(out.releaseAuthorized,false);
});
test('authenticated loader uses immutable original control independent of later main and rechecks all eight jobs',async()=>{
  const x=fixture(),out=await loadCompletedPairedRehearsal(x);
  assert.equal(out.evidence.originVerified,true);assert.equal(out.evidence.controlCommit,x.contract.controlCommit);
  assert.equal(out.evidence.controlTree,x.contract.controlTree);assert.equal(out.evidence.firstRunVerified,true);
  assert.equal(out.evidence.cleanupVerified,true);assert.equal(out.evidence.releaseAuthorized,false);
  assert.deepEqual(out.snapshot,x.snapshot);assert.equal(x.calls.some(p=>p.includes('heads/main')),false);
  assert.deepEqual(x.calls.slice(-8),x.jobs.map(j=>'actions/jobs/'+j.id));
});
test('pure terminal rejection does not expose supplied receipt fields through assertion diagnostics',()=>{
  const x=fixture();x.receipt.extra='SYNTHETIC-PRIVATE-MARKER';x.refresh();
  assert.throws(()=>verifyCompletedPairedRehearsal(x),e=>e.message==='COMPLETED_EDGE_EVIDENCE_REJECTED'&&
    !('actual' in e)&&!('expected' in e)&&!JSON.stringify(e).includes('SYNTHETIC-PRIVATE-MARKER'));
});
for(const [name,change] of [
  ['active run',x=>{x.run.status='in_progress';x.run.conclusion=null;}],
  ['failed run',x=>{x.run.conclusion='failure';}],
  ['expired six-hour qualification',x=>{x.now=base+6*3600000+1;}],
  ['later run number',x=>{x.run.run_number=2;}],
  ['rerun',x=>{x.run.run_attempt=2;}],
  ['skipped usage',x=>{x.jobs[3].conclusion='skipped';}],
  ['forged hosted group',x=>{x.jobs[3].runner_group_name='self-hosted';}],
  ['missing runner ID',x=>{delete x.jobs[7].runner_id;}],
  ['missing guard',x=>{x.jobs[7].steps.shift();}],
  ['ignored failed step',x=>{x.jobs[3].steps[0].conclusion='failure';}],
  ['unordered stages',x=>{x.jobs[3].started_at=at(61);}],
  ['missing restore verification',x=>{x.logs[x.jobs[5].id]=x.logs[x.jobs[5].id].split('\n').slice(0,-1).join('\n');}],
  ['missing usage evidence',x=>{x.logs[x.jobs[3].id]='runner no receipt';}],
  ['usage from another phase',x=>{x.logs[x.jobs[3].id]=x.logs[x.jobs[6].id];}],
  ['cleanup not verified',x=>{x.receipt.cleanupVerified=false;x.refresh();}],
  ['fabricated final phase hash',x=>{x.receipt.replay.logSha256='0'.repeat(64);x.refresh();}],
  ['fabricated final usage hash',x=>{x.receipt.candidateUsage.receiptSha256='0'.repeat(64);x.refresh();}],
  ['invented Production authorization',x=>{x.receipt.releaseAuthorized=true;x.refresh();}],
  ['wrong final consumer',x=>{x.receipt.replay.consumerJobId++;x.refresh();}],
  ['final reads after emission',x=>{x.receipt.candidateUsage.readFinishedAt=at(231);x.refresh();}],
  ['final reads before verify',x=>{x.receipt.replay.observedAt=at(100);x.refresh();}],
  ['reordered final reads',x=>{x.receipt.restored.observedAt=at(212);x.refresh();}],
  ['duplicate final receipt',x=>{x.logs[x.jobs[7].id]+='\n'+x.logs[x.jobs[7].id];}],
  ['untimed final receipt',x=>{x.logs[x.jobs[7].id]=JSON.stringify({event:'paired-edge-rehearsal-complete',receipt:x.receipt});}],
  ['final entry failure',x=>{x.logs[x.jobs[7].id]+='\n'+frame([{event:'paired-edge-entry-failed',releaseAuthorized:false}],231);}],
])test('terminal admission refuses '+name,()=>{const x=fixture();change(x);assert.throws(()=>verifyCompletedPairedRehearsal(x));});
for(const [name,change] of [
  ['original source mismatch',x=>{x.contract.sourceDigests[sourcePaths[3]]='0'.repeat(64);}],
  ['original tree mismatch',x=>{x.contract.controlTree='d'.repeat(40);}],
  ['uninstalled workflow',x=>{x.contract.workflowId++;}],
  ['missing source pin',x=>{delete x.contract.sourceDigests[sourcePaths[7]];}],
  ['expired final verification',x=>{const read=x.read;let count=0,expired=false;x.clock=()=>expired?base+6*3600000+1:base+240000;
    x.read=async p=>{const s=await read(p);if(p==='actions/jobs/'+x.jobs[7].id&&++count===3)expired=true;return s;};}],
  ['job changes during final readback',x=>{const read=x.read;let count=0;x.read=async p=>{const s=await read(p);
    if(p==='actions/jobs/'+x.jobs[7].id&&++count===3){const j=JSON.parse(s);j.conclusion='failure';return JSON.stringify(j);}return s;};}],
])test('authenticated terminal loader refuses '+name,async()=>{const x=fixture();change(x);await assert.rejects(loadCompletedPairedRehearsal(x));});
