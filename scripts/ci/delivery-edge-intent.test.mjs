import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {buildPairedIntent, verifyPairedIntentLineage, loadPairedIntent, verifyPairedPhaseCompletion, loadPairedPhaseCompletion, verifyPairedUsageCompletion, loadPairedUsageCompletion} from './delivery-edge-intent.mjs';
import {formatPairedUsageEvidence} from './delivery-edge-usage-evidence.mjs';
import {createRatePeriodLedger,recordRatePeriods,verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(phase='replay') {
  const snapshot={schema:'stallorder-paired-edge-preimage/v2',project:'teunnvfakbfzmodajqjz',
    controlCommit:'a'.repeat(40),runId:'123',runAttempt:1,archiveSha256:'b'.repeat(64),
    startedAt:'2026-11-05T10:00:00.000Z',finishedAt:'2026-11-05T10:00:01.000Z',releaseAuthorized:false,
    functions:EDGE_SLUGS.map((slug,i)=>{const wire=Buffer.from('EZBRsynthetic-'+slug),wireSha256=sha(wire);
      return {slug,wireSha256,wireBase64:wire.toString('base64'),metadata:{
        id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),slug,status:'ACTIVE',version:10,
        verify_jwt:false,sha256:wireSha256,entrypoint_path:'file:///source/'+slug+'/index.ts',
        import_map_path:'file:///source/deno.json',import_map:true}};}),
    usageFixtures:[createUsageFixture('123'),createUsageFixture('123')]};
  snapshot.replayTargets=snapshot.functions.map(r=>({slug:r.slug,wireSha256:sha('archived-'+r.slug),
    entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:true}));
  const plan=buildPairedIntent({snapshot,snapshotSha256:'c'.repeat(64),phase});
  const repo={full_name:'KenLeeYa/Stallorder-Platform',id:1298874780,private:false,fork:false};
  const run={id:123,workflow_id:90,run_attempt:1,head_sha:snapshot.controlCommit,head_branch:'main',event:'workflow_dispatch',
    path:'.github/workflows/production-delivery-edge-rehearsal.yml',status:'in_progress',
    actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},repository:repo,head_repository:repo,
    created_at:'2026-11-05T10:00:00Z'};
  const common={run_id:123,run_attempt:1,head_sha:run.head_sha,labels:['ubuntu-24.04'],runner_name:'GitHub Actions 1'};
  const producer={...common,id:20,name:phase+'-intent',status:'completed',conclusion:'success',
    started_at:'2026-11-05T10:00:02Z',completed_at:'2026-11-05T10:00:05Z',steps:[
      {name:'Require current protected control and identical verified staging tree',number:1,status:'completed',conclusion:'success',started_at:'2026-11-05T10:00:02Z',completed_at:'2026-11-05T10:00:03Z'},
      {name:'Persist immutable paired Edge mutation intent',number:2,status:'completed',conclusion:'success',started_at:'2026-11-05T10:00:03Z',completed_at:'2026-11-05T10:00:05Z'}]};
  const consumer={...common,id:21,name:phase,status:'in_progress',conclusion:null,started_at:'2026-11-05T10:00:06Z'};
  const event={event:'paired-edge-mutation-intent',plan,planSha256:sha(JSON.stringify(plan))};
  const log='2026-11-05T10:00:04.0000000Z '+JSON.stringify(event)+'\n';
  return {snapshot,phase,snapshotSha256:'c'.repeat(64),plan,run,producer,consumer,log,
    jobs:{total_count:2,jobs:[producer,consumer]},now:Date.parse('2026-11-05T10:00:07Z')};
}
test('intent binds every one-shot operation and never carries binary or grants release',()=>{
  const f=fixture(),p=f.plan;
  assert.equal(p.operations.length,5); assert.equal(new Set(p.operations.map(x=>x.operationId)).size,5);
  assert.equal(p.releaseAuthorized,false);assert.equal(p.mutationAuthorized,false);
  assert.ok(!JSON.stringify(p).includes('wireBase64'));
  for(const op of p.operations){assert.equal(op.expectedVersion,10);assert.equal(op.resultVersion,11);}
  const restore=buildPairedIntent({...f,phase:'restore'});
  for(const op of restore.operations){assert.equal(op.expectedVersion,11);assert.equal(op.resultVersion,12);}
  assert.notDeepEqual(p.operations.map(x=>x.operationId),restore.operations.map(x=>x.operationId));
});
test('only a completed earlier intent job can be consumed by its unique hosted job',()=>{
  const f=fixture();const r=verifyPairedIntentLineage(f);
  assert.equal(r.lineageVerified,true);assert.equal(r.mutationAuthorized,false);assert.equal(r.consumerJobId,21);
});
for(const [label,change] of [
  ['producer still running',f=>{f.producer.status='in_progress';}],
  ['producer failed',f=>{f.producer.conclusion='failure';}],
  ['same job self-authorizes',f=>{f.consumer.id=20;}],
  ['consumer before durable completion',f=>{f.consumer.started_at='2026-11-05T10:00:04Z';}],
  ['retry attempt',f=>{f.run.run_attempt=2;}],
  ['another consumer already exists',f=>{f.jobs.jobs.push({...f.consumer,id:22});f.jobs.total_count++;}],
  ['incomplete job page',f=>{f.jobs.total_count++;}],
  ['self hosted consumer',f=>{f.consumer.labels=['self-hosted'];}],
  ['foreign source',f=>{f.consumer.head_sha='d'.repeat(40);}],
  ['foreign repository',f=>{f.run.repository={...f.run.repository,id:1};}],
  ['nonowner retry actor',f=>{f.run.triggering_actor.login='someone';}],
  ['stale run',f=>{f.now+=7*3600000;}],
  ['missing guard',f=>{f.producer.steps.shift();}],
  ['late forged log',f=>{f.log=f.log.replace('10:00:04.','10:00:06.');}],
  ['duplicate intent',f=>{f.log+=f.log;}],
  ['modified target',f=>{f.log=f.log.replace('teunnvfakbfzmodajqjz','eyuctbnlvnbnivwasvqr');}],
])test('refuses '+label,()=>{const f=fixture();change(f);assert.throws(()=>verifyPairedIntentLineage(f));});

function loaderFixture(completedPhase=false) {
  const isUsage=completedPhase==='usage';
  const f=isUsage?usageCompletionFixture():completedPhase?completionFixture():fixture(),calls=[],counts=new Map();
  if(completedPhase){f.run.workflow_id=90;f.producer={...f.job,id:20};
    f.consumer={...f.consumer,name:isUsage?'restore-intent':'usage-archive',started_at:isUsage?'2026-11-05T10:00:30Z':'2026-11-05T10:00:14Z'};
    f.jobs={total_count:2,jobs:[f.producer,f.consumer]};f.now=Date.parse(isUsage?'2026-11-05T10:00:31Z':'2026-11-05T10:00:15Z');}
  const files={'.github/workflows/production-delivery-edge-rehearsal.yml':'reviewed synthetic workflow',
    'scripts/ci/delivery-edge-rehearsal-entry.mjs':'reviewed synthetic entry',
    'scripts/ci/delivery-edge-intent.mjs':'reviewed synthetic intent verifier'};
  if(isUsage)for(const name of ['delivery-edge-usage-evidence','delivery-edge-usage','delivery-edge-usage-fixture','delivery-edge-rate-expiry','delivery-edge-usage-references'])files['scripts/ci/'+name+'.mjs']='reviewed synthetic '+name;
  const sourceDigests=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]));
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
    GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_SHA:f.snapshot.controlCommit,
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:f.consumer.name,
    GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/production-delivery-edge-rehearsal.yml@refs/heads/main',
    RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 1'};
  let hook=()=>{};
  const read=async path=>{
    calls.push(path);counts.set(path,(counts.get(path)??0)+1);hook(path,counts.get(path));
    if(path==='actions/runs/123')return JSON.stringify(f.run);
    if(path==='actions/runs/123/attempts/1/jobs?per_page=100')return JSON.stringify(f.jobs);
    if(path==='actions/jobs/20')return JSON.stringify(f.producer);
    if(path==='actions/jobs/21')return JSON.stringify(f.consumer);
    if(path==='actions/jobs/20/logs')return f.log;
    const m=/^contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(path);assert.ok(m);assert.equal(m[2],f.snapshot.controlCommit);
    const bytes=files[m[1]];assert.ok(bytes);
    return JSON.stringify({path:m[1],type:'file',encoding:'base64',size:Buffer.byteLength(bytes),content:Buffer.from(bytes).toString('base64')});
  };
  return {f,env,sourceDigests,calls,setHook:fn=>{hook=fn;},invoke:()=>(isUsage?loadPairedUsageCompletion:completedPhase?loadPairedPhaseCompletion:loadPairedIntent)({
    snapshot:f.snapshot,snapshotSha256:f.snapshotSha256,phase:f.phase,expectedWorkflowId:90,sourceDigests,env,read,clock:()=>f.now})};
}
test('loader verifies immutable source and rereads execution after retrieving intent log',async()=>{
  const x=loaderFixture(),result=await x.invoke();
  assert.equal(result.originVerified,true);assert.equal(result.mutationAuthorized,false);
  assert.equal(result.requiresGlobalHistoryCheck,true);
  const logAt=x.calls.indexOf('actions/jobs/20/logs');
  for(const path of ['actions/runs/123','actions/jobs/20','actions/jobs/21','actions/runs/123/attempts/1/jobs?per_page=100']) {
    assert.ok(x.calls.lastIndexOf(path)>logAt);
  }
});
for(const [label,change] of [
  ['untrusted source digest',x=>{x.sourceDigests['scripts/ci/delivery-edge-intent.mjs']='d'.repeat(64);}],
  ['wrong current runner identity',x=>{x.env.RUNNER_NAME='GitHub Actions 2';}],
  ['wrong actual executor job',x=>{x.env.GITHUB_JOB='restore';}],
  ['run changed during transport',x=>x.setHook((p,n)=>{if(p==='actions/runs/123'&&n===2)x.f.run.head_sha='d'.repeat(40);})],
  ['new consumer appeared during transport',x=>x.setHook((p,n)=>{if(p.includes('/attempts/')&&n===2){x.f.jobs.jobs.push({...x.f.consumer,id:22});x.f.jobs.total_count++;}})],
  ['producer changed during transport',x=>x.setHook((p,n)=>{if(p==='actions/jobs/20'&&n===2)x.f.producer.conclusion='failure';})],
  ['private API diagnostic',x=>x.setHook(()=>{throw Error('synthetic private diagnostic');})],
])test('loader rejects '+label+' with sanitized error',async()=>{
  const x=loaderFixture();change(x);
  await assert.rejects(x.invoke,err=>/^EDGE_INTENT_LOAD_[A-Z_]+$/.test(err.message)&&!err.message.includes('private'));
});

function completionFixture(phase='replay') {
 const f=fixture(phase);f.run.conclusion=null;f.now=Date.parse('2026-11-05T10:00:14Z');
 f.job={...f.consumer,status:'completed',conclusion:'success',completed_at:'2026-11-05T10:00:13Z',steps:[
  {number:1,name:'Require current protected control and identical verified staging tree',status:'completed',conclusion:'success',started_at:'2026-11-05T10:00:06Z',completed_at:'2026-11-05T10:00:07Z'},
  {number:2,name:'Apply exact paired Edge phase once and verify each postimage',status:'completed',conclusion:'success',started_at:'2026-11-05T10:00:07Z',completed_at:'2026-11-05T10:00:12Z'}]};
 f.receipt={schema:'stallorder-paired-edge-phase/v1',project:f.snapshot.project,controlCommit:f.snapshot.controlCommit,
  runId:f.snapshot.runId,runAttempt:1,phase,planSha256:sha(JSON.stringify(f.plan)),attempted:EDGE_SLUGS,verified:EDGE_SLUGS,
  complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false};
 f.events=f.plan.operations.flatMap(op=>[
  {event:'paired-edge-operation-started',operationId:op.operationId,phase,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
  {event:'paired-edge-operation-verified',operationId:op.operationId,phase,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
 f.events.push({event:'paired-edge-phase-complete',receipt:f.receipt});
 f.refresh=()=>{f.log=f.events.map(event=>'2026-11-05T10:00:08.0000000Z '+JSON.stringify(event)).join('\n');};
 f.refresh();return f;
}
test('completed phase requires every ordered one-shot operation and exact terminal receipt',()=>{
 for(const phase of ['replay','restore']) {const f=completionFixture(phase),r=verifyPairedPhaseCompletion(f);
 assert.equal(r.phase,phase);assert.equal(r.phaseComplete,true);assert.equal(r.originVerified,false);
 assert.equal(r.mutationAuthorized,false);assert.equal(r.releaseAuthorized,false);}
});
for(const [label,change] of [
 ['missing operation',f=>{f.events.splice(2,1);}],
 ['duplicate operation',f=>{f.events.splice(1,0,f.events[0]);}],
 ['verification before attempt',f=>{[f.events[0],f.events[1]]=[f.events[1],f.events[0]];}],
 ['foreign operation',f=>{f.events[0].operationId='f'.repeat(64);}],
 ['wrong resulting version',f=>{f.events[1].version++;}],
 ['wrong restored bytes',f=>{f.events[1].wireSha256='f'.repeat(64);}],
 ['missing final receipt',f=>{f.events.pop();}],
 ['false cleanup claim',f=>{f.receipt.cleanupVerified=true;}],
 ['failed operation added',f=>{f.events.push({event:'paired-edge-phase-incomplete'});}],
 ['still running predecessor',f=>{f.job.status='in_progress';}],
 ['failed predecessor',f=>{f.job.conclusion='failure';}],
 ['another source',f=>{f.job.head_sha='f'.repeat(40);}],
 ['rerun attempt',f=>{f.run.run_attempt=2;}],
 ['guard skipped',f=>{f.job.steps[0].conclusion='skipped';}],
])test('completed phase refuses '+label,()=>{const f=completionFixture();change(f);f.refresh();assert.throws(()=>verifyPairedPhaseCompletion(f));});
test('phase rejects retroactive, future, or out-of-order event timestamps',()=>{
 for(const timestamp of ['10:00:06','10:00:13']){const f=completionFixture();f.log=f.log.replaceAll('10:00:08',timestamp);assert.throws(()=>verifyPairedPhaseCompletion(f));}
 const f=completionFixture();f.log=f.log.replace('10:00:08','10:00:09');assert.throws(()=>verifyPairedPhaseCompletion(f));
});
for(const duplicate of [false,true])test('completion refuses JSON-escaped '+(duplicate?'duplicate operation':'failure event'),()=>{
 const f=completionFixture(),event=duplicate?f.events[0]:{event:'paired-edge-phase-incomplete'};
 f.log+='\n2026-11-05T10:00:08.0000000Z '+JSON.stringify(event).replace('paired-edge','paired'+String.fromCharCode(92)+'u002dedge');
 assert.throws(()=>verifyPairedPhaseCompletion(f));
});
test('intent rejects a JSON-escaped duplicate instead of ignoring it',()=>{
 const f=fixture();f.log+=f.log.replaceAll('paired-edge','paired'+String.fromCharCode(92)+'u002dedge');
 assert.throws(()=>verifyPairedIntentLineage(f));
});
test('completed-phase loader authenticates source, current consumer and stable final metadata',async()=>{
 const x=loaderFixture(true),r=await x.invoke();assert.equal(r.phaseComplete,true);assert.equal(r.originVerified,true);
 assert.equal(r.mutationAuthorized,false);const logAt=x.calls.indexOf('actions/jobs/20/logs');
 for(const p of ['actions/runs/123','actions/jobs/20','actions/jobs/21','actions/runs/123/attempts/1/jobs?per_page=100'])assert.ok(x.calls.lastIndexOf(p)>logAt);
});
for(const [label,change] of [
 ['foreign workflow identity',x=>{x.f.run.workflow_id=91;}],
 ['wrong consumer phase',x=>{x.env.GITHUB_JOB='restore';}],
 ['consumer before completed writer',x=>{x.f.consumer.started_at='2026-11-05T10:00:12Z';}],
 ['foreign runner',x=>{x.env.RUNNER_NAME='GitHub Actions 2';}],
 ['untrusted verifier bytes',x=>{x.sourceDigests['scripts/ci/delivery-edge-intent.mjs']='d'.repeat(64);}],
 ['incomplete job inventory',x=>{x.f.jobs.total_count++;}],
 ['changed writer conclusion',x=>x.setHook((p,n)=>{if(p==='actions/jobs/20'&&n===2)x.f.producer.conclusion='failure';})],
 ['changed consumer identity',x=>x.setHook((p,n)=>{if(p==='actions/jobs/21'&&n===2)x.f.consumer.id=22;})],
 ['private transport error',x=>x.setHook(()=>{throw Error('synthetic private diagnostic');})],
])test('completed-phase loader refuses '+label,async()=>{const x=loaderFixture(true);change(x);await assert.rejects(x.invoke(),/^Error: EDGE_PHASE_LOAD_[A-Z_]+$/);});

function usageCompletionFixture() {
 const f=completionFixture(),owned=f.snapshot.usageFixtures[0],ledger=createRatePeriodLedger();
 f.phase='usage-archive';f.job.name=f.phase;f.job.completed_at='2026-11-05T10:00:29Z';
 f.job.steps[1].name='Run five real Edge calls and verify owned cleanup';f.job.steps[1].completed_at='2026-11-05T10:00:28Z';
 f.now=Date.parse('2026-11-05T10:00:30Z');
 for(let i=0;i<10;i++)recordRatePeriods(ledger,{observedAt:new Date(Date.parse('2026-11-05T10:00:08Z')+i*1000).toISOString(),rows:[]});
 const receipt={schema:'stallorder-isolated-five-edge-usage/v1',project:f.snapshot.project,runId:f.snapshot.runId,
  ownedOrganizationId:owned.organizationId,ownedStallId:owned.stallId,ownedOrderId:owned.orderId,
  ownedOrderSessionIds:['12345678-1234-1234-1234-123456789012'],calls:['create-order-session','create-public-order','get-public-order','manage-line-link','prepare-reorder']
   .map((slug,i)=>({slug,status:200,requestId:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),observedAt:ledger.snapshots[i*2].observedAt})),
  fixtureCleanup:{before:{organizations:1,stalls:1,orders:1},after:{organizations:0,stalls:0,orders:0},attempts:{before:[],afterCount:0}},
  rateCleanup:verifyRateExpiry(ledger,'2026-11-05T10:00:18.000Z',true),failureStages:[],rateEvidenceComplete:true,
  rateSnapshots:ledger.snapshots,ownedFixtureRowsRemaining:0,requestsSettled:true,releaseAuthorized:false};
 const before=Object.fromEntries(['organizations','stalls','orders','order_sessions','subscriptions','products','product_categories',
  'stall_products','qr_codes','stall_ordering_settings','stall_capacity_settings','order_items'].map(n=>[n,1]));
 before.stall_business_hours=7;receipt.fixtureCleanup.before=before;receipt.fixtureCleanup.after=Object.fromEntries(Object.keys(before).map(n=>[n,0]));
 receipt.fixtureCleanup.attempts.before=['SESSION_ISSUE','ORDER_SUBMIT'].map((eventType,i)=>({
  id:'12345678-1234-1234-1234-'+String(i+10).padStart(12,'0'),requestId:receipt.calls[i].requestId,
  organizationId:owned.organizationId,stallId:owned.stallId,qrCodeId:owned.qrId,
  orderSessionId:receipt.ownedOrderSessionIds[0],eventType,outcome:'ALLOWED',reasonCode:i===0?'SESSION_ISSUED':'ORDER_CREATED'}));
 receipt.evidenceSha256=sha(JSON.stringify(receipt));f.events=formatPairedUsageEvidence({...f,receipt});
 f.refresh=()=>{f.log=f.events.map(e=>'2026-11-05T10:00:19.0000000Z '+JSON.stringify(e)).join('\n');};f.refresh();return f;
}
test('completed usage requires an authentic prior job with framed five-call and cleanup evidence',async()=>{
 const f=usageCompletionFixture(),r=verifyPairedUsageCompletion(f);assert.equal(r.usageComplete,true);assert.equal(r.originVerified,false);
 const x=loaderFixture('usage'),loaded=await x.invoke();assert.equal(loaded.originVerified,true);assert.equal(loaded.mutationAuthorized,false);
 assert.equal(loaded.consumerJobId,21);
 assert.ok(x.calls.includes('contents/scripts/ci/delivery-edge-usage-evidence.mjs?ref='+f.snapshot.controlCommit));
});
for(const [name,change] of [
 ['failed completed job',f=>f.job.conclusion='failure'],['skipped actual flow',f=>f.job.steps[1].conclusion='skipped'],
 ['missing frame',f=>f.events.splice(1,1)],['wrong phase',f=>f.phase='usage-candidate'],
 ['after-step timestamp',f=>f.log=f.log.replaceAll('10:00:19','10:00:29')],
 ['escaped failure event',f=>f.log+='\n2026-11-05T10:00:19.0000000Z '+JSON.stringify({event:'paired-edge-usage-failed'}).replace('paired-edge','paired'+String.fromCharCode(92)+'u002dedge')],
])test('completed usage rejects '+name,()=>{const f=usageCompletionFixture();change(f);if(!name.includes('timestamp')&&!name.includes('escaped'))f.refresh();assert.throws(()=>verifyPairedUsageCompletion(f));});
for(const [name,change] of [
 ['wrong successor',x=>x.env.GITHUB_JOB='replay'],
 ['untrusted usage verifier',x=>x.sourceDigests['scripts/ci/delivery-edge-usage-evidence.mjs']='d'.repeat(64)],
 ['changed writer after log',x=>x.setHook((p,n)=>{if(p==='actions/jobs/20'&&n===2)x.f.producer.conclusion='failure';})],
])test('usage completion loader rejects '+name,async()=>{const x=loaderFixture('usage');change(x);await assert.rejects(x.invoke(),/^Error: EDGE_PHASE_LOAD_[A-Z_]+$/);});

for(const kind of [true,'usage'])test('final verify may read earlier '+kind+' evidence without becoming a writer',async()=>{
 const x=loaderFixture(kind);x.env.GITHUB_JOB='verify';x.f.consumer.name='verify';
 const result=await x.invoke();assert.equal(result.originVerified,true);assert.equal(result.mutationAuthorized,false);
});
test('intent loader also pins the independent workflow identity',async()=>{
 const x=loaderFixture();x.f.run.workflow_id=91;
 await assert.rejects(x.invoke(),/^Error: EDGE_INTENT_LOAD_[A-Z_]+$/);
});
