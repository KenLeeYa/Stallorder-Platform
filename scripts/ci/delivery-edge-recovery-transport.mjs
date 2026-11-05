import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';

const repository='KenLeeYa/Stallorder-Platform';
const workflow='.github/workflows/production-delivery-edge-restore.yml';
const paths=[workflow,'scripts/ci/delivery-edge-recovery-entry.mjs','scripts/ci/delivery-edge-recovery-transport.mjs',
  'scripts/ci/delivery-edge-recovery-plan.mjs','scripts/ci/delivery-edge-recovery-history.mjs'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const integer=value=>assert.ok(Number.isSafeInteger(value)&&value>0);
const keys=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
function instant(value) {
  assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const at=Date.parse(value);assert.ok(Number.isFinite(at));
  assert.equal(new Date(at).toISOString(),value.includes('.')?value:value.replace('Z','.000Z'));return at;
}
function bind(binding) {
  keys(binding,['controlCommit','originalRunId','currentRunId','originalWorkflowId','recoveryWorkflowId','snapshotSha256','phase']);
  for(const k of ['originalRunId','currentRunId','originalWorkflowId','recoveryWorkflowId'])integer(binding[k]);
  assert.notEqual(binding.originalRunId,binding.currentRunId);assert.notEqual(binding.originalWorkflowId,binding.recoveryWorkflowId);
  assert.match(binding.controlCommit??'',/^[a-f0-9]{40}$/);assert.match(binding.snapshotSha256??'',/^[a-f0-9]{64}$/);
  assert.ok(['restore','verify'].includes(binding.phase));
}
function planIdentity(plan,binding) {
  keys(plan,['schema','project','controlCommit','originalRunId','originalRunAttempt','recoveryRunId','recoveryRunAttempt',
    'originalWorkflowId','recoveryWorkflowId','snapshotSha256','originalSnapshotFinishedAt','journalSha256','untouched','restored',
    'preimages','operations','recoveryOnly','mutationAuthorized','cleanupVerified','productQualified','releaseAuthorized']);
  for(const [key,value] of Object.entries({schema:'stallorder-paired-recovery-intent/v1',project:'teunnvfakbfzmodajqjz',
    controlCommit:binding.controlCommit,originalRunId:String(binding.originalRunId),originalRunAttempt:1,
    recoveryRunId:String(binding.currentRunId),recoveryRunAttempt:1,originalWorkflowId:binding.originalWorkflowId,
    recoveryWorkflowId:binding.recoveryWorkflowId,snapshotSha256:binding.snapshotSha256,recoveryOnly:true,
    mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false}))assert.equal(plan[key],value);
  instant(plan.originalSnapshotFinishedAt);assert.match(plan.journalSha256??'',/^[a-f0-9]{64}$/);
  for(const names of [plan.untouched,plan.restored,plan.operations.map(op=>op.slug)]) {
    assert.ok(Array.isArray(names));assert.equal(new Set(names).size,names.length);
    assert.deepEqual(names,EDGE_SLUGS.filter(slug=>names.includes(slug)));
  }
  assert.deepEqual([...plan.untouched,...plan.restored,...plan.operations.map(op=>op.slug)].sort(),[...EDGE_SLUGS].sort());
  assert.deepEqual(plan.preimages.map(r=>r.slug),EDGE_SLUGS);
  for(const record of plan.preimages){keys(record,['slug','sha256']);assert.match(record.sha256,/^[a-f0-9]{64}$/);}
  for(const op of plan.operations) {
    keys(op,['operationId','slug','id','expectedVersion','resultVersion','expectedSource','targetSource']);
    assert.match(op.operationId,/^[a-f0-9]{64}$/);assert.match(op.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    integer(op.expectedVersion);integer(op.resultVersion);assert.equal(op.resultVersion,op.expectedVersion+1);
    for(const source of [op.expectedSource,op.targetSource]) {
      keys(source,['wireSha256','entrypoint_path','import_map_path','import_map']);assert.match(source.wireSha256,/^[a-f0-9]{64}$/);
      assert.ok(source.import_map===null||typeof source.import_map==='boolean');
      for(const key of ['entrypoint_path','import_map_path'])assert.ok(typeof source[key]==='string'&&source[key].length>0&&source[key].length<4096&&!/[\x00-\x1f\x7f]/.test(source[key]));
    }
  }
  assert.equal(new Set(plan.operations.map(op=>op.operationId)).size,plan.operations.length);
  assert.equal(new Set(plan.operations.map(op=>op.id)).size,plan.operations.length);
}
function hosted(job,run,name) {
  integer(job.id);assert.equal(job.name,name);assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,1);
  assert.equal(job.head_sha,run.head_sha);assert.deepEqual(job.labels,['ubuntu-24.04']);
  assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
}
// Proves a completed source-bound producer, not a write grant. The native entry
// must also authenticate the original encrypted snapshot/journal, exclude prior
// recovery and compare the plan with all five live preimages before each write.
export function verifyRecoveryProducer({binding,mode,plan,run,producer,consumer,jobs,log,now}) {
  bind(binding);assert.ok(['intent','completion'].includes(mode));
  if(mode==='completion')assert.equal(binding.phase,'verify');
  const producerName=mode==='intent'?'restore-intent':'restore';
  for(const repo of [run.repository,run.head_repository]) {
    assert.equal(repo?.id,1298874780);assert.equal(repo.full_name,repository);assert.equal(repo.private,false);assert.equal(repo.fork,false);
  }
  for(const [key,value] of Object.entries({id:binding.currentRunId,workflow_id:binding.recoveryWorkflowId,run_number:1,run_attempt:1,
    head_sha:binding.controlCommit,head_branch:'main',path:workflow,event:'workflow_dispatch',status:'in_progress',conclusion:null}))assert.equal(run[key],value);
  for(const k of ['actor','triggering_actor'])assert.equal(run[k]?.login,'KenLeeYa');
  assert.ok(Number.isFinite(now)&&instant(run.created_at)<=now&&now-instant(run.created_at)<=6*3600000);
  hosted(producer,run,producerName);hosted(consumer,run,binding.phase);assert.notEqual(producer.id,consumer.id);
  assert.equal(producer.status,'completed');assert.equal(producer.conclusion,'success');
  assert.equal(consumer.status,'in_progress');assert.equal(consumer.conclusion,null);assert.equal(consumer.completed_at,null);
  const start=instant(producer.started_at),end=instant(producer.completed_at);
  assert.ok(instant(run.created_at)<=start&&start<=end&&end<=instant(consumer.started_at)&&instant(consumer.started_at)<=now);
  assert.ok(Array.isArray(jobs.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.jobs.length<=3);
  assert.equal(new Set(jobs.jobs.map(j=>j.id)).size,jobs.jobs.length);assert.equal(new Set(jobs.jobs.map(j=>j.name)).size,jobs.jobs.length);
  for(const j of jobs.jobs){integer(j.id);assert.ok(['restore-intent','restore','verify'].includes(j.name));assert.equal(j.run_id,run.id);assert.equal(j.run_attempt,1);assert.equal(j.head_sha,run.head_sha);}
  for(const j of [producer,consumer])assert.deepEqual(jobs.jobs.find(item=>item.name===j.name),j);
  assert.ok(Array.isArray(producer.steps));assert.equal(new Set(producer.steps.map(s=>s.name)).size,producer.steps.length);
  let previousNumber=0,previousEnd=start;
  for(const step of producer.steps) {
    integer(step.number);assert.ok(step.number>previousNumber);previousNumber=step.number;assert.equal(step.status,'completed');
    if(step.conclusion==='skipped'){assert.ok(step.name.startsWith('Post Run actions/setup-node@'));continue;}
    assert.equal(step.conclusion,'success');const a=instant(step.started_at),b=instant(step.completed_at);
    assert.ok(previousEnd<=a&&a<=b&&b<=end);previousEnd=b;
  }
  const stepName=mode==='intent'?'Persist immutable independent recovery intent':'Restore exact interrupted Edge preimages once';
  const guard=producer.steps.find(s=>s.name==='Require current protected control and identical verified staging tree');
  const output=producer.steps.find(s=>s.name===stepName);assert.ok(guard&&output&&guard.number<output.number);
  assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=2*1024*1024);
  const eventName=mode==='intent'?'paired-edge-recovery-intent':'paired-edge-recovery-complete',records=[];
  let previousAt=instant(output.started_at);
  for(const line of log.split(/\r?\n/)) {
    const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if(!match){assert.ok(!line.includes('paired-edge-'));continue;}
    let event;try {event=JSON.parse(match[2]);} catch {assert.ok(!match[2].includes('paired-edge-'));continue;}
    if(typeof event?.event!=='string'||!event.event.startsWith('paired-edge-'))continue;
    const at=instant(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
    assert.ok(previousAt<=at&&at<instant(output.completed_at)+1000&&at<=now);previousAt=at;records.push(event);
  }
  const event=records.at(-1);assert.equal(event?.event,eventName);
  if(mode==='intent') {
    assert.equal(records.length,1);
    keys(event,['event','plan','planSha256']);planIdentity(event.plan,binding);assert.equal(event.planSha256,digest(event.plan));
    if(plan!==undefined)assert.deepEqual(event.plan,plan);
    plan=event.plan;
  } else {
    planIdentity(plan,binding);keys(event,['event','receipt']);
    const expectedEvents=plan.operations.flatMap(op=>[
      {event:'paired-edge-recovery-operation-started',operationId:op.operationId,slug:op.slug,expectedVersion:op.expectedVersion,resultVersion:op.resultVersion},
      {event:'paired-edge-recovery-operation-verified',operationId:op.operationId,slug:op.slug,version:op.resultVersion,wireSha256:op.targetSource.wireSha256}]);
    assert.deepEqual(records.slice(0,-1),expectedEvents);
    const operations=plan.operations.map(op=>op.slug);
    assert.deepEqual(event.receipt,{schema:'stallorder-paired-recovery-execution/v1',project:plan.project,controlCommit:plan.controlCommit,
      originalRunId:plan.originalRunId,recoveryRunId:plan.recoveryRunId,snapshotSha256:plan.snapshotSha256,planSha256:digest(plan),
      attempted:operations,verified:operations,complete:true,edgeStateRestored:true,cleanupVerified:false,productQualified:false,releaseAuthorized:false});
  }
  return {schema:'stallorder-paired-recovery-producer/v1',mode,plan,planSha256:digest(plan),producerJobId:producer.id,
    consumerJobId:consumer.id,logSha256:hash(log),originVerified:false,requiresRecoveryHistory:true,
    mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
}
function github(path) {
  return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
}
export async function loadRecoveryProducer({binding,mode,plan,sourceDigests,env=process.env,read=github,clock=Date.now}) {
  try {
    binding=structuredClone(binding);plan=structuredClone(plan);sourceDigests=structuredClone(sourceDigests);env={...env};bind(binding);
    for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_OWNER:'KenLeeYa',
      GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_SHA:binding.controlCommit,
      GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:String(binding.currentRunId),GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:binding.phase,
      GITHUB_WORKFLOW_REF:repository+'/'+workflow+'@refs/heads/main',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux'}))assert.equal(env[key],value);
    assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);assert.ok(['intent','completion'].includes(mode));
    keys(sourceDigests,paths);for(const d of Object.values(sourceDigests))assert.match(d,/^[a-f0-9]{64}$/);
    const json=async p=>{const raw=await read(p);assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024);return JSON.parse(raw);};
    const runPath=`actions/runs/${binding.currentRunId}`,jobsPath=runPath+'/attempts/1/jobs?per_page=100';
    const run=await json(runPath),jobs=await json(jobsPath);
    const p=jobs.jobs.filter(j=>j.name===(mode==='intent'?'restore-intent':'restore')),c=jobs.jobs.filter(j=>j.name===binding.phase);
    assert.equal(p.length,1);assert.equal(c.length,1);integer(p[0].id);integer(c[0].id);
    const producerPath=`actions/jobs/${p[0].id}`,consumerPath=`actions/jobs/${c[0].id}`;
    const producer=await json(producerPath),consumer=await json(consumerPath);assert.equal(consumer.runner_name,env.RUNNER_NAME);
    for(const path of paths) {
      const file=await json(`contents/${path}?ref=${binding.controlCommit}`);
      assert.equal(file.path,path);assert.equal(file.type,'file');assert.equal(file.encoding,'base64');
      const encoded=file.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
      assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,file.size);assert.equal(hash(bytes),sourceDigests[path]);
    }
    const log=await read(producerPath+'/logs'),first=clock();
    verifyRecoveryProducer({binding,mode,plan,run,producer,consumer,jobs,log,now:first});
    const finalRun=await json(runPath),finalJobs=await json(jobsPath),finalProducer=await json(producerPath),finalConsumer=await json(consumerPath);
    for(const key of ['id','workflow_id','run_number','run_attempt','head_sha','head_branch','path','event','status','conclusion','actor','triggering_actor','repository','head_repository','created_at'])assert.deepEqual(finalRun[key],run[key]);
    assert.deepEqual(finalProducer,producer);
    for(const key of ['id','name','run_id','run_attempt','head_sha','status','conclusion','started_at','completed_at','labels','runner_name'])assert.deepEqual(finalConsumer[key],consumer[key]);
    const names=value=>value.jobs.map(j=>({id:j.id,name:j.name})).sort((a,b)=>a.id-b.id);assert.deepEqual(names(finalJobs),names(jobs));
    const now=clock();assert.ok(first<=now);
    return {...verifyRecoveryProducer({binding,mode,plan,run:finalRun,jobs:finalJobs,producer:finalProducer,consumer:finalConsumer,log,now}),
      originVerified:true,observedAt:new Date(first).toISOString(),readFinishedAt:new Date(now).toISOString()};
  } catch {throw new Error('EDGE_RECOVERY_PRODUCER_REJECTED');}
}
