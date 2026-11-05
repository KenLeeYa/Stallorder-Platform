import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {verifyRecoveryProducer,loadRecoveryProducer} from './delivery-edge-recovery-transport.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const workflow='.github/workflows/production-delivery-edge-restore.yml';
const sources=[workflow,'scripts/ci/delivery-edge-recovery-entry.mjs','scripts/ci/delivery-edge-recovery-transport.mjs',
  'scripts/ci/delivery-edge-recovery-plan.mjs','scripts/ci/delivery-edge-recovery-history.mjs'];
function fixture(mode='intent') {
  const repo={id:1298874780,full_name:'KenLeeYa/Stallorder-Platform',private:false,fork:false};
  const binding={controlCommit:'a'.repeat(40),originalRunId:123,currentRunId:456,
    originalWorkflowId:90,recoveryWorkflowId:91,snapshotSha256:'b'.repeat(64),phase:mode==='intent'?'restore':'verify'};
  const run={id:456,workflow_id:91,run_number:1,run_attempt:1,head_sha:binding.controlCommit,head_branch:'main',
    path:workflow,event:'workflow_dispatch',status:'in_progress',conclusion:null,actor:{login:'KenLeeYa'},
    triggering_actor:{login:'KenLeeYa'},repository:repo,head_repository:repo,created_at:'2026-11-05T12:00:00Z'};
  const stepName=mode==='intent'?'Persist immutable independent recovery intent':'Restore exact interrupted Edge preimages once';
  const producer={id:1001,run_id:456,run_attempt:1,head_sha:binding.controlCommit,name:mode==='intent'?'restore-intent':'restore',
    status:'completed',conclusion:'success',labels:['ubuntu-24.04'],runner_name:'GitHub Actions 1',
    started_at:'2026-11-05T12:00:01Z',completed_at:'2026-11-05T12:00:05Z',steps:[
      {number:1,name:'Require current protected control and identical verified staging tree',status:'completed',conclusion:'success',started_at:'2026-11-05T12:00:01Z',completed_at:'2026-11-05T12:00:02Z'},
      {number:2,name:stepName,status:'completed',conclusion:'success',started_at:'2026-11-05T12:00:02Z',completed_at:'2026-11-05T12:00:04Z'}]};
  const consumer={id:1002,run_id:456,run_attempt:1,head_sha:binding.controlCommit,name:binding.phase,status:'in_progress',conclusion:null,
    labels:['ubuntu-24.04'],runner_name:'GitHub Actions 2',started_at:'2026-11-05T12:00:06Z',completed_at:null,steps:[]};
  const plan={schema:'stallorder-paired-recovery-intent/v1',project:'teunnvfakbfzmodajqjz',controlCommit:binding.controlCommit,
    originalRunId:'123',originalRunAttempt:1,recoveryRunId:'456',recoveryRunAttempt:1,originalWorkflowId:90,recoveryWorkflowId:91,
    snapshotSha256:binding.snapshotSha256,originalSnapshotFinishedAt:'2026-11-04T12:00:00.000Z',journalSha256:'c'.repeat(64),
    untouched:[...EDGE_SLUGS],restored:[],preimages:EDGE_SLUGS.map(slug=>({slug,sha256:'d'.repeat(64)})),operations:[],
    recoveryOnly:true,mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
  const receipt={schema:'stallorder-paired-recovery-execution/v1',project:plan.project,controlCommit:plan.controlCommit,
    originalRunId:plan.originalRunId,recoveryRunId:plan.recoveryRunId,snapshotSha256:plan.snapshotSha256,planSha256:sha(JSON.stringify(plan)),
    attempted:[],verified:[],complete:true,edgeStateRestored:true,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
  const event=mode==='intent'?{event:'paired-edge-recovery-intent',plan,planSha256:sha(JSON.stringify(plan))}:
    {event:'paired-edge-recovery-complete',receipt};
  const x={binding,mode,run,producer,consumer,plan,jobs:{total_count:2,jobs:[producer,consumer]},now:Date.parse('2026-11-05T12:00:10Z')};
  x.log='2026-11-05T12:00:03.0000000Z '+JSON.stringify(event);return x;
}
for(const mode of ['intent','completion'])test('binds completed '+mode+' producer without authorizing a release',()=>{
  const out=verifyRecoveryProducer(fixture(mode));assert.equal(out.originVerified,false);assert.equal(out.releaseAuthorized,false);
});
for(const [name,change] of [
  ['same original and recovery run',x=>{x.binding.originalRunId=456;}],
  ['extra private binding',x=>{x.binding.privateToken='synthetic-private-sentinel';}],
  ['rerun',x=>{x.run.run_attempt=2;}],['later recovery',x=>{x.run.run_number=2;}],
  ['wrong workflow',x=>{x.run.workflow_id=92;}],['foreign owner',x=>{x.run.actor.login='other';}],
  ['failed producer',x=>{x.producer.conclusion='failure';}],['active producer',x=>{x.producer.status='in_progress';}],
  ['failed producer step',x=>{x.producer.steps[0].conclusion='failure';}],
  ['missing guard',x=>{x.producer.steps.shift();}],['self-hosted producer',x=>{x.producer.labels=['self-hosted'];}],
  ['overlapping consumer',x=>{x.consumer.started_at='2026-11-05T12:00:04Z';}],
  ['duplicate event',x=>{x.log+='\n'+x.log;}],['wrong digest',x=>{x.log=x.log.replace(sha(JSON.stringify(x.plan)),'d'.repeat(64));}],
  ['event outside producer step',x=>{x.log=x.log.replace('12:00:03','12:00:09');}],
  ['expired recovery invocation',x=>{x.now+=7*3600000;}],
])test('rejects '+name,()=>{const x=fixture();change(x);assert.throws(()=>verifyRecoveryProducer(x));});

function transportFixture(mode='intent') {
  const x=fixture(mode),files=Object.fromEntries(sources.map(p=>[p,'reviewed '+p])),calls=[];
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
    GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_SHA:x.binding.controlCommit,
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'456',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:x.binding.phase,
    GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/'+workflow+'@refs/heads/main',RUNNER_ENVIRONMENT:'github-hosted',
    RUNNER_OS:'Linux',RUNNER_NAME:x.consumer.runner_name};
  const read=async p=>{
    calls.push(p);
    if(p==='actions/runs/456')return JSON.stringify(x.run);
    if(p==='actions/runs/456/attempts/1/jobs?per_page=100')return JSON.stringify(x.jobs);
    if(p==='actions/jobs/1001')return JSON.stringify(x.producer);
    if(p==='actions/jobs/1002')return JSON.stringify(x.consumer);
    if(p==='actions/jobs/1001/logs')return x.log;
    const m=/^contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(p);assert.ok(m,p);assert.equal(m[2],x.binding.controlCommit);
    const bytes=Buffer.from(files[m[1]]);return JSON.stringify({path:m[1],type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});
  };
  return {x,files,calls,input:{binding:x.binding,mode,plan:x.plan,sourceDigests:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,sha(b)])),env,read,clock:()=>x.now}};
}
for(const mode of ['intent','completion'])test('authenticated '+mode+' transport rereads producer and run metadata',async()=>{
  const f=transportFixture(mode),out=await loadRecoveryProducer(f.input);
  assert.equal(out.originVerified,true);assert.equal(out.requiresRecoveryHistory,true);
  assert.equal(f.calls.filter(p=>p==='actions/jobs/1001').length,2);
  assert.equal(out.releaseAuthorized,false);
});
for(const [name,change] of [
  ['wrong executor',f=>{f.input.env.RUNNER_NAME='GitHub Actions 99';}],
  ['changed source',f=>{f.files[sources[2]]+='changed';}],
  ['missing source pin',f=>{delete f.input.sourceDigests[sources[0]];}],
  ['terminal producer drift',f=>{const base=f.input.read;let n=0;f.input.read=async p=>{if(p==='actions/jobs/1001'&&++n===2)f.x.producer.conclusion='failure';return base(p);};}],
  ['provider error diagnostic',f=>{f.input.read=async()=>{throw Error('private-provider-detail');};}],
])test('transport rejects '+name,async()=>{
  const f=transportFixture();change(f);await assert.rejects(loadRecoveryProducer(f.input),{message:'EDGE_RECOVERY_PRODUCER_REJECTED'});
});

function operationsFixture() {
  const x=fixture('completion'),source={wireSha256:'e'.repeat(64),entrypoint_path:'file:///index.ts',import_map_path:'file:///deno.json',import_map:null};
  x.plan.untouched=[];x.plan.operations=EDGE_SLUGS.map((slug,i)=>({slug,operationId:String(i+1).repeat(64),
    id:'12345678-1234-1234-1234-'+String(i+1).padStart(12,'0'),expectedVersion:11,resultVersion:12,expectedSource:source,targetSource:source}));
  const terminal=JSON.parse(x.log.slice(x.log.indexOf('{')));terminal.receipt.planSha256=sha(JSON.stringify(x.plan));
  terminal.receipt.attempted=[...EDGE_SLUGS];terminal.receipt.verified=[...EDGE_SLUGS];
  const events=x.plan.operations.flatMap(op=>[
    {event:'paired-edge-recovery-operation-started',operationId:op.operationId,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
    {event:'paired-edge-recovery-operation-verified',operationId:op.operationId,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
  events.push(terminal);x.events=events;x.refresh=()=>{x.log=x.events.map(e=>'2026-11-05T12:00:03.0000000Z '+JSON.stringify(e)).join('\n');};
  x.refresh();return x;
}
test('completion binds every ordered started and verified operation before terminal receipt',()=>assert.equal(verifyRecoveryProducer(operationsFixture()).originVerified,false));
for(const [name,change]of [
  ['private operation field',x=>{x.plan.operations[0].privateToken='synthetic-private-sentinel';}],
  ['private nested source field',x=>{x.plan.operations[0].targetSource.privateToken='synthetic-private-sentinel';}],
  ['missing operation fields',x=>{x.plan.operations=x.plan.operations.map(({slug})=>({slug}));}],
  ['missing ordered events',x=>{x.events=x.events.slice(-1);}],
  ['reordered operations',x=>{[x.events[0],x.events[2]]=[x.events[2],x.events[0]];}],
  ['entry failure before completion',x=>{x.events.unshift({event:'paired-edge-entry-failed',releaseAuthorized:false});}],
  ['incomplete before completion',x=>{x.events.unshift({event:'paired-edge-recovery-incomplete',complete:false});}],
  ['failure after completion',x=>{x.events.push({event:'paired-edge-recovery-entry-failed',releaseAuthorized:false});}],
])test('completion rejects '+name,()=>{
  const x=operationsFixture();change(x);x.events.find(e=>e.event==='paired-edge-recovery-complete').receipt.planSha256=sha(JSON.stringify(x.plan));
  x.refresh();assert.throws(()=>verifyRecoveryProducer(x));
});
