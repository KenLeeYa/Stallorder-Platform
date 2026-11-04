import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyDeliveryQualification } from './delivery-qualification.mjs';
import { restoreCapture } from './delivery-security-capture.mjs';
import { verifyReviewedEvidence } from './delivery-security-adjudication.mjs';

const repository = 'KenLeeYa/Stallorder-Platform';
const hash = value => createHash('sha256').update(value).digest('hex');
let stage = 'startup';
// gh API's documented ANSI opt-in is used only for raw job logs captured to
// a pipe. Never echo these bytes or inherit terminal stdout; hashes and parsed
// receipts are the only output. No access, token, or workflow permissions change.
export function githubReadArguments(path) {
  const args=['api','--hostname','github.com',`repos/${repository}/${path}`];
  if(/^actions\/jobs\/[1-9][0-9]*\/logs$/.test(path)) args.push('--allow-escape-sequences');
  return args;
}
function github(path, label) {
  stage = label;
  return execFileSync('gh', githubReadArguments(path),
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function sourceFile(path, commit, label) {
  const file = JSON.parse(github(`contents/${path}?ref=${commit}`, label));
  assert.equal(file.path, path); assert.equal(file.encoding, 'base64');
  return Buffer.from(file.content, 'base64');
}
export function assertUnchangedExecution(before, after) {
  for (const name of ['run', 'job', 'securityJob']) {
    for (const key of ['id', 'run_id', 'head_sha', 'run_attempt', 'status', 'conclusion',
      'created_at', 'started_at', 'completed_at']) {
      assert.equal(after[name]?.[key], before[name]?.[key], `execution changed: ${name}.${key}`);
    }
  }
}
export function safeGithubFailure(error) {
  const stderr=String(error?.stderr??'');
  const http=stderr.match(/HTTP[ :]+(\d{3})/)?.[1];
  const reason=/blocked|policy|denied|forbidden|unauthorized/i.test(stderr)||['401','403'].includes(http)
    ? 'authorization' : http ? 'http-error' : /reset by peer|ECONNRESET/i.test(stderr) ? 'connection-reset'
      : /unexpected EOF/i.test(stderr) ? 'unexpected-eof' : /timeout|timed out/i.test(stderr) ? 'timeout'
        : /EPIPE|broken pipe/i.test(stderr) ? 'broken-pipe' : 'unclassified';
  const code=typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:undefined;
  let diagnostic=stderr;
  for(const token of [process.env.GH_TOKEN,process.env.GITHUB_TOKEN].filter(Boolean)) diagnostic=diagnostic.replaceAll(token,'[credential]');
  diagnostic=diagnostic.replace(/https?:\/\/\S+/gi,'[url]').replace(/Bearer\s+\S+/gi,'[credential]')
    .replace(/(?:gh[pousr]_|github_pat_|sbp_)[A-Za-z0-9_]+/g,'[credential]')
    .replace(/[\x00-\x1f\x7f]/g,' ').slice(0,240);
  return {reason,http,code,status:Number.isInteger(error?.status)?error.status:undefined,diagnostic};
}
export function validateAdmissionContext(env) {
  assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(env.GITHUB_REPOSITORY,repository);
  assert.equal(env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(env.RUNNER_OS,'Linux');
  assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
  const protectedMain=env.GITHUB_REF==='refs/heads/main';
  const workflow=protectedMain?'production-delivery-evidence.yml':'delivery-candidate-admission.yml';
  assert.equal(env.GITHUB_REF,protectedMain?'refs/heads/main':'refs/heads/codex/primary-only-preparation');
  assert.equal(env.GITHUB_WORKFLOW_REF,repository+'/.github/workflows/'+workflow+'@'+env.GITHUB_REF);
  if(protectedMain){assert.equal(env.GITHUB_REPOSITORY_OWNER,'KenLeeYa');assert.equal(env.GITHUB_ACTOR,env.GITHUB_REPOSITORY_OWNER);assert.equal(env.GITHUB_TRIGGERING_ACTOR,env.GITHUB_REPOSITORY_OWNER);}
  return {releaseAuthorized:false};
}
function main() {
  validateAdmissionContext(process.env);
  const contractBytes = readFileSync(new URL('./delivery-qualification-run13-source.json', import.meta.url));
  assert.equal(hash(contractBytes), process.env.DELIVERY_QUALIFICATION_CONTRACT_SHA256);
  const contract = JSON.parse(contractBytes);
  const reviewBytes = readFileSync(new URL('./delivery-reviewed-run13-scan.json', import.meta.url));
  assert.equal(hash(reviewBytes), process.env.DELIVERY_SECURITY_REVIEW_SHA256);
  const review = JSON.parse(reviewBytes);
  assert.equal(contract.runId, review.source.runId); assert.equal(contract.controlCommit, review.source.controlCommit);
  assert.equal(contract.productCommit, review.product.commit); assert.equal(contract.productTree, review.product.tree);
  assert.equal(contract.securityJobId, review.source.jobId);
  for (const key of ['runId', 'jobId', 'securityJobId']) assert.ok(Number.isSafeInteger(contract[key]) && contract[key] > 0);
  assert.match(contract.controlCommit, /^[a-f0-9]{40}$/);
  const run = JSON.parse(github(`actions/runs/${contract.runId}`, 'qualification-run'));
  const job = JSON.parse(github(`actions/jobs/${contract.jobId}`, 'verification-job'));
  const securityJob = JSON.parse(github(`actions/jobs/${contract.securityJobId}`, 'security-job'));
  const workflowBytes = sourceFile('.github/workflows/delivery-candidate-ci.yml', contract.controlCommit, 'source-workflow');
  const flowBytes = sourceFile('scripts/ci/delivery-flow.mjs', contract.controlCommit, 'source-flow');
  const log = github(`actions/jobs/${contract.jobId}/logs`, 'verification-log');
  stage = 'verification-evidence';
  verifyDeliveryQualification({ contract, run, job, workflowBytes, flowBytes, log, now: Date.now() });
  const securityLog = github(`actions/jobs/${contract.securityJobId}/logs`, 'security-log');
  const lines = securityLog.split(/\r?\n/);
  const rawSarif = restoreCapture(lines.filter(line => /^\S+Z \{"event":"sarif-(?:capture|chunk)"/.test(line))
    .map(line => JSON.parse(line.slice(line.indexOf('{')))));
  const sources = lines.filter(line => /^\S+Z \{"controlCommit":/.test(line))
    .map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.equal(sources.length, 1);
  stage = 'security-evidence';
  const productDirectory = fileURLToPath(new URL('../../../product/', import.meta.url));
  const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: productDirectory,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const product = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    clean: git(['status', '--porcelain']) === '' };
  verifyReviewedEvidence({ rawSarif, reviewBytes,
    expectedReviewSha256: process.env.DELIVERY_SECURITY_REVIEW_SHA256, product, now: Date.now(),
    provenance: { run, job: securityJob, workflowBytes, productReceipt: sources[0] } });
  // Log downloads can take time. Reconcile run attempts and completion state
  // after them and evaluate both freshness limits at this final readback.
  const observedAt = new Date().toISOString();
  const finalRun = JSON.parse(github(`actions/runs/${contract.runId}`, 'final-qualification-run'));
  const finalJob = JSON.parse(github(`actions/jobs/${contract.jobId}`, 'final-verification-job'));
  const finalSecurityJob = JSON.parse(github(`actions/jobs/${contract.securityJobId}`, 'final-security-job'));
  stage = 'final-execution-readback';
  assertUnchangedExecution({ run, job, securityJob }, { run: finalRun, job: finalJob, securityJob: finalSecurityJob });
  const now = Date.now();
  const verification = verifyDeliveryQualification({ contract, run: finalRun, job: finalJob, workflowBytes, flowBytes, log, now });
  const security = verifyReviewedEvidence({ rawSarif, reviewBytes,
    expectedReviewSha256: process.env.DELIVERY_SECURITY_REVIEW_SHA256, product, now,
    provenance: { run: finalRun, job: finalSecurityJob, workflowBytes, productReceipt: sources[0] } });
  const receipt = { schema: 'stallorder-delivery-qualification/v1', observedAt, readFinishedAt: new Date(now).toISOString(),
    admissionControlCommit: process.env.GITHUB_SHA, admissionRunId: process.env.GITHUB_RUN_ID,
    contractSha256: hash(contractBytes), reviewSha256: hash(reviewBytes), securityLogSha256: hash(securityLog),
    verification, security, evidenceVerified: true, releaseAuthorized: false,
    limitations: ['Not protected installation or Production approval.',
      'Actual Primary executor, provider Preview/config, old artifact compatibility and live affected QA remain separate.'] };
  console.log(JSON.stringify({ ...receipt, qualificationSha256: hash(JSON.stringify(receipt)) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    // Diagnostics must not echo stderr, signed log URLs, tokens or input values.
    console.error(JSON.stringify({ event: 'delivery-admission-failed', stage, ...safeGithubFailure(error) }));
    process.exitCode = 1;
  }
}
