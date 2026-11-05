import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {validatePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {githubReadArguments} from './delivery-admission.mjs';
import {decodePairedUsageEvidence} from './delivery-edge-usage-evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const workflow = '.github/workflows/production-delivery-edge-rehearsal.yml';
const guardName = 'Require current protected control and identical verified staging tree';
const emitName = 'Persist immutable paired Edge mutation intent';
function time(value) {
  assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const n=Date.parse(value);assert.ok(Number.isFinite(n));
  assert.equal(new Date(n).toISOString(),value.includes('.')?value:value.replace('Z','.000Z'));return n;
}
const source = (record) => ({wireSha256:record.wireSha256,
  entrypoint_path:record.metadata?.entrypoint_path??record.entrypoint_path,
  import_map_path:record.metadata?.import_map_path??record.import_map_path,
  import_map:record.metadata?.import_map??record.import_map??null});

// A plan is not an authorization. The protected loader must authenticate the
// immutable source/logs, read back metadata and exclude unresolved earlier runs.
export function buildPairedIntent({snapshot,snapshotSha256,phase}) {
  snapshot=structuredClone(snapshot);validatePairedSnapshot(snapshot);
  assert.equal(snapshot.runAttempt,1);assert.match(snapshotSha256??'',/^[a-f0-9]{64}$/);
  assert.ok(['replay','restore'].includes(phase));
  const operations=EDGE_SLUGS.map(slug=>{
    const before=snapshot.functions.find(x=>x.slug===slug),replay=snapshot.replayTargets.find(x=>x.slug===slug);
    assert.ok(Number.isSafeInteger(before.metadata.version+2));
    const expectedVersion=before.metadata.version+(phase==='restore'?1:0);
    const operationId=hash(JSON.stringify([snapshot.controlCommit,snapshot.runId,snapshot.runAttempt,snapshotSha256,phase,slug]));
    return {operationId,slug,id:before.metadata.id,expectedVersion,resultVersion:expectedVersion+1,
      expectedSource:source(phase==='restore'?replay:before),targetSource:source(phase==='restore'?before:replay)};
  });
  return {schema:'stallorder-paired-edge-mutation-intent/v1',project:snapshot.project,
    controlCommit:snapshot.controlCommit,runId:snapshot.runId,runAttempt:1,phase,
    archiveSha256:snapshot.archiveSha256,snapshotSha256,originalSnapshotFinishedAt:snapshot.finishedAt,
    operations,mutationAuthorized:false,releaseAuthorized:false};
}

function hosted(job,run,name) {
  assert.ok(Number.isSafeInteger(job.id)&&job.id>0);assert.equal(job.run_id,run.id);
  assert.equal(job.head_sha,run.head_sha);assert.equal(job.run_attempt,1);assert.equal(job.name,name);
  assert.deepEqual(job.labels,['ubuntu-24.04']);assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
}
// Pure lineage verification only. Its return cannot authorize a provider write:
// it deliberately has no API/CLI and cannot prove origin or global exclusion.
export function verifyPairedIntentLineage({snapshot,snapshotSha256,phase,run,producer,consumer,jobs,log,now}) {
  const plan=buildPairedIntent({snapshot,snapshotSha256,phase});
  for(const repo of [run.repository,run.head_repository]) {
    assert.equal(repo?.full_name,'KenLeeYa/Stallorder-Platform');assert.equal(repo.id,1298874780);
    assert.equal(repo.private,false);assert.equal(repo.fork,false);
  }
  assert.equal(run.id,Number(plan.runId));assert.equal(run.run_attempt,1);assert.equal(run.head_sha,plan.controlCommit);
  assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,workflow);
  assert.equal(run.status,'in_progress');assert.equal(run.actor?.login,'KenLeeYa');assert.equal(run.triggering_actor?.login,'KenLeeYa');
  const created=time(run.created_at);assert.ok(Number.isFinite(now)&&created<=now&&now-created<=6*3600000);
  hosted(producer,run,phase+'-intent');hosted(consumer,run,phase);assert.notEqual(producer.id,consumer.id);
  assert.equal(producer.status,'completed');assert.equal(producer.conclusion,'success');
  assert.equal(consumer.status,'in_progress');assert.equal(consumer.conclusion,null);
  const start=time(producer.started_at),end=time(producer.completed_at),consume=time(consumer.started_at);
  assert.ok(created<=time(snapshot.startedAt)&&time(snapshot.finishedAt)<=start&&start<=end&&end<=consume&&consume<=now);
  assert.ok(Array.isArray(jobs.jobs)&&jobs.jobs.length>0&&jobs.jobs.length<=100);
  assert.equal(jobs.total_count,jobs.jobs.length);assert.equal(new Set(jobs.jobs.map(x=>x.id)).size,jobs.jobs.length);
  for(const job of jobs.jobs){assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,1);assert.equal(job.head_sha,run.head_sha);}
  for(const expected of [producer,consumer]) {
    const same=jobs.jobs.filter(job=>job.name===expected.name);assert.equal(same.length,1);assert.deepEqual(same[0],expected);
  }
  assert.ok(Array.isArray(producer.steps)&&new Set(producer.steps.map(x=>x.name)).size===producer.steps.length);
  let lastNumber=0,lastEnd=start;
  for(const step of producer.steps) {
    assert.ok(Number.isSafeInteger(step.number)&&step.number>lastNumber);lastNumber=step.number;
    assert.equal(step.status,'completed');
    if(step.conclusion==='skipped'){assert.ok(step.name.startsWith('Post Run actions/setup-node@'));continue;}
    assert.equal(step.conclusion,'success');const begin=time(step.started_at),finish=time(step.completed_at);
    assert.ok(lastEnd<=begin&&begin<=finish&&finish<=end);lastEnd=finish;
  }
  const guard=producer.steps.find(x=>x.name===guardName),emit=producer.steps.find(x=>x.name===emitName);
  assert.ok(guard&&emit&&guard.number<emit.number);
  assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=2*1024*1024);
  const records=[];
  for(const line of log.split(/\r?\n/)) {
    const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if(!match){assert.ok(!line.includes('paired-edge-mutation-intent'));continue;}
    const event=JSON.parse(match[2]);
    if(typeof event?.event!=='string'||!event.event.startsWith('paired-edge-mutation-intent'))continue;
    const at=time(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
    assert.ok(time(emit.started_at)<=at&&at<time(emit.completed_at)+1000&&at<=now);
    assert.deepEqual(Object.keys(event).sort(),['event','plan','planSha256']);
    assert.equal(event.event,'paired-edge-mutation-intent');assert.deepEqual(event.plan,plan);
    assert.equal(event.planSha256,hash(JSON.stringify(plan)));records.push(event);
  }
  assert.equal(records.length,1);
  return {schema:'stallorder-paired-edge-intent-lineage/v1',lineageVerified:true,planSha256:records[0].planSha256,
    producerJobId:producer.id,consumerJobId:consumer.id,logSha256:hash(log),
    mutationAuthorized:false,releaseAuthorized:false};
}

// Validate a terminal producer before a later stage uses its side effects. This
// pure parser is not provenance: the protected loader must obtain these exact
// metadata/log bytes from GitHub and verify the immutable workflow source.
function completedJob({snapshot,phase,run,job,now,stepName}) {
  for(const repo of [run.repository,run.head_repository]) {
    assert.equal(repo?.full_name,'KenLeeYa/Stallorder-Platform');assert.equal(repo.id,1298874780);
    assert.equal(repo.private,false);assert.equal(repo.fork,false);
  }
  assert.equal(run.id,Number(snapshot.runId));assert.equal(run.run_attempt,1);assert.equal(run.head_sha,snapshot.controlCommit);
  assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');assert.equal(run.path,workflow);
  assert.equal(run.status,'in_progress');assert.equal(run.conclusion,null);
  for(const key of ['actor','triggering_actor'])assert.equal(run[key]?.login,'KenLeeYa');
  const created=time(run.created_at);assert.ok(Number.isFinite(now)&&created<=now&&now-created<=6*3600000);
  hosted(job,run,phase);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  const start=time(job.started_at),end=time(job.completed_at);
  assert.ok(created<=time(snapshot.startedAt)&&time(snapshot.finishedAt)<=start&&start<=end&&end<=now);
  assert.ok(Array.isArray(job.steps)&&new Set(job.steps.map(s=>s.name)).size===job.steps.length);
  let previousNumber=0,previousEnd=start;
  for(const step of job.steps) {
    assert.ok(Number.isSafeInteger(step.number)&&step.number>previousNumber);previousNumber=step.number;
    assert.equal(step.status,'completed');
    if(step.conclusion==='skipped'){assert.ok(step.name.startsWith('Post Run actions/setup-node@'));continue;}
    assert.equal(step.conclusion,'success');const begin=time(step.started_at),finish=time(step.completed_at);
    assert.ok(previousEnd<=begin&&begin<=finish&&finish<=end);previousEnd=finish;
  }
  const guard=job.steps.find(s=>s.name===guardName);
  const applied=job.steps.find(s=>s.name===stepName);
  assert.ok(guard&&applied&&guard.number<applied.number);
  return applied;
}
export function verifyPairedPhaseCompletion({snapshot,snapshotSha256,phase,run,job,log,now}) {
  const plan=buildPairedIntent({snapshot,snapshotSha256,phase});
  const applied=completedJob({snapshot,phase,run,job,now,
    stepName:'Apply exact paired Edge phase once and verify each postimage'});
  const receipt={schema:'stallorder-paired-edge-phase/v1',project:snapshot.project,controlCommit:snapshot.controlCommit,
    runId:snapshot.runId,runAttempt:1,phase,planSha256:hash(JSON.stringify(plan)),attempted:EDGE_SLUGS,verified:EDGE_SLUGS,
    complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false};
  const expected=plan.operations.flatMap(op=>[
    {event:'paired-edge-operation-started',operationId:op.operationId,phase,slug:op.slug,
      expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
    {event:'paired-edge-operation-verified',operationId:op.operationId,phase,slug:op.slug,
      version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
  expected.push({event:'paired-edge-phase-complete',receipt});
  assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=2*1024*1024);
  const events=[];let lastAt=time(applied.started_at);
  for(const line of log.split(/\r?\n/)) {
    const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if(!match){assert.ok(!line.includes('paired-edge-operation-')&&!line.includes('paired-edge-phase-'));continue;}
    const event=JSON.parse(match[2]);
    if(typeof event?.event!=='string'||(!event.event.startsWith('paired-edge-operation-')&&!event.event.startsWith('paired-edge-phase-')))continue;
    const at=time(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
    assert.ok(lastAt<=at&&at<time(applied.completed_at)+1000&&at<=now);lastAt=at;
    events.push(event);
  }
  assert.deepEqual(events,expected);
  return {schema:'stallorder-paired-edge-phase-completion/v1',phase,phaseComplete:true,
    jobId:job.id,planSha256:receipt.planSha256,logSha256:hash(log),originVerified:false,
    mutationAuthorized:false,releaseAuthorized:false};
}

export function verifyPairedUsageCompletion({snapshot,snapshotSha256,phase,run,job,log,now}) {
  assert.ok(['usage-archive','usage-candidate'].includes(phase));
  buildPairedIntent({snapshot,snapshotSha256,phase:phase==='usage-archive'?'replay':'restore'});
  const step=completedJob({snapshot,phase,run,job,now,stepName:'Run five real Edge calls and verify owned cleanup'});
  assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=128*1024*1024);
  const events=[];let lastAt=time(step.started_at),firstAt;
  for(const line of log.split(/\r?\n/)) {
    const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if(!match){assert.ok(!line.includes('paired-edge-usage-'));continue;}
    const event=JSON.parse(match[2]);
    if(typeof event?.event!=='string'||!event.event.startsWith('paired-edge-usage-'))continue;
    const at=time(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
    assert.ok(lastAt<=at&&at<time(step.completed_at)+1000&&at<=now);lastAt=at;firstAt??=at;events.push(event);
  }
  const verified=decodePairedUsageEvidence({snapshot,snapshotSha256,phase,events});
  assert.ok(time(step.started_at)<=time(verified.receipt.rateSnapshots[0].observedAt));
  assert.ok(time(verified.receipt.rateCleanup.databaseObservedAt)<=firstAt);
  return {...verified,jobId:job.id,logSha256:hash(log),originVerified:false};
}

// Read-only interpretation of an original terminal run, including failed jobs.
// The caller must authenticate these old source/log bytes and separately exclude
// prior recovery writers. Missing stdout never proves that no PATCH was sent.
export function verifyInterruptedPairedJournal({snapshot,snapshotSha256,expectedWorkflowId,run,jobs,logs,now}) {
  buildPairedIntent({snapshot,snapshotSha256,phase:'replay'});
  assert.ok(Number.isSafeInteger(expectedWorkflowId)&&expectedWorkflowId>0);assert.equal(run.workflow_id,expectedWorkflowId);
  for(const repo of [run.repository,run.head_repository]) {
    assert.equal(repo?.full_name,'KenLeeYa/Stallorder-Platform');assert.equal(repo.id,1298874780);
    assert.equal(repo.private,false);assert.equal(repo.fork,false);
  }
  assert.equal(run.id,Number(snapshot.runId));assert.equal(run.run_attempt,1);assert.equal(run.run_number,1);
  assert.equal(run.head_sha,snapshot.controlCommit);assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  assert.equal(run.path,workflow);assert.equal(run.status,'completed');assert.ok(['success','failure','cancelled','timed_out'].includes(run.conclusion));
  for(const name of ['actor','triggering_actor'])assert.equal(run[name]?.login,'KenLeeYa');
  assert.ok(Number.isFinite(now)&&time(run.created_at)<=time(snapshot.startedAt)&&time(snapshot.finishedAt)<=now);
  const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
  assert.ok(Array.isArray(jobs));assert.equal(jobs.length,8);assert.equal(new Set(jobs.map(j=>j.id)).size,8);
  assert.deepEqual(jobs.map(j=>j.name).sort(),[...names].sort());
  for(const [index,name] of names.entries()) {
    const job=jobs.find(j=>j.name===name);
    assert.ok(Number.isSafeInteger(job.id)&&job.id>0);
    assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,1);assert.equal(job.head_sha,run.head_sha);
    assert.equal(job.status,'completed');assert.ok(['success','failure','cancelled','timed_out','skipped'].includes(job.conclusion));
    if(job.conclusion==='skipped') {
      assert.deepEqual(job.steps,[]);assert.ok(Array.isArray(job.labels));
      if(job.labels.length)assert.deepEqual(job.labels,['ubuntu-24.04']);
      for(const key of ['runner_name','runner_group_name'])assert.ok(job[key]==null||job[key]==='');
      for(const key of ['runner_id','runner_group_id'])assert.ok(job[key]==null);
      // GitHub may report inverted scheduling timestamps without assigning a runner.
      if(job.started_at!==null||job.completed_at!==null)
        for(const value of [job.started_at,job.completed_at])assert.ok(time(run.created_at)<=time(value)&&time(value)<=now);
      continue;
    }
    hosted(job,run,name);assert.ok(time(job.started_at)<=time(job.completed_at)&&time(job.completed_at)<=now);
    if(index) {
      const previous=jobs.find(j=>j.name===names[index-1]);assert.equal(previous.conclusion,'success');
      assert.ok(time(previous.completed_at)<=time(job.started_at));
    } else {assert.equal(job.conclusion,'success');assert.ok(time(snapshot.finishedAt)<=time(job.completed_at));}
  }
  const records=(job,stepName,prefix)=>{
    assert.ok(Array.isArray(job.steps)&&new Set(job.steps.map(s=>s.name)).size===job.steps.length);
    let lastNumber=0,lastEnd=time(job.started_at);
    for(const item of job.steps) {
      assert.ok(Number.isSafeInteger(item.number)&&item.number>lastNumber);lastNumber=item.number;
      assert.equal(item.status,'completed');assert.ok(['success','failure','cancelled','timed_out','skipped'].includes(item.conclusion));
      if(item.conclusion==='skipped') {
        if(job.conclusion==='success')assert.ok(item.name.startsWith('Post Run actions/setup-node@'));
        continue;
      }
      if(job.conclusion==='success')assert.equal(item.conclusion,'success');
      assert.ok(lastEnd<=time(item.started_at)&&time(item.started_at)<=time(item.completed_at)&&time(item.completed_at)<=time(job.completed_at));
      lastEnd=time(item.completed_at);
    }
    const guard=job.steps.find(s=>s.name===guardName),step=job.steps.find(s=>s.name===stepName);
    assert.ok(guard&&step&&guard.number<step.number);assert.equal(guard.status,'completed');assert.equal(guard.conclusion,'success');
    assert.equal(step.status,'completed');assert.ok(['success','failure','cancelled','timed_out'].includes(step.conclusion));
    assert.ok(time(job.started_at)<=time(guard.started_at)&&time(guard.started_at)<=time(guard.completed_at)&&
      time(guard.completed_at)<=time(step.started_at)&&time(step.started_at)<=time(step.completed_at)&&time(step.completed_at)<=time(job.completed_at));
    const log=logs[job.id];assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=2*1024*1024);
    const result=[];let last=time(step.started_at);
    for(const line of log.split(/\r?\n/)) {
      const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
      if(!match){assert.ok(!line.includes(prefix)&&!line.includes('paired-edge-entry-failed')&&!line.includes('paired-edge-rehearsal-incomplete'));continue;}
      const event=JSON.parse(match[2]);if(typeof event?.event!=='string'||!event.event.startsWith('paired-edge-'))continue;
      const at=time(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
      assert.ok(last<=at&&at<time(step.completed_at)+1000&&at<=now);last=at;result.push(event);
    }
    return result;
  };
  const phases={};
  for(const phase of ['replay','restore']) {
    const writer=jobs.find(j=>j.name===phase);
    if(writer.conclusion==='skipped') {phases[phase]={mayHaveWritten:false,started:[],verified:[],complete:false,jobId:writer.id};continue;}
    const producer=jobs.find(j=>j.name===phase+'-intent'),plan=buildPairedIntent({snapshot,snapshotSha256,phase});
    assert.equal(producer.conclusion,'success');
    assert.deepEqual(records(producer,emitName,'paired-edge-mutation-intent'),[
      {event:'paired-edge-mutation-intent',plan,planSha256:hash(JSON.stringify(plan))}]);
    const expected=plan.operations.flatMap(op=>[
      {event:'paired-edge-operation-started',operationId:op.operationId,phase,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
      {event:'paired-edge-operation-verified',operationId:op.operationId,phase,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
    expected.push({event:'paired-edge-phase-complete',receipt:{schema:'stallorder-paired-edge-phase/v1',project:snapshot.project,
      controlCommit:snapshot.controlCommit,runId:snapshot.runId,runAttempt:1,phase,planSha256:hash(JSON.stringify(plan)),
      attempted:EDGE_SLUGS,verified:EDGE_SLUGS,complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false}});
    const events=records(writer,'Apply exact paired Edge phase once and verify each postimage','paired-edge-');
    const prefix=[];let failed=false,entryFailed=false;
    for(const event of events) {
      if(event.event==='paired-edge-entry-failed') {
        assert.deepEqual(event,{event:'paired-edge-entry-failed',releaseAuthorized:false});assert.equal(entryFailed,false);entryFailed=true;failed=true;continue;
      }
      if(event.event==='paired-edge-rehearsal-incomplete') {
        assert.equal(failed,false);
        const started=prefix.filter(e=>e.event==='paired-edge-operation-started').map(e=>e.slug);
        const verified=prefix.filter(e=>e.event==='paired-edge-operation-verified').map(e=>e.slug);
        assert.ok(Array.isArray(event.attempted)&&event.attempted.length>=verified.length&&event.attempted.length<=started.length);
        assert.deepEqual(event,{event:'paired-edge-rehearsal-incomplete',schema:'stallorder-paired-edge-phase/v1',phase,
          attempted:started.slice(0,event.attempted.length),verified,complete:false,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false});
        // The generic entry failure may follow this bounded incomplete receipt.
        failed=true;continue;
      }
      assert.equal(failed,false);assert.deepEqual(event,expected[prefix.length]);prefix.push(event);
    }
    if(writer.conclusion==='success'){assert.equal(failed,false);assert.deepEqual(prefix,expected);}
    phases[phase]={mayHaveWritten:true,started:prefix.filter(e=>e.event==='paired-edge-operation-started').map(e=>e.slug),
      verified:prefix.filter(e=>e.event==='paired-edge-operation-verified').map(e=>e.slug),
      complete:writer.conclusion==='success'&&prefix.length===expected.length,jobId:writer.id,logSha256:hash(logs[writer.id])};
  }
  return {schema:'stallorder-paired-interrupted-journal/v1',controlCommit:snapshot.controlCommit,runId:snapshot.runId,
    runAttempt:1,snapshotSha256,phases,originVerified:false,requiresRecoveryHistory:true,
    mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
}

const sourcePaths=[workflow,'scripts/ci/delivery-edge-rehearsal-entry.mjs','scripts/ci/delivery-edge-intent.mjs'];
function github(path,maxBuffer=2*1024*1024) {
  return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,
    maxBuffer,stdio:['ignore','pipe','pipe']});
}
function currentExecutor(env,snapshot,phase) {
  for(const [name,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',
    GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',
    GITHUB_REF:'refs/heads/main',GITHUB_SHA:snapshot.controlCommit,GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_RUN_ID:snapshot.runId,GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:phase,
    GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/'+workflow+'@refs/heads/main',
    RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux'})) assert.equal(env[name],value);
  assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);
}
function runIdentity(run) {
  return Object.fromEntries(['id','run_attempt','head_sha','head_branch','event','path','workflow_id','status','conclusion',
    'repository','head_repository','actor','triggering_actor','created_at'].map(k=>[k,run[k]]));
}
function jobInventory(jobs) {
  assert.ok(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length<=100);
  return jobs.jobs.map(job=>({id:job.id,name:job.name,run_id:job.run_id,run_attempt:job.run_attempt,head_sha:job.head_sha}))
    .sort((a,b)=>a.id-b.id);
}
// Read-only authenticated transport. The global prior-run/operation journal and
// fixed writer entry are still mandatory before any provider mutation.
export async function loadPairedIntent({snapshot,snapshotSha256,phase,expectedWorkflowId,sourceDigests,env=process.env,read=github,clock=Date.now}) {
  let stage='CONTRACT';
  try {
    buildPairedIntent({snapshot,snapshotSha256,phase});currentExecutor(env,snapshot,phase);
    assert.ok(Number.isSafeInteger(expectedWorkflowId)&&expectedWorkflowId>0);
    assert.deepEqual(Object.keys(sourceDigests).sort(),[...sourcePaths].sort());
    for(const digest of Object.values(sourceDigests))assert.match(digest??'',/^[a-f0-9]{64}$/);
    const json=async path=>{const bytes=await read(path);assert.ok(typeof bytes==='string'&&Buffer.byteLength(bytes)<=2*1024*1024);return JSON.parse(bytes);};
    stage='EXECUTION';
    const runPath=`actions/runs/${snapshot.runId}`,jobsPath=runPath+'/attempts/1/jobs?per_page=100';
    const run=await json(runPath),jobs=await json(jobsPath);jobInventory(jobs);
    assert.equal(run.workflow_id,expectedWorkflowId);
    const producers=jobs.jobs.filter(x=>x.name===phase+'-intent'),consumers=jobs.jobs.filter(x=>x.name===phase);
    assert.equal(producers.length,1);assert.equal(consumers.length,1);
    for(const job of [...producers,...consumers])assert.ok(Number.isSafeInteger(job.id)&&job.id>0);
    const producerPath=`actions/jobs/${producers[0].id}`,consumerPath=`actions/jobs/${consumers[0].id}`;
    const producer=await json(producerPath),consumer=await json(consumerPath);
    assert.equal(consumer.runner_name,env.RUNNER_NAME);
    stage='SOURCE';
    for(const path of sourcePaths) {
      const file=await json(`contents/${path}?ref=${snapshot.controlCommit}`);
      assert.equal(file.path,path);assert.equal(file.type,'file');assert.equal(file.encoding,'base64');
      assert.equal(typeof file.content,'string');const encoded=file.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
      assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,file.size);assert.equal(hash(bytes),sourceDigests[path]);
    }
    stage='LOG';const log=await read(producerPath+'/logs');
    stage='VERIFY';const firstNow=clock();verifyPairedIntentLineage({snapshot,snapshotSha256,phase,run,producer,consumer,jobs,log,now:firstNow});
    stage='FINAL_READBACK';const observedAt=clock();
    const finalRun=await json(runPath),finalJobs=await json(jobsPath),finalProducer=await json(producerPath),finalConsumer=await json(consumerPath);
    assert.deepEqual(runIdentity(finalRun),runIdentity(run));assert.deepEqual(jobInventory(finalJobs),jobInventory(jobs));
    assert.deepEqual(finalProducer,producer);
    for(const key of ['id','name','run_id','run_attempt','head_sha','status','conclusion','started_at','labels','runner_name']) {
      assert.deepEqual(finalConsumer[key],consumer[key]);
    }
    stage='FINAL_VERIFY';const now=clock();assert.ok(firstNow<=observedAt&&observedAt<=now);
    assert.equal(finalConsumer.runner_name,env.RUNNER_NAME);
    const result=verifyPairedIntentLineage({snapshot,snapshotSha256,phase,run:finalRun,producer:finalProducer,
      consumer:finalConsumer,jobs:finalJobs,log,now});
    return {...result,originVerified:true,requiresGlobalHistoryCheck:true,observedAt:new Date(observedAt).toISOString(),
      readFinishedAt:new Date(now).toISOString(),mutationAuthorized:false,releaseAuthorized:false};
  } catch {throw new Error('EDGE_INTENT_LOAD_'+stage);}
}

async function loadCompleted({snapshot,snapshotSha256,phase,expectedWorkflowId,
  sourceDigests,env=process.env,read=github,clock=Date.now},usage=false) {
  let stage='CONTRACT';
  try {
    buildPairedIntent({snapshot,snapshotSha256,phase:usage?(phase==='usage-archive'?'replay':'restore'):phase});
    assert.ok(Number.isSafeInteger(expectedWorkflowId)&&expectedWorkflowId>0);
    const consumerName=env.GITHUB_JOB;
    const successors=usage?{'usage-archive':['restore-intent','verify'],'usage-candidate':['verify']}:
      {replay:['usage-archive','restore-intent','verify'],restore:['usage-candidate','verify']};
    assert.ok(successors[phase].includes(consumerName));
    currentExecutor(env,snapshot,consumerName);
    const paths=usage?[...sourcePaths,...['delivery-edge-usage-evidence','delivery-edge-usage','delivery-edge-usage-fixture',
      'delivery-edge-rate-expiry','delivery-edge-usage-references'].map(n=>'scripts/ci/'+n+'.mjs')]:sourcePaths;
    assert.deepEqual(Object.keys(sourceDigests).sort(),[...paths].sort());
    for(const digest of Object.values(sourceDigests))assert.match(digest??'',/^[a-f0-9]{64}$/);
    const json=async path=>{const bytes=await read(path);assert.ok(typeof bytes==='string'&&Buffer.byteLength(bytes)<=2*1024*1024);return JSON.parse(bytes);};
    const verify=({run,jobs,producer,consumer,log,now})=>{
      assert.equal(run.workflow_id,expectedWorkflowId);jobInventory(jobs);
      assert.equal(new Set(jobs.jobs.map(j=>j.id)).size,jobs.jobs.length);
      for(const job of jobs.jobs){assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,1);assert.equal(job.head_sha,run.head_sha);}
      for(const expected of [producer,consumer]) {
        const entries=jobs.jobs.filter(j=>j.name===expected.name);assert.equal(entries.length,1);assert.deepEqual(entries[0],expected);
      }
      hosted(consumer,run,consumerName);assert.notEqual(consumer.id,producer.id);
      assert.equal(consumer.status,'in_progress');assert.equal(consumer.conclusion,null);
      assert.equal(consumer.runner_name,env.RUNNER_NAME);
      assert.ok(time(producer.completed_at)<=time(consumer.started_at)&&time(consumer.started_at)<=now);
      return (usage?verifyPairedUsageCompletion:verifyPairedPhaseCompletion)({snapshot,snapshotSha256,phase,run,job:producer,log,now});
    };
    stage='EXECUTION';
    const runPath=`actions/runs/${snapshot.runId}`,jobsPath=runPath+'/attempts/1/jobs?per_page=100';
    const run=await json(runPath),jobs=await json(jobsPath);jobInventory(jobs);
    const producers=jobs.jobs.filter(j=>j.name===phase),consumers=jobs.jobs.filter(j=>j.name===consumerName);
    assert.equal(producers.length,1);assert.equal(consumers.length,1);
    for(const job of [...producers,...consumers])assert.ok(Number.isSafeInteger(job.id)&&job.id>0);
    const producerPath=`actions/jobs/${producers[0].id}`,consumerPath=`actions/jobs/${consumers[0].id}`;
    const producer=await json(producerPath),consumer=await json(consumerPath);
    stage='SOURCE';
    for(const path of paths) {
      const file=await json(`contents/${path}?ref=${snapshot.controlCommit}`);
      assert.equal(file.path,path);assert.equal(file.type,'file');assert.equal(file.encoding,'base64');
      assert.equal(typeof file.content,'string');const encoded=file.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
      assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,file.size);assert.equal(hash(bytes),sourceDigests[path]);
    }
    stage='LOG';const log=await read(producerPath+'/logs');
    stage='VERIFY';const firstNow=clock();verify({run,jobs,producer,consumer,log,now:firstNow});
    stage='FINAL_READBACK';const observedAt=clock();
    const finalRun=await json(runPath),finalJobs=await json(jobsPath),finalProducer=await json(producerPath),finalConsumer=await json(consumerPath);
    assert.deepEqual(runIdentity(finalRun),runIdentity(run));assert.deepEqual(jobInventory(finalJobs),jobInventory(jobs));
    assert.deepEqual(finalProducer,producer);
    for(const key of ['id','name','run_id','run_attempt','head_sha','status','conclusion','started_at','labels','runner_name'])assert.deepEqual(finalConsumer[key],consumer[key]);
    stage='FINAL_VERIFY';const now=clock();assert.ok(firstNow<=observedAt&&observedAt<=now);
    return {...verify({run:finalRun,jobs:finalJobs,producer:finalProducer,consumer:finalConsumer,log,now}),
      originVerified:true,consumerJobId:consumer.id,observedAt:new Date(observedAt).toISOString(),readFinishedAt:new Date(now).toISOString()};
  } catch {throw new Error('EDGE_PHASE_LOAD_'+stage);}
}

export function loadPairedPhaseCompletion(options) {return loadCompleted(options);}
export function loadPairedUsageCompletion(options) {
  return loadCompleted({read:path=>github(path,128*1024*1024),...options},true);
}
