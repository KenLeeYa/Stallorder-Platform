import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';
import {buildPairedIntent,verifyInterruptedPairedJournal} from './delivery-edge-intent.mjs';
import {decodePairedUsageEvidence} from './delivery-edge-usage-evidence.mjs';
import {loadPairedInterruptedJournal} from './delivery-edge-paired-load.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const workflow='.github/workflows/production-delivery-edge-rehearsal.yml';
const sourcePaths=[workflow,...['delivery-edge-rehearsal-entry','delivery-edge-intent','delivery-edge-usage-evidence',
  'delivery-edge-usage','delivery-edge-usage-fixture','delivery-edge-rate-expiry','delivery-edge-usage-references'].map(n=>'scripts/ci/'+n+'.mjs')];
const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
const guard='Require current protected control and identical verified staging tree';
const usageStep='Run five real Edge calls and verify owned cleanup';
const verifyStep='Verify restored bytes and authenticated usage receipts';
function time(value) {
  assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const n=Date.parse(value);assert.ok(Number.isFinite(n));
  assert.equal(new Date(n).toISOString(),value.includes('.')?value:value.replace('Z','.000Z'));return n;
}
function successfulJob(job,now) {
  assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');
  assert.deepEqual(job.labels,['ubuntu-24.04']);assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
  assert.ok(Number.isSafeInteger(job.runner_id)&&job.runner_id>0);
  assert.equal(job.runner_group_id,0);assert.equal(job.runner_group_name,'GitHub Actions');
  assert.ok(Array.isArray(job.steps)&&new Set(job.steps.map(s=>s.name)).size===job.steps.length);
  let previousNumber=0,previousEnd=time(job.started_at);const end=time(job.completed_at);assert.ok(end<=now);
  for(const step of job.steps) {
    assert.ok(Number.isSafeInteger(step.number)&&previousNumber<step.number);previousNumber=step.number;
    assert.equal(step.status,'completed');
    if(step.conclusion==='skipped'){assert.ok(step.name.startsWith('Post Run actions/setup-node@'));continue;}
    assert.equal(step.conclusion,'success');const start=time(step.started_at),finish=time(step.completed_at);
    assert.ok(previousEnd<=start&&start<=finish&&finish<=end);previousEnd=finish;
  }
  assert.equal(job.steps.find(s=>s.name===guard)?.conclusion,'success');
}
function eventsInStep(job,log,stepName,prefix,now,maxBytes) {
  const step=job.steps.find(s=>s.name===stepName),guardStep=job.steps.find(s=>s.name===guard);
  assert.ok(step&&guardStep.number<step.number);assert.equal(step.conclusion,'success');
  assert.ok(typeof log==='string'&&Buffer.byteLength(log)>0&&Buffer.byteLength(log)<=maxBytes);
  const events=[],times=[];let last=time(step.started_at);
  for(const line of log.split(/\r?\n/)) {
    const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if(!match){assert.ok(!line.includes(prefix)&&!line.includes('paired-edge-entry-failed')&&!line.includes('paired-edge-rehearsal-incomplete'));continue;}
    const event=JSON.parse(match[2]);
    assert.ok(!['paired-edge-entry-failed','paired-edge-rehearsal-incomplete'].includes(event?.event));
    if(typeof event?.event!=='string'||!event.event.startsWith(prefix))continue;
    const at=time(match[1].replace(/(\.\d{3})\d{4}Z$/,'$1Z'));
    assert.ok(last<=at&&at<time(step.completed_at)+1000&&at<=now);last=at;events.push(event);times.push(at);
  }
  assert.ok(events.length>0);return {step,events,times};
}

// Terminal interpretation only: never forge an in-progress run to reuse a
// same-run phase loader. App compatibility and current provider state are separate.
function verifyCompleted({snapshot,snapshotSha256,expectedWorkflowId,run,jobs,logs,now}) {
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
  assert.ok(Number.isFinite(now)&&time(run.created_at)<=now&&now-time(run.created_at)<=6*3600000);
  const journal=verifyInterruptedPairedJournal({snapshot,snapshotSha256,expectedWorkflowId,run,jobs,logs,now});
  for(const phase of ['replay','restore'])assert.equal(journal.phases[phase].complete,true);
  for(const job of jobs)successfulJob(job,now);
  const byName=name=>jobs.find(j=>j.name===name),summaries={};
  for(const phase of ['replay','restore']) {
    const job=byName(phase),plan=buildPairedIntent({snapshot,snapshotSha256,phase});
    summaries[phase]={schema:'stallorder-paired-edge-phase-completion/v1',phase,phaseComplete:true,jobId:job.id,
      planSha256:hash(JSON.stringify(plan)),logSha256:hash(logs[job.id]),originVerified:true,mutationAuthorized:false,releaseAuthorized:false};
  }
  for(const phase of ['usage-archive','usage-candidate']) {
    const job=byName(phase),{step,events,times}=eventsInStep(job,logs[job.id],usageStep,'paired-edge-usage-',now,128*1024*1024);
    const {receipt,...summary}=decodePairedUsageEvidence({snapshot,snapshotSha256,phase,events});
    assert.ok(time(step.started_at)<=time(receipt.rateSnapshots[0].observedAt));
    assert.ok(time(receipt.rateCleanup.databaseObservedAt)<=times[0]);
    summaries[phase]={...summary,jobId:job.id,logSha256:hash(logs[job.id]),originVerified:true};
  }
  const finalJob=byName('verify'),{step,events,times}=eventsInStep(finalJob,logs[finalJob.id],verifyStep,'paired-edge-rehearsal-',now,2*1024*1024);
  assert.equal(events.length,1);assert.deepEqual(Object.keys(events[0]).sort(),['event','receipt']);
  assert.equal(events[0].event,'paired-edge-rehearsal-complete');const receipt=events[0].receipt;
  let previous=time(step.started_at);
  for(const [field,phase] of [['replay','replay'],['restored','restore'],['archivedUsage','usage-archive'],['candidateUsage','usage-candidate']]) {
    const supplied=receipt?.[field],observed=time(supplied?.observedAt),finished=time(supplied?.readFinishedAt);
    assert.ok(previous<=observed&&observed<=finished&&finished<=times[0]);previous=finished;
    summaries[phase]={...summaries[phase],consumerJobId:finalJob.id,observedAt:supplied.observedAt,readFinishedAt:supplied.readFinishedAt};
  }
  assert.deepEqual(receipt,{schema:'stallorder-paired-edge-rehearsal/v2',project:snapshot.project,controlCommit:snapshot.controlCommit,
    runId:snapshot.runId,runAttempt:1,snapshotSha256,replay:summaries.replay,restored:summaries.restore,
    archivedUsage:summaries['usage-archive'],candidateUsage:summaries['usage-candidate'],cleanupVerified:true,
    productionRecoveryVerified:false,releaseAuthorized:false});
  return {schema:'stallorder-completed-paired-edge-admission/v1',project:snapshot.project,controlCommit:snapshot.controlCommit,
    runId:run.id,runAttempt:1,workflowId:expectedWorkflowId,snapshotSha256,archiveSha256:snapshot.archiveSha256,
    jobLogs:names.map(name=>{const job=byName(name);return {jobId:job.id,name,sha256:hash(logs[job.id])};}),
    receiptSha256:hash(JSON.stringify(receipt)),edgeRehearsalVerified:true,cleanupVerified:true,
    originVerified:false,productQualified:false,productionRecoveryVerified:false,mutationAuthorized:false,releaseAuthorized:false};
}
export function verifyCompletedPairedRehearsal(input) {
  try{return verifyCompleted(input);}catch{throw new Error('COMPLETED_EDGE_EVIDENCE_REJECTED');}
}
function github(path) {
  return execFileSync('gh',githubReadArguments(path),{encoding:'utf8',timeout:60000,
    maxBuffer:192*1024*1024,stdio:['ignore','pipe','pipe']});
}

// The protected caller must independently pin the reviewed original commit/tree
// and source digests. This read-only bridge does not grant a future control release
// permission to mutate, nor make this six-hour qualification reusable indefinitely.
export async function loadCompletedPairedRehearsal({contract,token,read=github,clock=Date.now}) {
  let stage='CONTRACT';
  try {
    assert.deepEqual(Object.keys(contract).sort(),['controlCommit','controlTree','runId','jobId','runAttempt','workflowId','archiveSha256','sourceDigests'].sort());
    for(const field of ['controlCommit','controlTree'])assert.match(contract[field]??'',/^[a-f0-9]{40}$/);
    for(const field of ['runId','jobId'])assert.ok(Number.isSafeInteger(contract[field])&&contract[field]>0);
    assert.equal(contract.workflowId,408525851);assert.equal(contract.runAttempt,1);
    assert.match(contract.archiveSha256??'',/^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(contract.sourceDigests).sort(),[...sourcePaths].sort());
    for(const digest of Object.values(contract.sourceDigests))assert.match(digest??'',/^[a-f0-9]{64}$/);
    const json=async path=>{const raw=await read(path);assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)<=2*1024*1024);return JSON.parse(raw);};
    const runPath=`actions/runs/${contract.runId}`,jobsPath=runPath+'/attempts/1/jobs?per_page=100';
    stage='SOURCE';const commit=await json('git/commits/'+contract.controlCommit);
    assert.equal(commit.sha,contract.controlCommit);assert.equal(commit.tree?.sha,contract.controlTree);
    for(const path of sourcePaths.slice(3)) {
      const file=await json(`contents/${path}?ref=${contract.controlCommit}`);
      assert.equal(file.path,path);assert.equal(file.type,'file');assert.equal(file.encoding,'base64');assert.equal(typeof file.content,'string');
      const encoded=file.content.replaceAll('\n',''),bytes=Buffer.from(encoded,'base64');
      assert.equal(bytes.toString('base64'),encoded);assert.equal(file.size,bytes.length);assert.equal(hash(bytes),contract.sourceDigests[path]);
    }
    stage='EXECUTION';const run=await json(runPath);
    assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
    stage='JOURNAL';const loaded=await loadPairedInterruptedJournal({token,read,clock,expectedWorkflowId:contract.workflowId,
      contract:{controlCommit:contract.controlCommit,runId:contract.runId,jobId:contract.jobId,runAttempt:1,workflowId:contract.workflowId,
        archiveSha256:contract.archiveSha256,workflowSha256:contract.sourceDigests[sourcePaths[0]],
        entrySha256:contract.sourceDigests[sourcePaths[1]],intentSha256:contract.sourceDigests[sourcePaths[2]]}});
    const verify=(metadata,now)=>verifyCompletedPairedRehearsal({snapshot:loaded.snapshot,snapshotSha256:loaded.evidence.snapshotSha256,
      expectedWorkflowId:contract.workflowId,run:metadata,jobs:loaded.journal.jobs,logs:loaded.journal.logs,now});
    stage='VERIFY';const firstVerifiedAt=clock();verify(run,firstVerifiedAt);
    stage='FINAL_READBACK';const observedAt=clock(),finalRun=await json(runPath);assert.deepEqual(finalRun,run);
    const inventory=await json(jobsPath);assert.equal(inventory.total_count,8);assert.deepEqual(inventory.jobs,loaded.journal.jobs);
    for(const job of loaded.journal.jobs)assert.deepEqual(await json(`actions/jobs/${job.id}`),job);
    stage='FINAL_VERIFY';const now=clock();assert.ok(firstVerifiedAt<=observedAt&&observedAt<=now);
    const evidence=verify(finalRun,now);
    return {snapshot:loaded.snapshot,evidence:{...evidence,originVerified:true,firstRunVerified:loaded.evidence.firstRunVerified,
      firstRunReceiptSha256:loaded.evidence.firstRunReceiptSha256,controlTree:contract.controlTree,
      sourceDigests:structuredClone(contract.sourceDigests),observedAt:new Date(observedAt).toISOString(),readFinishedAt:new Date(now).toISOString()}};
  } catch {throw new Error('COMPLETED_EDGE_LOAD_'+stage);}
}
