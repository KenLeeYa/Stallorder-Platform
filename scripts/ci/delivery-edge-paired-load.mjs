import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';
import {decodePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {verifyInterruptedPairedJournal} from './delivery-edge-intent.mjs';

const repository = 'KenLeeYa/Stallorder-Platform';
const workflowPath = '.github/workflows/production-delivery-edge-rehearsal.yml';
const entryPath = 'scripts/ci/delivery-edge-rehearsal-entry.mjs';
const snapshotStep = 'Capture encrypted isolated Edge preimages before any write';
const guardStep = 'Require current protected control and identical verified staging tree';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function instant(value) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const result = Date.parse(value); assert.ok(Number.isFinite(result));
  assert.equal(new Date(result).toISOString(), value.includes('.') ? value : value.replace('Z', '.000Z')); return result;
}
function verifyFirstAdmission({expectedWorkflowId, run, capture, snapshot, log, firstSnapshotLine}) {
  assert.ok(Number.isSafeInteger(expectedWorkflowId) && expectedWorkflowId > 0);
  assert.equal(run.workflow_id, expectedWorkflowId); assert.equal(run.run_number, 1); assert.equal(run.run_attempt, 1);
  assert.ok(Number.isSafeInteger(firstSnapshotLine) && firstSnapshotLine >= 0);
  const records = [];
  for (const [lineNumber, line] of log.split(/\r?\n/).entries()) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*\})$/.exec(line);
    if (!match) {assert.ok(!line.includes('paired-edge-first-run-admission')); continue;}
    const event = JSON.parse(match[2]);
    if (typeof event?.event !== 'string' || !event.event.startsWith('paired-edge-first-run-admission')) continue;
    assert.ok(lineNumber < firstSnapshotLine);
    const at = instant(match[1].replace(/(\.\d{3})\d{4}Z$/, '$1Z'));
    assert.deepEqual(Object.keys(event).sort(), ['event', 'receipt']);
    assert.equal(event.event, 'paired-edge-first-run-admission');
    const receipt = event.receipt;
    const expected = {schema: 'stallorder-paired-first-run/v1', firstRunVerified: true,
      workflowId: expectedWorkflowId, runId: run.id, runNumber: 1, runAttempt: 1,
      reusable: false, mutationAuthorized: false, releaseAuthorized: false,
      observedAt: receipt?.observedAt, readFinishedAt: receipt?.readFinishedAt};
    assert.deepEqual(receipt, expected);
    const observed = instant(receipt.observedAt), finished = instant(receipt.readFinishedAt);
    assert.ok(instant(capture.started_at) <= observed && observed <= finished && finished <= at &&
      at <= instant(snapshot.startedAt) && at < instant(capture.completed_at) + 1000);
    records.push(receipt);
  }
  assert.equal(records.length, 1);
  return {firstRunVerified: true, workflowId: expectedWorkflowId,
    firstRunReceiptSha256: hash(JSON.stringify(records[0])), mutationAuthorized: false};
}
function verify(contract, run, job, log, token, now, recoveryOnly = false, expectedWorkflowId) {
  for (const repo of [run.repository, run.head_repository]) {
    assert.equal(repo?.full_name, repository); assert.equal(repo.id, 1298874780);
    assert.equal(repo.private, false); assert.equal(repo.fork, false);
  }
  assert.equal(run.id, contract.runId); assert.equal(run.workflow_id, contract.workflowId);
  assert.equal(run.run_attempt, contract.runAttempt); assert.equal(run.head_sha, contract.controlCommit);
  assert.equal(run.head_branch, 'main'); assert.equal(run.event, 'workflow_dispatch'); assert.equal(run.path, workflowPath);
  assert.equal(run.actor?.login, 'KenLeeYa'); assert.equal(run.triggering_actor?.login, 'KenLeeYa');
  // The next job consumes a completed snapshot while the same workflow runs.
  // A later failed/cancelled consumer does not invalidate its encrypted backup.
  assert.ok(['in_progress', 'completed'].includes(run.status));
  if (recoveryOnly) {
    assert.equal(run.status, 'completed');
    assert.ok(['success', 'failure', 'cancelled', 'timed_out'].includes(run.conclusion));
  }
  assert.equal(job.id, contract.jobId); assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, run.head_sha); assert.equal(job.name, 'snapshot');
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
  assert.deepEqual(job.labels, ['ubuntu-24.04']); assert.match(job.runner_name ?? '', /^GitHub Actions \d+$/);
  const created = instant(run.created_at), start = instant(job.started_at), end = instant(job.completed_at);
  assert.ok(Number.isFinite(now) && created <= start && start <= end && end <= now);
  if (!recoveryOnly) assert.ok(now - created <= 6 * 3600000);
  assert.ok(Array.isArray(job.steps) && new Set(job.steps.map(step => step.name)).size === job.steps.length);
  let previousNumber = 0, previousEnd = start;
  for (const step of job.steps) {
    assert.ok(Number.isSafeInteger(step.number) && step.number > previousNumber); previousNumber = step.number;
    assert.equal(step.status, 'completed');
    if (step.conclusion === 'skipped') {assert.ok(step.name.startsWith('Post Run actions/setup-node@')); continue;}
    assert.equal(step.conclusion, 'success');
    const began = instant(step.started_at), finished = instant(step.completed_at);
    assert.ok(previousEnd <= began && began <= finished && finished <= end); previousEnd = finished;
  }
  const guard = job.steps.find(step => step.name === guardStep), capture = job.steps.find(step => step.name === snapshotStep);
  assert.ok(guard && capture && guard.number < capture.number);
  assert.equal(guard.conclusion, 'success'); assert.equal(capture.conclusion, 'success');
  const captureStart = instant(capture.started_at), captureEnd = instant(capture.completed_at);
  assert.ok(typeof log === 'string' && Buffer.byteLength(log) > 0 && Buffer.byteLength(log) <= 192 * 1024 * 1024);
  const events = [], times = []; let firstSnapshotLine;
  for (const [lineNumber, line] of log.split(/\r?\n/).entries()) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z) (\{.*)$/.exec(line);
    if (!match) continue;
    let event;
    try {event = JSON.parse(match[2]);} catch {assert.ok(!match[2].includes('paired-preimage-')); continue;}
    if (typeof event?.event !== 'string' || !event.event.startsWith('paired-preimage-')) continue;
    if (firstSnapshotLine === undefined) firstSnapshotLine = lineNumber;
    const at = instant(match[1].replace(/(\.\d{3})\d{4}Z$/, '$1Z'));
    assert.ok(captureStart <= at && at < captureEnd + 1000 && at <= now && (!times.length || times.at(-1) <= at));
    times.push(at); events.push(event);
  }
  const snapshot = decodePairedSnapshot(events, token, {controlCommit: contract.controlCommit,
    runId: String(contract.runId), runAttempt: contract.runAttempt, archiveSha256: contract.archiveSha256});
  assert.ok(captureStart <= instant(snapshot.startedAt) && instant(snapshot.finishedAt) <= times[0]
    && instant(snapshot.finishedAt) < captureEnd + 1000 && instant(snapshot.finishedAt) <= now);
  const firstRun = expectedWorkflowId === undefined ? {} :
    verifyFirstAdmission({expectedWorkflowId, run, capture, snapshot, log, firstSnapshotLine});
  return {snapshot, evidence: {schema: 'stallorder-paired-edge-preimage-admission/v1', project: snapshot.project,
    controlCommit: contract.controlCommit, runId: contract.runId, runAttempt: contract.runAttempt, jobId: job.id,
    archiveSha256: contract.archiveSha256, snapshotSha256: events[0].sha256, logSha256: hash(log),
    startedAt: snapshot.startedAt, finishedAt: snapshot.finishedAt, ...firstRun, releaseAuthorized: false}};
}
function github(path) {
  return execFileSync('gh', githubReadArguments(path), {encoding: 'utf8', maxBuffer: 192 * 1024 * 1024,
    timeout: 60000, stdio: ['ignore', 'pipe', 'pipe']});
}
function stableRun(run, recoveryOnly) {
  const fields = ['id', 'head_sha', 'head_branch', 'event', 'run_number', 'run_attempt', 'workflow_id', 'path',
    'repository', 'head_repository', 'actor', 'triggering_actor', 'created_at'];
  if (recoveryOnly) fields.push('status', 'conclusion');
  return Object.fromEntries(fields.map(field => [field, run[field]]));
}
function verifyConsumer(contract, run, snapshotJob, consumer, now) {
  assert.equal(consumer.id, contract.consumerJobId); assert.notEqual(consumer.id, snapshotJob.id);
  assert.equal(consumer.run_id, run.id); assert.equal(consumer.run_attempt, run.run_attempt);
  assert.equal(consumer.head_sha, run.head_sha); assert.equal(consumer.name, 'rehearse');
  assert.equal(consumer.status, 'completed');
  assert.ok(['success', 'failure', 'cancelled', 'timed_out'].includes(consumer.conclusion));
  assert.deepEqual(consumer.labels, ['ubuntu-24.04']); assert.match(consumer.runner_name ?? '', /^GitHub Actions \d+$/);
  const start = instant(consumer.started_at), end = instant(consumer.completed_at);
  assert.ok(instant(snapshotJob.completed_at) <= start && start <= end && end <= now);
}
function terminalStagedJobs(run, snapshotJob, inventory, now) {
  const names=['snapshot','replay-intent','replay','usage-archive','restore-intent','restore','usage-candidate','verify'];
  assert.ok(Array.isArray(inventory.jobs));assert.equal(inventory.total_count,8);assert.equal(inventory.jobs.length,8);
  assert.deepEqual(inventory.jobs.map(job=>job.name).sort(),[...names].sort());
  assert.equal(new Set(inventory.jobs.map(job=>job.id)).size,8);
  assert.deepEqual(inventory.jobs.find(job=>job.name==='snapshot'),snapshotJob);
  for(const job of inventory.jobs) {
    assert.ok(Number.isSafeInteger(job.id)&&job.id>0);assert.equal(job.run_id,run.id);
    assert.equal(job.run_attempt,1);assert.equal(job.head_sha,run.head_sha);assert.equal(job.status,'completed');
    assert.ok(['success','failure','cancelled','timed_out','skipped'].includes(job.conclusion));
    assert.ok(Array.isArray(job.steps));
    if(job.conclusion==='skipped') {
      assert.equal(job.steps.length,0);assert.ok(Array.isArray(job.labels));
      if(job.labels.length)assert.deepEqual(job.labels,['ubuntu-24.04']);
      for(const key of ['runner_name','runner_group_name'])assert.ok(job[key]==null||job[key]==='');
      for(const key of ['runner_id','runner_group_id'])assert.ok(job[key]==null);
      if(job.started_at!==null||job.completed_at!==null)
        for(const value of [job.started_at,job.completed_at])assert.ok(instant(run.created_at)<=instant(value)&&instant(value)<=now);
      continue;
    }
    assert.deepEqual(job.labels,['ubuntu-24.04']);assert.match(job.runner_name??'',/^GitHub Actions \d+$/);
    const start=instant(job.started_at),end=instant(job.completed_at);
    assert.ok((job.name==='snapshot'?instant(run.created_at):instant(snapshotJob.completed_at))<=start&&start<=end&&end<=now);
    assert.equal(new Set(job.steps.map(step=>step.name)).size,job.steps.length);
    let previousNumber=0,previousEnd=start;
    for(const step of job.steps) {
      assert.ok(Number.isSafeInteger(step.number)&&step.number>previousNumber);previousNumber=step.number;
      assert.equal(step.status,'completed');assert.ok(['success','failure','cancelled','timed_out','skipped'].includes(step.conclusion));
      if(step.conclusion==='skipped')continue;
      const begin=instant(step.started_at),finish=instant(step.completed_at);
      assert.ok(previousEnd<=begin&&begin<=finish&&finish<=end);previousEnd=finish;
    }
  }
}
async function loadSnapshot({contract, token, read = github, clock = Date.now, expectedWorkflowId}, recoveryOnly, requireFirstRun = false, stagedRecovery = false, verifyHistory = false) {
  let stage = 'CONTRACT';
  try {
    assert.match(contract.controlCommit ?? '', /^[a-f0-9]{40}$/);
    for (const field of ['runId', 'jobId', 'runAttempt', 'workflowId']) assert.ok(Number.isSafeInteger(contract[field]) && contract[field] > 0);
    if (requireFirstRun) {
      assert.ok(Number.isSafeInteger(expectedWorkflowId) && expectedWorkflowId > 0);
      assert.equal(contract.workflowId, expectedWorkflowId); assert.ok(!recoveryOnly || stagedRecovery);
    } else assert.equal(expectedWorkflowId, undefined);
    if (stagedRecovery) {assert.equal(recoveryOnly,true);assert.equal(requireFirstRun,true);assert.equal(contract.consumerJobId,undefined);}
    if (recoveryOnly && !stagedRecovery) assert.ok(Number.isSafeInteger(contract.consumerJobId) && contract.consumerJobId > 0);
    for (const field of ['archiveSha256', 'workflowSha256', 'entrySha256']) assert.match(contract[field] ?? '', /^[a-f0-9]{64}$/);
    if(stagedRecovery)assert.match(contract.intentSha256??'',/^[a-f0-9]{64}$/);
    const json = async path => {const text = await read(path); assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 2 * 1024 * 1024); return JSON.parse(text);};
    stage = 'EXECUTION';
    const runPath = `actions/runs/${contract.runId}`, jobPath = `actions/jobs/${contract.jobId}`;
    const run = await json(runPath), job = await json(jobPath);
    const consumerPath = recoveryOnly && !stagedRecovery ? `actions/jobs/${contract.consumerJobId}` : null;
    const consumer = consumerPath ? await json(consumerPath) : null;
    const jobsPath=stagedRecovery?`${runPath}/attempts/1/jobs?per_page=100`:null;
    const inventory=jobsPath?await json(jobsPath):null;
    if(stagedRecovery)terminalStagedJobs(run,job,inventory,clock());
    stage = 'SOURCE';
    const sources=[[workflowPath, contract.workflowSha256], [entryPath, contract.entrySha256]];
    if(stagedRecovery)sources.push(['scripts/ci/delivery-edge-intent.mjs',contract.intentSha256]);
    for (const [path, digest] of sources) {
      const source = await json(`contents/${path}?ref=${contract.controlCommit}`);
      assert.equal(source.path, path); assert.equal(source.type, 'file'); assert.equal(source.encoding, 'base64');
      assert.equal(typeof source.content, 'string'); const encoded = source.content.replaceAll('\n', '');
      const bytes = Buffer.from(encoded, 'base64'); assert.equal(bytes.toString('base64'), encoded);
      assert.equal(bytes.length, source.size); assert.equal(hash(bytes), digest);
    }
    stage = 'LOG'; const log = await read(`${jobPath}/logs`);
    const journal=stagedRecovery?{jobs:inventory.jobs,logs:{[job.id]:log}}:null;
    if(stagedRecovery) {
      let total=Buffer.byteLength(log);
      for(const other of inventory.jobs.filter(item=>item.id!==job.id)) {
        assert.deepEqual(await json(`actions/jobs/${other.id}`),other);
        if(other.conclusion==='skipped')continue;
        const raw=await read(`actions/jobs/${other.id}/logs`);
        assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)>0&&Buffer.byteLength(raw)<=128*1024*1024);
        total+=Buffer.byteLength(raw);assert.ok(total<=192*1024*1024);journal.logs[other.id]=raw;
      }
    }
    stage = 'VERIFY'; const firstVerifiedAt = clock();
    const initial = verify(contract, run, job, log, token, firstVerifiedAt, recoveryOnly, expectedWorkflowId);
    if (consumerPath) verifyConsumer(contract, run, job, consumer, firstVerifiedAt);
    if(stagedRecovery)terminalStagedJobs(run,job,inventory,firstVerifiedAt);
    const verifyJournal = (verified, originalRun, at) => verifyInterruptedPairedJournal({snapshot:verified.snapshot,
      snapshotSha256:verified.evidence.snapshotSha256,expectedWorkflowId,run:originalRun,
      jobs:journal.jobs,logs:journal.logs,now:at});
    if(verifyHistory) {stage='JOURNAL';verifyJournal(initial,run,firstVerifiedAt);}
    stage = 'FINAL_READBACK'; const observedAt = clock();
    const finalRun = await json(runPath), finalJob = await json(jobPath);
    const finalConsumer = consumerPath ? await json(consumerPath) : null;
    assert.deepEqual(stableRun(finalRun, recoveryOnly), stableRun(run, recoveryOnly)); assert.deepEqual(finalJob, job);
    if (consumerPath) assert.deepEqual(finalConsumer, consumer);
    if(stagedRecovery) {
      assert.deepEqual(await json(jobsPath),inventory);
      for(const other of inventory.jobs)assert.deepEqual(await json(`actions/jobs/${other.id}`),other);
    }
    const now = clock(); assert.ok(firstVerifiedAt <= observedAt && observedAt <= now);
    stage = 'FINAL_VERIFY'; const result = verify(contract, finalRun, finalJob, log, token, now, recoveryOnly, expectedWorkflowId);
    if (consumerPath) verifyConsumer(contract, finalRun, finalJob, finalConsumer, now);
    if(stagedRecovery)terminalStagedJobs(finalRun,finalJob,inventory,now);
    let operationJournal;
    if(verifyHistory) {stage='FINAL_JOURNAL';operationJournal={...verifyJournal(result,finalRun,now),originVerified:true};}
    return {...result, ...(stagedRecovery?{journal}:{}), ...(verifyHistory?{operationJournal}:{}), evidence: {...result.evidence,
      ...(recoveryOnly ? {recoveryOnly: true, productQualified: false, mutationAuthorized: false,
        ...(consumerPath?{consumerJobId: finalConsumer.id, consumerCompletedAt: finalConsumer.completed_at}:{})} : {}),
      ...(stagedRecovery?{terminalJobsVerified:true,intentSourceSha256:contract.intentSha256,operationHistoryVerified:verifyHistory,requiresOperationJournal:!verifyHistory,
        jobLogs:Object.entries(journal.logs).map(([jobId,raw])=>({jobId:Number(jobId),sha256:hash(raw)}))}:{}),
      ...(verifyHistory?{requiresRecoveryHistory:true}:{}),
      observedAt: new Date(observedAt).toISOString(), readFinishedAt: new Date(now).toISOString()}};
  } catch {throw new Error('PAIRED_SNAPSHOT_LOAD_' + stage);}
}
export function loadPairedSnapshot(options) {return loadSnapshot(options, false);}
// Authenticate the original admission once. Later denied queued dispatches must
// not revoke this run's eligibility to restore its already captured preimages.
export function loadPairedAdmittedSnapshot(options) {return loadSnapshot(options, false, true);}
// Old backups remain inspectable; this entry never grants a write or freshness exception.
export function loadPairedRecoverySnapshot(options) {return loadSnapshot(options, true);}
// Staged backup transport only. Terminal job/log provenance does not prove
// operation settlement, absence of an earlier recovery, or owned fixture cleanup.
export function loadPairedInterruptedSnapshot(options) {return loadSnapshot(options, true, true, true);}
// Authenticate partial operation records against the same original backup and
// terminal provider readback. Global recovery exclusion and settled state remain separate.
export function loadPairedInterruptedJournal(options) {return loadSnapshot(options, true, true, true, true);}
