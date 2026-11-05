import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {githubReadArguments} from './delivery-admission.mjs';
import {verifyProtectedEdgeCapture} from './delivery-edge-capture-admission.mjs';

// Only immutable source reads and the one bound run/job are reachable. The
// archive remains in memory; this loader never restores or authorizes a release.
function github(path) {
  return execFileSync('gh', githubReadArguments(path), {
    encoding: 'utf8', maxBuffer: 192 * 1024 * 1024, timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export async function loadProtectedEdgeCapture({contract, token, read = github, clock = Date.now}) {
  let stage = 'CONTRACT';
  try {
    assert.match(contract.controlCommit ?? '', /^[a-f0-9]{40}$/);
    for (const key of ['runId', 'jobId', 'workflowId', 'runAttempt']) {
      assert.ok(Number.isSafeInteger(contract[key]) && contract[key] > 0);
    }
    const json = async path => {
      const text = await read(path);
      assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 2 * 1024 * 1024);
      return JSON.parse(text);
    };
    stage = 'EXECUTION';
    const runPath = `actions/runs/${contract.runId}`, jobPath = `actions/jobs/${contract.jobId}`;
    const run = await json(runPath), job = await json(jobPath);
    stage = 'SOURCE';
    const source = async path => {
      const value = await json(`contents/${path}?ref=${contract.controlCommit}`);
      assert.equal(value.path, path); assert.equal(value.type, 'file'); assert.equal(value.encoding, 'base64');
      assert.equal(typeof value.content, 'string');
      const encoded = value.content.replaceAll('\n', '');
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(bytes.toString('base64'), encoded); assert.equal(bytes.length, value.size);
      return bytes;
    };
    const workflowBytes = await source('.github/workflows/production-delivery-evidence.yml');
    const captureBytes = await source('scripts/ci/delivery-edge-recovery.capture.mjs');
    const recoveryBytes = await source('scripts/ci/delivery-edge-recovery.mjs');
    stage = 'LOG';
    const log = await read(`${jobPath}/logs`);
    stage = 'VERIFY';
    const verifiedAt = clock();
    verifyProtectedEdgeCapture({contract, run, job, workflowBytes, captureBytes, recoveryBytes, log, now: verifiedAt, token});
    stage = 'FINAL_READBACK';
    const observedAt = clock();
    const finalRun = await json(runPath), finalJob = await json(jobPath);
    assert.deepEqual(finalRun, run); assert.deepEqual(finalJob, job);
    const now = clock(); assert.ok(Number.isFinite(observedAt) && verifiedAt <= observedAt && observedAt <= now);
    stage = 'FINAL_VERIFY';
    const result = verifyProtectedEdgeCapture({contract, run: finalRun, job: finalJob, workflowBytes, captureBytes, recoveryBytes, log, now, token});
    return {archive: result.archive, evidence: {...result.evidence,
      observedAt: new Date(observedAt).toISOString(), readFinishedAt: new Date(now).toISOString()}};
  } catch {
    // Neither gh stderr (signed URLs/tokens) nor archive/source bytes escape.
    throw new Error('EDGE_CAPTURE_LOAD_' + stage);
  }
}
