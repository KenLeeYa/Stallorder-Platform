import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreCapture } from './delivery-security-capture.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
const repository = 'KenLeeYa/Stallorder-Platform';
const repositoryId = 1298874780;
const workflowId = 407163998;
const workflowPath = '.github/workflows/delivery-candidate-ci.yml';
const action = '1fc58d04a4d4374f921bdac573c3811c240f9c26';
const rawGate = 'Require no unresolved source security findings';
const requiredSteps = ['Reconstruct exact product for source scan', 'Verify native Linux approval-file boundaries',
  `Run github/codeql-action/init@${action}`, `Run github/codeql-action/analyze@${action}`, rawGate];
const date = value => {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const parsed = Date.parse(value);
  assert.equal(new Date(parsed).toISOString(), value.replace('Z', '.000Z'));
  return parsed;
};

// This adjudicates one complete, immutable, recent scan. No normalization or
// discarded SARIF field can turn another scan into this reviewed scan.
export function verifyReviewedEvidence({ rawSarif, reviewBytes, expectedReviewSha256, product, provenance, now }) {
  assert.match(expectedReviewSha256, hex64);
  assert.equal(hash(reviewBytes), expectedReviewSha256, 'review bytes changed');
  const review = JSON.parse(reviewBytes);
  assert.equal(review.schemaVersion, 2);
  assert.equal(review.scope, 'complete-immutable-scan');
  assert.equal(review.releaseAuthorized, false);
  assert.equal(review.independentReviewer, '/root/delivery_source_security_review');
  assert.match(review.independentReviewReceiptSha256, hex64);
  assert.match(review.product?.commit ?? '', hex40); assert.match(review.product?.tree ?? '', hex40);
  assert.equal(product.commit, review.product.commit); assert.equal(product.tree, review.product.tree);
  assert.equal(product.clean, true, 'dirty product');
  const source = review.source;
  assert.equal(source.repository, repository); assert.equal(source.workflowPath, workflowPath);
  assert.equal(source.repositoryId, repositoryId); assert.equal(source.workflowId, workflowId);
  assert.match(source.controlCommit, hex40); assert.match(source.workflowSha256, hex64);
  for (const id of [source.runId, source.runAttempt, source.jobId]) assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.equal(source.runAttempt, 1, 'rerun evidence needs a separately reviewed contract');
  assert.match(source.sarifSha256, hex64);
  assert.ok(Buffer.isBuffer(rawSarif) && rawSarif.length > 0 && rawSarif.length <= 64 * 1024 * 1024);
  assert.equal(rawSarif.length, source.sarifBytes, 'complete SARIF byte count changed');
  assert.equal(hash(rawSarif), source.sarifSha256, 'complete SARIF changed');

  const { run, job, workflowBytes, productReceipt } = provenance;
  assert.equal(hash(workflowBytes), source.workflowSha256, 'source workflow changed');
  assert.equal(run.id, source.runId); assert.equal(run.run_attempt, source.runAttempt);
  assert.equal(run.workflow_id, workflowId);
  assert.equal(run.repository?.full_name, repository); assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.repository.id, repositoryId); assert.equal(run.head_repository.id, repositoryId);
  assert.equal(run.repository.private, false); assert.equal(run.repository.fork, false);
  assert.equal(run.head_sha, source.controlCommit); assert.equal(run.head_branch, 'codex/primary-only-preparation');
  assert.equal(run.path, workflowPath); assert.equal(run.event, 'push'); assert.equal(run.status, 'completed');
  assert.equal(job.id, source.jobId); assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, run.run_attempt);
  assert.equal(job.head_sha, run.head_sha); assert.equal(job.name, 'security');
  assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'failure');
  assert.deepEqual(job.labels, ['ubuntu-24.04']); assert.match(job.runner_name, /^GitHub Actions \d+$/);
  assert.ok(Number.isFinite(now));
  const created = date(run.created_at), started = date(job.started_at), completed = date(job.completed_at);
  assert.ok(created <= started && started <= completed && completed <= now && now - created <= 6 * 3600_000,
    'scan is stale, future or has contradictory execution times');
  assert.ok(Array.isArray(job.steps) && new Set(job.steps.map(s => s.name)).size === job.steps.length);
  let prior = 0;
  for (const name of requiredSteps) {
    const step = job.steps.find(s => s.name === name);
    assert.ok(step && Number.isSafeInteger(step.number) && step.number > prior, 'missing or reordered scanner step');
    prior = step.number; assert.equal(step.status, 'completed');
    assert.equal(step.conclusion, name === rawGate ? 'failure' : 'success', `scanner step failed: ${name}`);
  }
  for (const step of job.steps) {
    assert.equal(step.status, 'completed');
    const expected = step.name === rawGate ? 'failure'
      : step.name === 'Post Run actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' ? 'skipped' : 'success';
    assert.equal(step.conclusion, expected, `unexpected scanner job outcome: ${step.name}`);
  }
  assert.equal(productReceipt.controlCommit, source.controlCommit);
  assert.equal(productReceipt.commit, product.commit); assert.equal(productReceipt.tree, product.tree);
  assert.equal(productReceipt.sourceVerified, true); assert.equal(productReceipt.releaseQualified, false);

  const sarif = JSON.parse(rawSarif);
  assert.equal(sarif.version, '2.1.0'); assert.equal(sarif.runs?.length, 1);
  const scan = sarif.runs[0];
  assert.equal(scan.tool.driver.name, 'CodeQL'); assert.equal(scan.tool.driver.semanticVersion, '2.27.4');
  assert.deepEqual(scan.properties?.codeqlConfigSummary, { disableDefaultQueries: false,
    queries: [{ type: 'builtinSuite', uses: 'security-extended' }] });
  assert.ok(Array.isArray(scan.artifacts) && Array.isArray(scan.results));
  const expectedFiles = new Set(), extractedFiles = new Set();
  const expectedIds = new Set(['cli/expected-extracted-files/typescript', 'cli/expected-extracted-files/javascript']);
  const allowedNotifications = new Set([...expectedIds, 'js/diagnostics/successfully-extracted-files',
    'codeql-action/toolcache-bundle-cleanup', 'codeql-action/overlay-disabled']);
  assert.ok(Array.isArray(scan.invocations) && scan.invocations.length > 0);
  for (const invocation of scan.invocations) {
    assert.equal(invocation.executionSuccessful, true);
    if (invocation.exitCode !== undefined) assert.equal(invocation.exitCode, 0);
    for (const name of ['toolExecutionNotifications', 'toolConfigurationNotifications']) {
      if (invocation[name] === undefined) continue;
      assert.ok(Array.isArray(invocation[name]));
      for (const notification of invocation[name]) {
        assert.ok(['none', 'note'].includes(notification.level), 'scanner warning or error requires investigation');
        const descriptor = notification.descriptor;
        assert.ok(allowedNotifications.has(descriptor?.id), 'unknown or error extraction diagnostic');
        const componentIndex = descriptor.toolComponent?.index;
        if (componentIndex !== undefined) assert.ok(Number.isSafeInteger(componentIndex) && componentIndex >= 0);
        const component = componentIndex === undefined ? scan.tool.driver : scan.tool.extensions?.[componentIndex];
        assert.ok(Number.isSafeInteger(descriptor.index) && descriptor.index >= 0);
        assert.equal(component?.notifications?.[descriptor.index]?.id, descriptor.id, 'diagnostic reference mismatch');
        if (expectedIds.has(descriptor.id) || descriptor.id === 'js/diagnostics/successfully-extracted-files') {
          assert.equal(notification.locations?.length, 1);
          const location = notification.locations[0].physicalLocation?.artifactLocation;
          assert.ok(Number.isSafeInteger(location?.index) && location.index >= 0);
          const target = scan.artifacts[location.index]?.location;
          assert.ok(target && typeof target.uri === 'string');
          assert.equal(location.uri, target.uri); assert.equal(location.uriBaseId, '%SRCROOT%');
          assert.equal(location.uriBaseId, target.uriBaseId);
          const files = expectedIds.has(descriptor.id) ? expectedFiles : extractedFiles;
          assert.ok(!files.has(target.uri), 'duplicate extraction record'); files.add(target.uri);
        }
      }
    }
  }
  assert.ok(expectedFiles.size > 0 && extractedFiles.size > 0, 'missing extraction coverage');
  for (const path of expectedFiles) assert.ok(extractedFiles.has(path), 'expected source file was not extracted');
  assert.ok(Array.isArray(review.findings) && review.findings.length > 0);
  assert.equal(scan.results.length, review.findings.length, 'incomplete review');
  for (const [index, result] of scan.results.entries()) {
    const finding = review.findings[index];
    assert.equal(finding.ordinal, index + 1); assert.equal(finding.disposition, 'false-positive');
    assert.equal(finding.ruleId, result.ruleId); assert.match(finding.resultSha256, hex64);
    assert.equal(finding.resultSha256, hash(JSON.stringify(result)), 'complete result changed');
    assert.ok(typeof finding.rationale === 'string' && finding.rationale.length > 20);
    assert.ok(typeof finding.conditions === 'string' && finding.conditions.length > 20);
    if (result.suppressions !== undefined) assert.ok(Array.isArray(result.suppressions) && result.suppressions.length === 0);
    assert.equal(result.rule?.id, result.ruleId);
    const componentIndex = result.rule?.toolComponent?.index;
    assert.ok(Number.isSafeInteger(componentIndex) && componentIndex >= 0);
    const component = scan.tool.extensions?.[componentIndex];
    assert.ok(Number.isSafeInteger(result.rule.index) && result.rule.index >= 0);
    assert.equal(component?.rules?.[result.rule.index]?.id, result.ruleId, 'rule reference mismatch');
    assert.ok(Array.isArray(result.locations) && result.locations.length > 0);
    // Full bytes already bind every reference; also reject inconsistent artifact
    // tables rather than trusting a displayed URI at the result's primary sink.
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (value.artifactLocation) {
        const location = value.artifactLocation;
        assert.ok(Number.isSafeInteger(location.index) && location.index >= 0);
        const target = scan.artifacts[location.index]?.location;
        assert.ok(target, 'missing artifact reference');
        if (location.uri !== undefined) assert.equal(location.uri, target.uri, 'artifact URI mismatch');
        if (location.uriBaseId !== undefined) assert.equal(location.uriBaseId, target.uriBaseId, 'artifact base mismatch');
      }
      for (const nested of Object.values(value)) visit(nested);
    };
    visit(result);
  }
  return { rawFindings: scan.results.length, reviewedFalsePositives: review.findings.length, unresolved: 0,
    sourceRunId: run.id, sourceJobId: job.id, sourceScanConclusion: job.conclusion, releaseAuthorized: false };
}

function github(path) {
  return execFileSync('gh', ['api', '--hostname', 'github.com', `repos/${repository}/${path}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted'); assert.equal(process.env.RUNNER_OS, 'Linux');
  const [, , productDirectory, reviewPath] = process.argv;
  assert.ok(productDirectory && reviewPath);
  const reviewBytes = readFileSync(reviewPath);
  assert.equal(hash(reviewBytes), process.env.DELIVERY_SECURITY_REVIEW_SHA256, 'unbound review file');
  const review = JSON.parse(reviewBytes);
  for (const id of [review.source.runId, review.source.jobId]) assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.match(review.source.controlCommit, hex40);
  const run = JSON.parse(github(`actions/runs/${review.source.runId}`));
  const job = JSON.parse(github(`actions/jobs/${review.source.jobId}`));
  const workflow = JSON.parse(github(`contents/${workflowPath}?ref=${review.source.controlCommit}`));
  assert.equal(workflow.encoding, 'base64'); assert.equal(workflow.path, workflowPath);
  const lines = github(`actions/jobs/${review.source.jobId}/logs`).split(/\r?\n/);
  const records = lines.filter(line => /^\S+Z \{"event":"sarif-(?:capture|chunk)"/.test(line))
    .map(line => JSON.parse(line.slice(line.indexOf('{'))));
  const rawSarif = restoreCapture(records);
  const receipts = lines.filter(line => /^\S+Z \{"controlCommit":/.test(line))
    .map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.equal(receipts.length, 1, 'ambiguous source reconstruction evidence');
  const git = args => execFileSync('git', ['--no-replace-objects', ...args],
    { cwd: productDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const product = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
    clean: git(['status', '--porcelain']) === '' };
  const outcome = verifyReviewedEvidence({ rawSarif, reviewBytes,
    expectedReviewSha256: process.env.DELIVERY_SECURITY_REVIEW_SHA256, product, now: Date.now(),
    provenance: { run, job, productReceipt: receipts[0], workflowBytes: Buffer.from(workflow.content, 'base64') } });
  console.log(JSON.stringify({ product, ...outcome }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    // Never echo gh's stderr, signed artifact URLs, tokens or complete logs.
    console.error(error instanceof assert.AssertionError ? error.message : 'Security evidence collection failed');
    process.exitCode = 1;
  }
}
