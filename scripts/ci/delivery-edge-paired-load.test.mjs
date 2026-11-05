import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {sealPairedSnapshot, formatPairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';
import {loadPairedSnapshot,loadPairedRecoverySnapshot,loadPairedAdmittedSnapshot,loadPairedInterruptedSnapshot} from './delivery-edge-paired-load.mjs';
import * as pairedLoad from './delivery-edge-paired-load.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const token = 'sbp_' + '1'.repeat(40), base = Date.parse('2026-11-05T07:00:00.000Z');
function fixture() {
  const workflow = Buffer.from('synthetic immutable workflow'), capture = Buffer.from('synthetic immutable entry');
  const contract = {controlCommit: 'a'.repeat(40), runId: 1234, jobId: 5678, runAttempt: 1, workflowId: 90,
    archiveSha256: 'b'.repeat(64), workflowSha256: hash(workflow), entrySha256: hash(capture)};
  const repo = {full_name: 'KenLeeYa/Stallorder-Platform', id: 1298874780, private: false, fork: false};
  const run = {id: 1234, head_sha: contract.controlCommit, head_branch: 'main', event: 'workflow_dispatch',
    run_attempt: 1, workflow_id: 90, path: '.github/workflows/production-delivery-edge-rehearsal.yml',
    repository: repo, head_repository: repo, actor: {login: 'KenLeeYa'}, triggering_actor: {login: 'KenLeeYa'},
    status: 'in_progress', conclusion: null, created_at: '2026-11-05T07:00:00Z'};
  const job = {id: 5678, run_id: 1234, run_attempt: 1, head_sha: contract.controlCommit, name: 'snapshot',
    status: 'completed', conclusion: 'success', labels: ['ubuntu-24.04'], runner_name: 'GitHub Actions 5',
    started_at: '2026-11-05T07:00:00Z', completed_at: '2026-11-05T07:00:05Z', steps: [
      {number: 1, name: 'Require current protected control and identical verified staging tree', status: 'completed', conclusion: 'success', started_at: '2026-11-05T07:00:00Z', completed_at: '2026-11-05T07:00:01Z'},
      {number: 2, name: 'Capture encrypted isolated Edge preimages before any write', status: 'completed', conclusion: 'success', started_at: '2026-11-05T07:00:01Z', completed_at: '2026-11-05T07:00:04Z'},
    ]};
  const snapshot = {schema: 'stallorder-paired-edge-preimage/v2', project: 'teunnvfakbfzmodajqjz',
    controlCommit: contract.controlCommit, runId: '1234', runAttempt: 1, archiveSha256: contract.archiveSha256,
    startedAt: '2026-11-05T07:00:01.000Z', finishedAt: '2026-11-05T07:00:02.000Z',
    functions: EDGE_SLUGS.map((slug, i) => {const wire = Buffer.from('EZBR-owned-' + slug), sha256 = hash(wire); return {
      slug, wireSha256: sha256, wireBase64: wire.toString('base64'), metadata: {id: '12345678-1234-1234-1234-' + String(i + 1).padStart(12, '0'), slug, status: 'ACTIVE', version: 10, verify_jwt: false, sha256,
        entrypoint_path: 'file:///index.ts', import_map_path: 'file:///deno.json'}};}), releaseAuthorized: false};
  snapshot.replayTargets=snapshot.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:r.metadata.import_map??null}));
  snapshot.usageFixtures=[createUsageFixture(snapshot.runId),createUsageFixture(snapshot.runId)];
  const log = formatPairedSnapshot(sealPairedSnapshot(snapshot, token), snapshot)
    .map(event => '2026-11-05T07:00:03.0000000Z ' + JSON.stringify(event)).join('\n');
  const responses = new Map([['actions/runs/1234', run], ['actions/jobs/5678', job], ['actions/jobs/5678/logs', log]]);
  for (const [path, bytes] of [['.github/workflows/production-delivery-edge-rehearsal.yml', workflow], ['scripts/ci/delivery-edge-rehearsal-entry.mjs', capture]]) responses.set(`contents/${path}?ref=${contract.controlCommit}`, {path, type: 'file', encoding: 'base64', content: bytes.toString('base64'), size: bytes.length});
  const calls = [];
  const read = async path => {calls.push(path); const value = responses.get(path); assert.notEqual(value, undefined); return typeof value === 'string' ? value : JSON.stringify(value);};
  return {contract, token, clock: () => base + 10000, read, responses, calls, run, job, snapshot};
}
test('loads only a completed same-source snapshot job and rechecks metadata after logs', async () => {
  const x = fixture(), out = await loadPairedSnapshot(x);
  assert.deepEqual(out.snapshot, x.snapshot); assert.equal(out.evidence.releaseAuthorized, false);
  assert.deepEqual(x.calls.slice(-2), ['actions/runs/1234', 'actions/jobs/5678']);
});
function recoveryFixture() {
  const x=fixture();x.clock=()=>base+7*3600000;
  x.run.status='completed';x.run.conclusion='failure';x.contract.consumerJobId=6789;
  x.consumer={id:6789,run_id:1234,run_attempt:1,head_sha:x.contract.controlCommit,name:'rehearse',
    status:'completed',conclusion:'failure',labels:['ubuntu-24.04'],runner_name:'GitHub Actions 6',
    started_at:'2026-11-05T07:00:06Z',completed_at:'2026-11-05T07:10:00Z'};
  x.responses.set('actions/jobs/6789',x.consumer);return x;
}
test('old authenticated backup is usable only for read-only recovery inspection, never fresh qualification',async()=>{
  const x=recoveryFixture();await assert.rejects(()=>loadPairedSnapshot(x));
  const out=await loadPairedRecoverySnapshot(x);
  assert.equal(out.evidence.recoveryOnly,true);assert.equal(out.evidence.productQualified,false);
  assert.equal(out.evidence.mutationAuthorized,false);assert.equal(out.evidence.releaseAuthorized,false);
  assert.equal(out.evidence.finishedAt,'2026-11-05T07:00:02.000Z');
  assert.deepEqual(x.calls.slice(-3),['actions/runs/1234','actions/jobs/5678','actions/jobs/6789']);
});
for(const [label,change] of [
  ['active consumer',x=>{x.consumer.status='in_progress';}],
  ['foreign attempt',x=>{x.consumer.run_attempt=2;}],
  ['consumer before backup',x=>{x.consumer.started_at='2026-11-05T07:00:01Z';}],
  ['future completion',x=>{x.consumer.completed_at='2026-11-06T07:10:00Z';}],
  ['wrong consumer name',x=>{x.consumer.name='snapshot';}],
  ['active workflow',x=>{x.run.status='in_progress';}],
  ['skipped consumer',x=>{x.consumer.conclusion='skipped';}],
  ['self-hosted consumer',x=>{x.consumer.labels=['self-hosted'];}],
  ['foreign consumer source',x=>{x.consumer.head_sha='c'.repeat(40);}],
])test('recovery inspection rejects '+label,async()=>{
  const x=recoveryFixture();change(x);await assert.rejects(()=>loadPairedRecoverySnapshot(x));
});
test('recovery inspection requires stable terminal metadata after encrypted transport',async()=>{
  for(const target of ['consumer','run']) {
    const x=recoveryFixture(),original=x.read;let count=0;
    const targetPath=target==='consumer'?'actions/jobs/6789':'actions/runs/1234';
    x.read=async path=>{
      if(path===targetPath&&++count===2)x[target==='consumer'?'consumer':'run'].conclusion='success';
      return original(path);
    };
    await assert.rejects(()=>loadPairedRecoverySnapshot(x),/PAIRED_SNAPSHOT_LOAD_FINAL_READBACK/);
  }
});
for (const [name, change] of [
  ['fork', x => {x.run.repository.fork = true;}],
  ['nonowner', x => {x.run.triggering_actor.login = 'other';}],
  ['nonmain', x => {x.run.head_branch = 'staging';}],
  ['foreign source', x => {x.job.head_sha = 'c'.repeat(40);}],
  ['unfinished snapshot', x => {x.job.status = 'in_progress';}],
  ['failed snapshot', x => {x.job.conclusion = 'failure';}],
  ['self-hosted runner', x => {x.job.labels = ['self-hosted'];}],
  ['skipped source guard', x => {x.job.steps[0].conclusion = 'skipped';}],
  ['capture before source guard', x => {x.job.steps[0].completed_at = '2026-11-05T07:00:03Z';}],
  ['stale producer', x => {x.clock = () => base + 7 * 3600000;}],
  ['future producer', x => {x.clock = () => base + 4000;}],
  ['wrong immutable workflow', x => {x.contract.workflowSha256 = '0'.repeat(64);}],
]) test('rejects untrusted preimage provenance: ' + name, async () => {
  const x = fixture(); change(x); await assert.rejects(loadPairedSnapshot(x), /^Error: PAIRED_SNAPSHOT_LOAD_[A-Z_]+$/);
});
test('rejects producer drift during transport and masks private diagnostics', async () => {
  const x = fixture(), original = x.read; let reads = 0;
  x.read = async path => {if (path === 'actions/jobs/5678' && ++reads === 2) x.job.run_attempt = 2; return original(path);};
  await assert.rejects(loadPairedSnapshot(x), /PAIRED_SNAPSHOT_LOAD_FINAL_READBACK/);
  const y = fixture(); y.read = async () => {throw Error('private token and source');};
  await assert.rejects(loadPairedSnapshot(y), error => !error.message.includes('private') && error.message === 'PAIRED_SNAPSHOT_LOAD_EXECUTION');
});
test('rejects incomplete or retroactively dated capture logs', async () => {
  for (const mutation of [log => log.split('\n').slice(0, -1).join('\n'),
    log => log.replaceAll('07:00:03.0000000Z', '07:00:01.0000000Z'),
    log => log + '\n2026-11-05T07:00:03.0000000Z {"event":"paired-preimage-failed"}']) {
    const x = fixture(); x.responses.set('actions/jobs/5678/logs', mutation(x.responses.get('actions/jobs/5678/logs')));
    await assert.rejects(loadPairedSnapshot(x));
  }
});

function admittedFixture() {
  const x=fixture();x.expectedWorkflowId=90;x.run.run_number=1;
  x.firstRun={schema:'stallorder-paired-first-run/v1',firstRunVerified:true,workflowId:90,
    runId:1234,runNumber:1,runAttempt:1,reusable:false,mutationAuthorized:false,releaseAuthorized:false,
    observedAt:'2026-11-05T07:00:01.000Z',readFinishedAt:'2026-11-05T07:00:01.000Z'};
  x.firstLogTime='2026-11-05T07:00:01.0000000Z';
  x.originalLog=x.responses.get('actions/jobs/5678/logs');
  x.refresh=()=>x.responses.set('actions/jobs/5678/logs',x.firstLogTime+' '+JSON.stringify({
    event:'paired-edge-first-run-admission',receipt:x.firstRun})+'\n'+x.originalLog);
  x.refresh();return x;
}
test('authenticates the one-use admission in the completed snapshot without a later queue veto',async()=>{
  const x=admittedFixture(),out=await loadPairedAdmittedSnapshot(x);
  assert.equal(out.evidence.firstRunVerified,true);assert.equal(out.evidence.workflowId,90);
  assert.equal(out.evidence.mutationAuthorized,false);assert.equal(out.evidence.releaseAuthorized,false);
  assert.ok(!x.calls.some(path=>path.startsWith('actions/workflows/')));
});
for(const [label,change] of [
  ['missing independent workflow pin',x=>{delete x.expectedWorkflowId;}],
  ['different installation identity',x=>{x.expectedWorkflowId=91;}],
  ['missing admission',x=>{x.refresh=()=>x.responses.set('actions/jobs/5678/logs',x.originalLog);}],
  ['a later run',x=>{x.run.run_number=2;}],
  ['replayed admission from another run',x=>{x.firstRun.runId=1233;}],
  ['admission after preimage capture',x=>{x.firstRun.readFinishedAt='2026-11-05T07:00:02.000Z';x.firstLogTime='2026-11-05T07:00:02.0000000Z';}],
  ['admission before source guard',x=>{x.firstLogTime='2026-11-05T07:00:00.0000000Z';}],
  ['reusable receipt',x=>{x.firstRun.reusable=true;}],
  ['self-authorized mutation',x=>{x.firstRun.mutationAuthorized=true;}],
  ['duplicate admission',x=>{x.originalLog=x.firstLogTime+' '+JSON.stringify({event:'paired-edge-first-run-admission',receipt:x.firstRun})+'\n'+x.originalLog;}],
])test('one-use snapshot refuses '+label,async()=>{
  const x=admittedFixture();change(x);x.refresh();await assert.rejects(loadPairedAdmittedSnapshot(x));
});
for(const position of ['after','inside','spaced-json'])test('one-use admission must precede snapshot frames in actual log order: '+position,async()=>{
  const x=admittedFixture(),lines=x.responses.get('actions/jobs/5678/logs').split('\n'),admission=lines.shift();
  lines.splice(position==='inside'?1:lines.length,0,admission);
  const log=lines.join('\n');
  x.responses.set('actions/jobs/5678/logs',position==='spaced-json'?log.replaceAll('"event":','"event" : '):log);
  await assert.rejects(loadPairedAdmittedSnapshot(x));
});
test('one-use snapshot rejects a JSON-escaped duplicate admission',async()=>{
 const x=admittedFixture(),log=x.responses.get('actions/jobs/5678/logs');
 const duplicate=log.split('\n')[0].replace('paired-edge','paired'+String.fromCharCode(92)+'u002dedge');
 x.responses.set('actions/jobs/5678/logs',duplicate+'\n'+log);
 await assert.rejects(loadPairedAdmittedSnapshot(x));
});

function interruptedFixture() {
  const x=admittedFixture();x.clock=()=>base+7*3600000;
  const intentSource=Buffer.from('synthetic immutable intent parser');x.contract.intentSha256=hash(intentSource);
  x.responses.set('contents/scripts/ci/delivery-edge-intent.mjs?ref='+x.contract.controlCommit,
    {path:'scripts/ci/delivery-edge-intent.mjs',type:'file',encoding:'base64',content:intentSource.toString('base64'),size:intentSource.length});
  x.run.status='completed';x.run.conclusion='failure';
  const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
  x.jobs={total_count:8,jobs:names.map((name,index)=>index===0?x.job:{
    id:6000+index,run_id:1234,run_attempt:1,head_sha:x.contract.controlCommit,name,status:'completed',
    conclusion:index===1?'success':index===2?'failure':'skipped',labels:index<3?['ubuntu-24.04']:[],
    runner_name:index<3?'GitHub Actions 6':null,started_at:'2026-11-05T07:00:06Z',completed_at:'2026-11-05T07:01:00Z',
    steps:index<3?[{number:1,name:'Run entry',status:'completed',conclusion:index===1?'success':'failure',
      started_at:'2026-11-05T07:00:06Z',completed_at:'2026-11-05T07:01:00Z'}]:[]})};
  x.responses.set('actions/runs/1234/attempts/1/jobs?per_page=100',x.jobs);
  for(const job of x.jobs.jobs) {
    x.responses.set('actions/jobs/'+job.id,job);
    if(job.name!=='snapshot'&&job.conclusion!=='skipped')x.responses.set('actions/jobs/'+job.id+'/logs','2026-11-05T07:00:07.0000000Z {"event":"synthetic-history"}');
  }
  return x;
}
test('staged interruption keeps the original admitted backup and authenticates every terminal job',async()=>{
  const x=interruptedFixture(),out=await loadPairedInterruptedSnapshot(x);
  assert.deepEqual(out.snapshot,x.snapshot);assert.equal(out.evidence.firstRunVerified,true);
  assert.equal(out.evidence.terminalJobsVerified,true);assert.equal(out.evidence.operationHistoryVerified,false);
  assert.equal(out.evidence.mutationAuthorized,false);assert.equal(out.evidence.productQualified,false);
  assert.equal(out.evidence.finishedAt,'2026-11-05T07:00:02.000Z');
  assert.deepEqual(out.journal.jobs,x.jobs.jobs);
  assert.deepEqual(Object.keys(out.journal.logs).sort(),['5678','6001','6002']);
  assert.equal(out.evidence.jobLogs.length,3);
});
for(const [label,change] of [
  ['active original run',x=>{x.run.status='in_progress';}],
  ['active writer',x=>{x.jobs.jobs[2].status='in_progress';}],
  ['rerun attempt',x=>{x.run.run_attempt=2;}],
  ['foreign job attempt',x=>{x.jobs.jobs[2].run_attempt=2;}],
  ['unlisted jobs',x=>{x.jobs.total_count=9;}],
  ['missing stage',x=>{x.jobs.jobs.pop();x.jobs.total_count--;}],
  ['duplicate stage',x=>{x.jobs.jobs[3].name='replay';}],
  ['unexpected legacy stage',x=>{x.jobs.jobs[2].name='rehearse';}],
  ['duplicate job ID',x=>{x.jobs.jobs[3].id=6002;}],
  ['foreign source',x=>{x.jobs.jobs[2].head_sha='c'.repeat(40);}],
  ['self-hosted writer',x=>{x.jobs.jobs[2].labels=['self-hosted'];}],
  ['unfinished step',x=>{x.jobs.jobs[2].steps[0].status='in_progress';}],
  ['skipped writer with execution steps',x=>{x.jobs.jobs[2].conclusion='skipped';}],
  ['unknown job conclusion',x=>{x.jobs.jobs[2].conclusion='neutral';}],
  ['future completion',x=>{x.jobs.jobs[2].completed_at='2026-11-06T07:00:00Z';}],
  ['missing writer log',x=>{x.responses.delete('actions/jobs/6002/logs');}],
  ['missing independent workflow pin',x=>{delete x.expectedWorkflowId;}],
  ['missing original intent source digest',x=>{delete x.contract.intentSha256;}],
  ['different original intent parser',x=>{x.contract.intentSha256='0'.repeat(64);}],
  ['missing original one-use admission',x=>{x.responses.set('actions/jobs/5678/logs',x.originalLog);}],
])test('staged interruption refuses '+label,async()=>{
  const x=interruptedFixture();change(x);await assert.rejects(loadPairedInterruptedSnapshot(x));
});
test('staged interruption rechecks complete job metadata after all logs',async()=>{
  for(const target of ['inventory','writer']) {
    const x=interruptedFixture(),original=x.read;let count=0;
    const watched=target==='inventory'?'actions/runs/1234/attempts/1/jobs?per_page=100':'actions/jobs/6002';
    x.read=async path=>{
      if(path===watched&&++count===2)x.jobs.jobs[2].conclusion='success';
      return original(path);
    };
    await assert.rejects(loadPairedInterruptedSnapshot(x),/PAIRED_SNAPSHOT_LOAD_FINAL_READBACK/);
  }
});

function journalFixture() {
  const x=interruptedFixture(),at=n=>new Date(base+n*1000).toISOString();
  const intent=x.jobs.jobs[1],writer=x.jobs.jobs[2];
  for(const [job,start,end,stepName] of [
    [intent,6,9,'Persist immutable paired Edge mutation intent'],
    [writer,10,20,'Apply exact paired Edge phase once and verify each postimage'],
  ]) {
    job.started_at=at(start);job.completed_at=at(end);
    job.steps=[{number:1,name:'Require current protected control and identical verified staging tree',
      status:'completed',conclusion:'success',started_at:at(start),completed_at:at(start+1)},
    {number:2,name:stepName,status:'completed',conclusion:job.conclusion,started_at:at(start+1),completed_at:at(end-1)}];
  }
  const firstFrame=x.originalLog.split('\n')[0];
  const snapshotSha256=JSON.parse(firstFrame.slice(firstFrame.indexOf('{'))).sha256;
  x.plan=buildPairedIntent({snapshot:x.snapshot,snapshotSha256,phase:'replay'});
  x.intentEvent={event:'paired-edge-mutation-intent',plan:x.plan,planSha256:hash(JSON.stringify(x.plan))};
  x.operationEvents=x.plan.operations.flatMap(op=>[
    {event:'paired-edge-operation-started',operationId:op.operationId,phase:'replay',slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
    {event:'paired-edge-operation-verified',operationId:op.operationId,phase:'replay',slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256},
  ]).slice(0,3);
  x.refreshJournal=()=>{
    x.responses.set('actions/jobs/6001/logs',at(7).replace('Z','0000Z')+' '+JSON.stringify(x.intentEvent));
    x.responses.set('actions/jobs/6002/logs',x.operationEvents.map(e=>at(12).replace('Z','0000Z')+' '+JSON.stringify(e)).join('\n')||'runner interrupted before stdout');
  };
  x.refreshJournal();return x;
}
test('authenticated interrupted journal binds original source and partial operation history without granting recovery',async()=>{
  assert.equal(typeof pairedLoad.loadPairedInterruptedJournal,'function');
  const x=journalFixture(),out=await pairedLoad.loadPairedInterruptedJournal(x);
  assert.equal(out.evidence.operationHistoryVerified,true);assert.equal(out.evidence.requiresOperationJournal,false);
  assert.equal(out.operationJournal.originVerified,true);assert.equal(out.operationJournal.requiresRecoveryHistory,true);
  assert.deepEqual(out.operationJournal.phases.replay.started,EDGE_SLUGS.slice(0,2));
  assert.deepEqual(out.operationJournal.phases.replay.verified,EDGE_SLUGS.slice(0,1));
  assert.equal(out.operationJournal.phases.replay.mayHaveWritten,true);
  assert.equal(out.operationJournal.phases.restore.mayHaveWritten,false);
  assert.equal(out.evidence.finishedAt,x.snapshot.finishedAt);assert.equal(out.evidence.mutationAuthorized,false);
  assert.equal(out.operationJournal.cleanupVerified,false);assert.equal(out.operationJournal.productQualified,false);
  assert.equal(out.operationJournal.releaseAuthorized,false);
});
test('authenticated interrupted journal preserves uncertain write when stdout is missing',async()=>{
  assert.equal(typeof pairedLoad.loadPairedInterruptedJournal,'function');
  const x=journalFixture();x.operationEvents=[];x.refreshJournal();
  const out=await pairedLoad.loadPairedInterruptedJournal(x);
  assert.equal(out.operationJournal.phases.replay.mayHaveWritten,true);
  assert.deepEqual(out.operationJournal.phases.replay.started,[]);
});
for(const [label,change,stage] of [
  ['foreign operation',x=>{x.operationEvents[0].operationId='0'.repeat(64);x.refreshJournal();},'JOURNAL'],
  ['wrong intent digest',x=>{x.intentEvent.planSha256='0'.repeat(64);x.refreshJournal();},'JOURNAL'],
  ['wrong original source',x=>{x.contract.intentSha256='0'.repeat(64);},'SOURCE'],
  ['missing installer workflow pin',x=>{delete x.expectedWorkflowId;},'CONTRACT'],
])test('authenticated interrupted journal rejects '+label,async()=>{
  assert.equal(typeof pairedLoad.loadPairedInterruptedJournal,'function');
  const x=journalFixture();change(x);
  await assert.rejects(pairedLoad.loadPairedInterruptedJournal(x),new RegExp('PAIRED_SNAPSHOT_LOAD_'+stage));
});
test('authenticated interrupted journal refuses terminal metadata drift during final readback',async()=>{
  assert.equal(typeof pairedLoad.loadPairedInterruptedJournal,'function');
  const x=journalFixture(),original=x.read;let reads=0;
  x.read=async p=>{if(p==='actions/jobs/6002'&&++reads===2)x.jobs.jobs[2].conclusion='cancelled';return original(p);};
  await assert.rejects(pairedLoad.loadPairedInterruptedJournal(x),/PAIRED_SNAPSHOT_LOAD_FINAL_READBACK/);
});

test('authenticated transport accepts native unassigned skipped scheduling metadata',async()=>{
  const x=journalFixture();
  for(const job of x.jobs.jobs.filter(j=>j.conclusion==='skipped'))Object.assign(job,{
    labels:['ubuntu-24.04'],runner_id:null,runner_group_id:null,runner_group_name:null,
    started_at:'2026-11-05T07:00:31Z',completed_at:'2026-11-05T07:00:30Z'});
  const out=await pairedLoad.loadPairedInterruptedJournal(x);
  assert.equal(out.operationJournal.originVerified,true);
  assert.equal(out.operationJournal.phases.restore.mayHaveWritten,false);
  assert.equal(out.evidence.mutationAuthorized,false);
});
for(const [key,value] of [['runner_id',8],['runner_group_id',8],['runner_group_name','Default'],
  ['labels',['self-hosted']],['started_at','2026-11-04T07:00:31Z']])
  test('authenticated transport rejects skipped '+key,async()=>{
    const x=journalFixture();x.jobs.jobs.find(j=>j.conclusion==='skipped')[key]=value;
    await assert.rejects(pairedLoad.loadPairedInterruptedJournal(x));
  });
