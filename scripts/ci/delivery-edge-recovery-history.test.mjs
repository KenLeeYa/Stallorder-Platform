import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyRecoveryHistory, loadRecoveryHistory} from './delivery-edge-recovery-history.mjs';

const originalPath='.github/workflows/production-delivery-edge-rehearsal.yml';
const recoveryPath='.github/workflows/production-delivery-edge-restore.yml';
const originalNames=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
const recoveryNames=['restore-intent','restore','verify'];
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(extraRuns=0,phase='restore-intent') {
  const controlCommit='a'.repeat(40),repo={id:1298874780,full_name:'KenLeeYa/Stallorder-Platform',private:false,fork:false};
  const binding={originalWorkflowId:90,recoveryWorkflowId:91,originalRunId:100,currentRunId:200,
    controlCommit,snapshotSha256:'b'.repeat(64),phase};
  const base={run_attempt:1,head_sha:controlCommit,head_branch:'main',event:'workflow_dispatch',
    actor:{login:'KenLeeYa'},triggering_actor:{login:'KenLeeYa'},repository:repo,head_repository:repo,
    created_at:'2026-11-05T10:00:00Z'};
  const original={...base,id:100,workflow_id:90,run_number:1,path:originalPath,status:'completed',conclusion:'failure'};
  const recovery={...base,id:200,workflow_id:91,run_number:1,path:recoveryPath,status:'in_progress',conclusion:null,
    created_at:'2026-11-05T11:00:00Z'};
  const jobs=(run,names)=>({total_count:names.length,jobs:names.map((name,i)=>({id:run.id*10+i,
    run_id:run.id,run_attempt:1,head_sha:controlCommit,name,status:'completed',conclusion:'skipped',steps:[],
    labels:[],runner_name:null,started_at:null,completed_at:null}))});
  const originalJobs=jobs(original,originalNames);
  const finish=(job,start,end,conclusion='success')=>Object.assign(job,{status:'completed',conclusion,
    labels:['ubuntu-24.04'],runner_name:'GitHub Actions 1',started_at:start,completed_at:end,
    steps:[{name:'reviewed step',number:1,status:'completed',conclusion,started_at:start,completed_at:end}]});
  finish(originalJobs.jobs[0],'2026-11-05T10:00:01Z','2026-11-05T10:01:00Z');
  const currentJobs=jobs(recovery,recoveryNames);
  const index=recoveryNames.indexOf(phase);
  for(let i=0;i<index;i++) finish(currentJobs.jobs[i],`2026-11-05T11:0${i}:01Z`,`2026-11-05T11:0${i}:30Z`);
  Object.assign(currentJobs.jobs[index],{status:'in_progress',conclusion:null,labels:['ubuntu-24.04'],
    runner_name:'GitHub Actions 2',started_at:`2026-11-05T11:0${index}:31Z`,completed_at:null});
  for(let i=index+1;i<currentJobs.jobs.length;i++) Object.assign(currentJobs.jobs[i],{status:'queued',conclusion:null});
  const originalRuns={total_count:1,workflow_runs:[original]};
  const recoveryRuns={total_count:1,workflow_runs:[recovery]};
  const executions=[{run:original,jobs:originalJobs},{run:recovery,jobs:currentJobs}];
  for(let i=0;i<extraRuns;i++) {
    const run={...structuredClone(original),id:300+i,run_number:i+2};
    const inventory=jobs(run,originalNames);
    finish(inventory.jobs[0],'2026-11-05T10:02:00Z','2026-11-05T10:03:00Z','failure');
    originalRuns.workflow_runs.unshift(run);originalRuns.total_count++;
    executions.push({run,jobs:inventory});
  }
  return {binding,originalRuns,recoveryRuns,executions,now:Date.parse('2026-11-05T11:05:00Z')};
}
test('retains the old backup identity and excludes prior recovery without granting a write',()=>{
  const f=fixture(2),r=verifyRecoveryHistory(f);
  assert.equal(r.historyVerified,true);assert.equal(r.originVerified,false);
  assert.equal(r.originalRunId,100);assert.equal(r.currentRunId,200);assert.equal(r.originalRunCount,3);
  for(const key of ['mutationAuthorized','cleanupVerified','productQualified','releaseAuthorized'])assert.equal(r[key],false);
});
for(const phase of recoveryNames)test('binds the current fixed recovery phase '+phase,()=>{
  const f=fixture(0,phase);assert.equal(verifyRecoveryHistory(f).phase,phase);
});
for(const [label,change] of [
  ['unexpected private binding field',f=>{f.binding.privateToken='synthetic-private-sentinel';}],
  ['missing page',f=>{f.originalRuns.total_count++;}],
  ['deleted run number',f=>{f.originalRuns.workflow_runs[0].run_number=4;}],
  ['duplicate run',f=>{f.originalRuns.workflow_runs[0]=f.originalRuns.workflow_runs[1];}],
  ['original rerun',f=>{f.executions[0].run.run_attempt=2;}],
  ['recovery rerun',f=>{f.executions[1].run.run_attempt=2;}],
  ['prior recovery',f=>{f.executions[1].run.run_number=2;}],
  ['another recovery',f=>{f.recoveryRuns.workflow_runs.push({...f.executions[1].run,id:999,run_number:2});f.recoveryRuns.total_count++;}],
  ['active original writer',f=>{f.executions[0].run.status='in_progress';}],
  ['unknown source',f=>{f.executions[2].run.head_sha='d'.repeat(40);}],
  ['nonowner trigger',f=>{f.executions[1].run.triggering_actor.login='another';}],
  ['foreign repository',f=>{f.executions[1].run.repository.id=7;}],
  ['changed immutable workflow id',f=>{f.binding.originalWorkflowId=999;}],
  ['same workflow id',f=>{f.binding.recoveryWorkflowId=90;}],
  ['missing job',f=>{f.executions[2].jobs.jobs.pop();}],
  ['extra original consumer',f=>{f.executions[2].jobs.jobs[2].conclusion='success';}],
  ['later snapshot succeeded',f=>{f.executions[2].jobs.jobs[0].conclusion='success';}],
  ['skipped job with steps',f=>{f.executions[2].jobs.jobs[2].steps=[{}];}],
  ['self hosted current runner',f=>{f.executions[1].jobs.jobs[0].labels=['self-hosted'];}],
  ['earlier phase still running',f=>{f.binding.phase='restore';}],
  ['future phase already started',f=>{f.executions[1].jobs.jobs[1].status='in_progress';}],
  ['future run creation',f=>{f.executions[1].run.created_at='2026-11-06T11:00:00Z';}],
  ['stale recovery invocation',f=>{f.now+=7*3600000;}],
])test('refuses '+label,()=>{const f=fixture(2);change(f);assert.throws(()=>verifyRecoveryHistory(f));});

function loaderFixture(extraRuns=0) {
  const f=fixture(extraRuns),calls=[],counts=new Map();
  const sources={
    [originalPath]:'reviewed original workflow',
    [recoveryPath]:'reviewed recovery workflow',
    'scripts/ci/delivery-edge-rehearsal-entry.mjs':'reviewed original entry',
    'scripts/ci/delivery-edge-recovery-entry.mjs':'reviewed recovery entry',
    'scripts/ci/delivery-edge-recovery-history.mjs':'reviewed history loader',
    'scripts/ci/delivery-edge-usage.mjs':'reviewed scoped cleanup',
    'scripts/ci/delivery-edge-usage-recovery.mjs':'reviewed ownership discovery',
    'scripts/ci/delivery-edge-usage-fixture.mjs':'reviewed fixture identity',
    'scripts/ci/delivery-edge-usage-references.mjs':'reviewed inbound ownership',
  };
  const sourceDigests=Object.fromEntries(Object.entries(sources).map(([p,b])=>[p,sha(b)]));
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
    GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_SHA:f.binding.controlCommit,
    GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'200',GITHUB_RUN_ATTEMPT:'1',
    GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/'+recoveryPath+'@refs/heads/main',GITHUB_JOB:'restore-intent',
    RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 2'};
  const read=async p=>{
    calls.push(p);counts.set(p,(counts.get(p)??0)+1);
    let match=/^actions\/workflows\/(90|91)\/runs\?per_page=100&page=([1-9][0-9]*)$/.exec(p);
    if(match){const inv=match[1]==='90'?f.originalRuns:f.recoveryRuns,offset=(Number(match[2])-1)*100;
      return JSON.stringify({...inv,workflow_runs:inv.workflow_runs.slice(offset,offset+100)});}
    match=/^actions\/runs\/([1-9][0-9]*)(\/attempts\/1\/jobs\?per_page=100)?$/.exec(p);
    if(match){const item=f.executions.find(e=>e.run.id===Number(match[1]));assert.ok(item,p);return JSON.stringify(match[2]?item.jobs:item.run);}
    match=/^contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(p);
    if(match){assert.equal(match[2],f.binding.controlCommit);const bytes=Buffer.from(sources[match[1]]);
      return JSON.stringify({path:match[1],type:'file',encoding:'base64',content:bytes.toString('base64'),size:bytes.length});}
    throw new Error('Unexpected read '+p);
  };
  return {f,calls,counts,sources,input:{binding:f.binding,sourceDigests,env,read,clock:()=>f.now}};
}
test('loads every page and rereads authenticated history after source reads',async()=>{
  const f=loaderFixture(100),r=await loadRecoveryHistory(f.input);
  assert.equal(r.originVerified,true);assert.equal(r.originalRunCount,101);
  assert.equal(f.counts.get('actions/workflows/90/runs?per_page=100&page=2'),2);
  assert.equal(r.mutationAuthorized,false);assert.equal(r.productQualified,false);
});
test('loader rejects unexpected binding fields before any provider read',async()=>{
  const f=loaderFixture();f.input.binding.privateToken='synthetic-private-sentinel';
  await assert.rejects(loadRecoveryHistory(f.input),{message:'EDGE_RECOVERY_HISTORY_REJECTED'});
  assert.equal(f.calls.length,0);
});
for(const [label,change] of [
  ['wrong current executor',f=>{f.input.env.RUNNER_NAME='GitHub Actions 99';}],
  ['missing source pin',f=>{delete f.input.sourceDigests[recoveryPath];}],
  ['changed source bytes',f=>{f.sources[recoveryPath]+='changed';}],
  ['truncated second page',f=>{const base=f.input.read;f.input.read=async p=>{
    const raw=await base(p);if(p.endsWith('page=2')){const v=JSON.parse(raw);v.workflow_runs=[];return JSON.stringify(v);}return raw;};}],
  ['new run during source read',f=>{const base=f.input.read;f.input.read=async p=>{
    const raw=await base(p);if(p.startsWith('actions/workflows/91/')&&f.counts.get(p)>1){const v=JSON.parse(raw);v.total_count++;return JSON.stringify(v);}return raw;};}],
  ['job changed at final readback',f=>{const base=f.input.read;f.input.read=async p=>{
    const raw=await base(p);if(p==='actions/runs/200/attempts/1/jobs?per_page=100'&&f.counts.get(p)>1){const v=JSON.parse(raw);v.jobs[0].runner_name='GitHub Actions 99';return JSON.stringify(v);}return raw;};}],
  ['provider failure never leaks diagnostics',f=>{f.input.read=async()=>{throw new Error('private-provider-detail');};}],
])test('loader refuses '+label,async()=>{
  const f=loaderFixture(label==='truncated second page'?100:0);change(f);
  await assert.rejects(loadRecoveryHistory(f.input),{message:'EDGE_RECOVERY_HISTORY_REJECTED'});
});

// Observed GitHub skipped jobs retain configured labels and scheduling timestamps.
test('admits native skipped job metadata without treating scheduling times as execution',()=>{
 const f=fixture(1);for(const e of f.executions)for(const j of e.jobs.jobs)if(j.conclusion==='skipped')Object.assign(j,{labels:['ubuntu-24.04'],runner_id:null,runner_group_id:null,runner_group_name:null,started_at:'2026-11-05T10:04:01Z',completed_at:'2026-11-05T10:04:00Z'});
 assert.equal(verifyRecoveryHistory(f).historyVerified,true);
});

test('skipped job rejects assigned runner id',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.runner_id=42;assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects assigned group id',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.runner_group_id=1;assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects runner name',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.runner_name='GitHub Actions 9';assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects group name',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.runner_group_name='Default';assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects execution steps',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.steps=[{name:'unexpected'}];assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects foreign configured runner',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.labels=['self-hosted'];assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects extra configured runner',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.labels=['ubuntu-24.04','self-hosted'];assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects missing scheduling time',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.started_at=null;j.completed_at='2026-11-05T10:00:01Z';assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects pre-run scheduling time',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.started_at='2026-11-04T10:00:00Z';j.completed_at=j.started_at;assert.throws(()=>verifyRecoveryHistory(f));});
test('skipped job rejects future scheduling time',()=>{const f=fixture();const j=f.executions[0].jobs.jobs.find(j=>j.conclusion==='skipped');j.started_at='2026-11-06T10:00:00Z';j.completed_at=j.started_at;assert.throws(()=>verifyRecoveryHistory(f));});
