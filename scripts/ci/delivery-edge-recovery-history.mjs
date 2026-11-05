import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';

const repository='KenLeeYa/Stallorder-Platform';
const originalPath='.github/workflows/production-delivery-edge-rehearsal.yml';
const recoveryPath='.github/workflows/production-delivery-edge-restore.yml';
const originalNames=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
const recoveryNames=['restore-intent','restore','verify'];
const bindingKeys=['originalWorkflowId','recoveryWorkflowId','originalRunId','currentRunId','controlCommit','snapshotSha256','phase'];
const sourcePaths=[originalPath,recoveryPath,'scripts/ci/delivery-edge-rehearsal-entry.mjs',
  'scripts/ci/delivery-edge-recovery-entry.mjs','scripts/ci/delivery-edge-recovery-history.mjs','scripts/ci/delivery-edge-usage.mjs','scripts/ci/delivery-edge-usage-recovery.mjs',
  'scripts/ci/delivery-edge-usage-fixture.mjs','scripts/ci/delivery-edge-usage-references.mjs'];
const terminal=['success','failure','cancelled','timed_out'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const runIdentity=run=>Object.fromEntries(['id','workflow_id','run_number','run_attempt','head_sha','head_branch',
  'event','path','status','conclusion','actor','triggering_actor','repository','head_repository','created_at'].map(k=>[k,run[k]]));
function instant(value) {
  assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const at=Date.parse(value);assert.ok(Number.isFinite(at));
  assert.equal(new Date(at).toISOString(),value.includes('.')?value:value.replace('Z','.000Z'));return at;
}
function integer(value) {assert.ok(Number.isSafeInteger(value)&&value>0);}
function validateBinding(binding) {
  assert.ok(binding&&typeof binding==='object'&&!Array.isArray(binding));
  assert.deepEqual(Object.keys(binding).sort(),[...bindingKeys].sort());
  for(const key of ['originalWorkflowId','recoveryWorkflowId','originalRunId','currentRunId'])integer(binding[key]);
  assert.notEqual(binding.originalWorkflowId,binding.recoveryWorkflowId);
  assert.notEqual(binding.originalRunId,binding.currentRunId);
  assert.match(binding.controlCommit??'',/^[a-f0-9]{40}$/);assert.match(binding.snapshotSha256??'',/^[a-f0-9]{64}$/);
  assert.ok(recoveryNames.includes(binding.phase));
}
function validateRun(run,binding,recovery,now) {
  integer(run.id);integer(run.run_number);assert.equal(run.run_attempt,1);
  assert.equal(run.workflow_id,recovery?binding.recoveryWorkflowId:binding.originalWorkflowId);
  assert.equal(run.path,recovery?recoveryPath:originalPath);assert.equal(run.head_sha,binding.controlCommit);
  assert.equal(run.head_branch,'main');assert.equal(run.event,'workflow_dispatch');
  for(const name of ['actor','triggering_actor'])assert.equal(run[name]?.login,'KenLeeYa');
  for(const repo of [run.repository,run.head_repository]) {
    assert.equal(repo?.id,1298874780);assert.equal(repo.full_name,repository);
    assert.equal(repo.private,false);assert.equal(repo.fork,false);
  }
  assert.ok(instant(run.created_at)<=now);
  if(recovery) {
    assert.equal(run.id,binding.currentRunId);assert.equal(run.run_number,1);
    assert.equal(run.status,'in_progress');assert.equal(run.conclusion,null);
    assert.ok(now-instant(run.created_at)<=6*3600000);
  } else {assert.equal(run.status,'completed');assert.ok(terminal.includes(run.conclusion));}
}
function inventory(value,key) {
  assert.ok(Number.isSafeInteger(value?.total_count)&&value.total_count>0&&value.total_count<=200);
  assert.ok(Array.isArray(value[key]));assert.equal(value[key].length,value.total_count);
  assert.equal(new Set(value[key].map(item=>item.id)).size,value.total_count);
}
function emptyJob(job) {
  assert.deepEqual(job.steps,[]);assert.deepEqual(job.labels,[]);assert.ok(!job.runner_name);
  assert.equal(job.started_at,null);assert.equal(job.completed_at,null);
}
function skippedJob(job,run,now) {
  assert.deepEqual(job.steps,[]);
  assert.ok(Array.isArray(job.labels));
  if(job.labels.length)assert.deepEqual(job.labels,['ubuntu-24.04']);
  for(const key of ['runner_name','runner_group_name'])assert.ok(job[key]==null||job[key]==='');
  for(const key of ['runner_id','runner_group_id'])assert.ok(job[key]==null);
  // Unassigned skipped jobs can retain labels and inverted scheduling times.
  // These are not execution intervals; each must still belong to this run.
  if(job.started_at===null&&job.completed_at===null)return;
  for(const value of [job.started_at,job.completed_at])assert.ok(instant(run.created_at)<=instant(value)&&instant(value)<=now);
}
function assignedJob(job,run,now) {
  assert.deepEqual(job.labels,['ubuntu-24.04']);assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
  assert.ok(instant(run.created_at)<=instant(job.started_at)&&instant(job.started_at)<=now);
  if(job.status==='completed')assert.ok(instant(job.started_at)<=instant(job.completed_at)&&instant(job.completed_at)<=now);
}
function jobsFor(execution,allowed,now) {
  const {run,jobs}=execution;inventory(jobs,'jobs');
  assert.ok(jobs.jobs.length<=allowed.length);assert.equal(new Set(jobs.jobs.map(j=>j.name)).size,jobs.jobs.length);
  for(const job of jobs.jobs) {
    integer(job.id);assert.ok(allowed.includes(job.name));assert.equal(job.run_id,run.id);
    assert.equal(job.run_attempt,1);assert.equal(job.head_sha,run.head_sha);
    if(job.status==='completed'&&job.conclusion==='skipped')skippedJob(job,run,now);
    else if(job.status==='completed'||job.status==='in_progress')assignedJob(job,run,now);
  }
  return jobs.jobs;
}
// Scoped global exclusion for the two independently pinned, one-use workflows.
// The protected caller also holds their shared Preview writer concurrency lock
// and binds the unchanged current protected control. This is not an account-wide
// claim that no unrelated operator can modify the provider.
export function verifyRecoveryHistory({binding,originalRuns,recoveryRuns,executions,now}) {
  validateBinding(binding);assert.ok(Number.isFinite(now));
  inventory(originalRuns,'workflow_runs');inventory(recoveryRuns,'workflow_runs');
  assert.equal(recoveryRuns.total_count,1);
  const originals=originalRuns.workflow_runs;
  assert.deepEqual(originals.map(r=>r.run_number).sort((a,b)=>a-b),originals.map((_,i)=>i+1));
  assert.equal(originals.find(r=>r.run_number===1)?.id,binding.originalRunId);
  assert.ok(Array.isArray(executions));assert.equal(executions.length,originals.length+1);
  assert.equal(new Set(executions.map(e=>e.run.id)).size,executions.length);
  for(const [recovery,runs] of [[false,originals],[true,recoveryRuns.workflow_runs]]) {
    for(const listed of runs) {
      const execution=executions.find(e=>e.run.id===listed.id);assert.ok(execution);
      assert.deepEqual(runIdentity(execution.run),runIdentity(listed));
      validateRun(execution.run,binding,recovery,now);
      const jobs=jobsFor(execution,recovery?recoveryNames:originalNames,now);
      if(!recovery) {
        assert.deepEqual(jobs.map(j=>j.name).sort(),[...originalNames].sort());
        for(const job of jobs) {assert.equal(job.status,'completed');assert.ok([...terminal,'skipped'].includes(job.conclusion));}
        if(listed.id!==binding.originalRunId) {
          // The reviewed original snapshot phase has no mutation; every later
          // phase must have been skipped by its failed one-use admission.
          assert.ok(['failure','cancelled','timed_out'].includes(jobs.find(j=>j.name==='snapshot').conclusion));
          for(const job of jobs.filter(j=>j.name!=='snapshot'))assert.equal(job.conclusion,'skipped');
        }
        continue;
      }
      const current=recoveryNames.indexOf(binding.phase);let previousEnd=instant(listed.created_at);
      for(const [index,name] of recoveryNames.entries()) {
        const job=jobs.find(j=>j.name===name);
        if(index<=current) {
          assert.ok(job);assert.ok(previousEnd<=instant(job.started_at));
          if(index<current) {
            assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');previousEnd=instant(job.completed_at);
          } else {assert.equal(job.status,'in_progress');assert.equal(job.conclusion,null);assert.equal(job.completed_at,null);}
        } else if(job) {
          assert.ok(['queued','waiting','pending','requested'].includes(job.status));assert.equal(job.conclusion,null);emptyJob(job);
        }
      }
    }
  }
  const currentJob=executions.find(e=>e.run.id===binding.currentRunId).jobs.jobs.find(j=>j.name===binding.phase);
  return {schema:'stallorder-paired-recovery-history/v1',...Object.fromEntries(bindingKeys.map(key=>[key,binding[key]])),
    historyVerified:true,originVerified:false,
    currentJobId:currentJob.id,originalRunCount:originals.length,recoveryRunCount:1,
    mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
}
function github(path) {
  return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,
    stdio:['ignore','pipe','pipe']});
}
function validateExecutor(env,binding) {
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_OWNER:'KenLeeYa',
    GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_SHA:binding.controlCommit,GITHUB_RUN_ID:String(binding.currentRunId),GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:binding.phase,
    GITHUB_WORKFLOW_REF:repository+'/'+recoveryPath+'@refs/heads/main',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux'}))assert.equal(env[key],value);
  assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);
}
export async function loadRecoveryHistory({binding,sourceDigests,env=process.env,read=github,clock=Date.now}) {
  try {
    binding=structuredClone(binding);sourceDigests=structuredClone(sourceDigests);env={...env};
    validateBinding(binding);validateExecutor(env,binding);
    assert.deepEqual(Object.keys(sourceDigests).sort(),[...sourcePaths].sort());
    for(const digest of Object.values(sourceDigests))assert.match(digest,/^[a-f0-9]{64}$/);
    const json=async path=>{const raw=await read(path);assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024);return JSON.parse(raw);};
    const pages=async id=>{
      const items=[];let total;
      for(let page=1;page<=2;page++) {
        const part=await json(`actions/workflows/${id}/runs?per_page=100&page=${page}`);
        assert.ok(Number.isSafeInteger(part.total_count)&&part.total_count>0&&part.total_count<=200);
        if(total===undefined)total=part.total_count;else assert.equal(part.total_count,total);
        assert.ok(Array.isArray(part.workflow_runs));assert.equal(part.workflow_runs.length,Math.min(100,total-items.length));
        items.push(...part.workflow_runs);if(items.length===total)break;
      }
      const result={total_count:total,workflow_runs:items};inventory(result,'workflow_runs');return result;
    };
    const collect=async()=>{
      const originalRuns=await pages(binding.originalWorkflowId),recoveryRuns=await pages(binding.recoveryWorkflowId),executions=[];
      for(const listed of [...originalRuns.workflow_runs,...recoveryRuns.workflow_runs]) {
        integer(listed.id);
        const run=await json(`actions/runs/${listed.id}`);
        // Repeated attempts are rejected, never reduced to an attempt-1 page.
        assert.equal(run.run_attempt,1);
        const jobs=await json(`actions/runs/${listed.id}/attempts/1/jobs?per_page=100`);
        executions.push({run,jobs});
      }
      const at=clock(),input={binding,originalRuns,recoveryRuns,executions,now:at};
      verifyRecoveryHistory(input);
      const current=executions.find(e=>e.run.id===binding.currentRunId).jobs.jobs.find(j=>j.name===binding.phase);
      assert.equal(current.runner_name,env.RUNNER_NAME);return input;
    };
    const initial=await collect();
    for(const path of sourcePaths) {
      const source=await json(`contents/${path}?ref=${binding.controlCommit}`);
      assert.equal(source.path,path);assert.equal(source.type,'file');assert.equal(source.encoding,'base64');
      assert.equal(typeof source.content,'string');const encoded=source.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
      assert.equal(bytes.toString('base64'),encoded);assert.equal(bytes.length,source.size);assert.equal(hash(bytes),sourceDigests[path]);
    }
    const observedAt=clock(),final=await collect();assert.ok(initial.now<=observedAt&&observedAt<=final.now);
    const stable=value=>({originalRuns:value.originalRuns.workflow_runs.map(runIdentity),
      recoveryRuns:value.recoveryRuns.workflow_runs.map(runIdentity),
      executions:value.executions.map(e=>({run:runIdentity(e.run),jobs:e.jobs}))});
    assert.deepEqual(stable(final),stable(initial));
    return {...verifyRecoveryHistory(final),originVerified:true,historySha256:hash(JSON.stringify(stable(final))),
      observedAt:new Date(observedAt).toISOString(),readFinishedAt:new Date(final.now).toISOString()};
  } catch {throw new Error('EDGE_RECOVERY_HISTORY_REJECTED');}
}
