import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyReviewedEvidence } from './delivery-security-adjudication.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = Date.parse('2026-11-04T20:00:00Z');
const product = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
const action = '1fc58d04a4d4374f921bdac573c3811c240f9c26';
const required = ['Reconstruct exact product for source scan', 'Verify native Linux approval-file boundaries',
  `Run github/codeql-action/init@${action}`, `Run github/codeql-action/analyze@${action}`];
function fixture() {
  const result = { ruleId: 'js/example', rule: { id: 'js/example', index: 0, toolComponent: { index: 0 } },
    message: { text: 'Complete flow' }, locations: [{ physicalLocation: {
      artifactLocation: { uri: 'src/file.ts', index: 0, uriBaseId: '%SRCROOT%' }, region: { startLine: 1 } } }],
    relatedLocations: [{ id: 1, physicalLocation: { artifactLocation: { uri: 'src/file.ts', index: 0 },
      region: { startLine: 2 } } }], codeFlows: [], stacks: [] };
  const expectedId = 'cli/expected-extracted-files/typescript';
  const extractedId = 'js/diagnostics/successfully-extracted-files';
  const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.4',
    notifications: [{ id: expectedId }] },
    extensions: [{ name: 'codeql/javascript-queries', semanticVersion: 'pinned-pack', rules: [{ id: 'js/example' }],
      notifications: [{ id: extractedId }] }] },
    invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
      { level: 'none', descriptor: { id: expectedId, index: 0 }, locations: result.locations },
      { level: 'none', descriptor: { id: extractedId, index: 0, toolComponent: { index: 0 } }, locations: result.locations },
    ] }],
    artifacts: [{ location: { uri: 'src/file.ts', index: 0, uriBaseId: '%SRCROOT%' } }], results: [result],
    properties: { codeqlConfigSummary: { disableDefaultQueries: false,
      queries: [{ type: 'builtinSuite', uses: 'security-extended' }] } } }] };
  const rawSarif = Buffer.from(JSON.stringify(sarif));
  const workflowBytes = Buffer.from('immutable reviewed scan workflow');
  const controlCommit = 'c'.repeat(40);
  const review = { schemaVersion: 2, scope: 'complete-immutable-scan', releaseAuthorized: false,
    product: { commit: product.commit, tree: product.tree }, independentReviewer: '/root/delivery_source_security_review',
    independentReviewReceiptSha256: 'd'.repeat(64),
    source: { repository: 'KenLeeYa/Stallorder-Platform', repositoryId: 1298874780, workflowId: 407163998,
      controlCommit, runId: 41, runAttempt: 1, jobId: 126,
      workflowPath: '.github/workflows/delivery-candidate-ci.yml', workflowSha256: hash(workflowBytes),
      sarifBytes: rawSarif.length, sarifSha256: hash(rawSarif) },
    findings: [{ ordinal: 1, ruleId: result.ruleId, resultSha256: hash(JSON.stringify(result)),
      disposition: 'false-positive', rationale: 'The exact reviewed flow has a fixed safe sink.',
      conditions: 'Only these complete scan bytes and the entire product tree are covered.' }] };
  const provenance = { workflowBytes,
    run: { id: 41, run_attempt: 1, workflow_id: 407163998, head_sha: controlCommit, head_branch: 'codex/primary-only-preparation',
      event: 'push', path: review.source.workflowPath, status: 'completed', created_at: '2026-11-04T19:00:00Z',
      repository: { id: 1298874780, full_name: review.source.repository, private: false, fork: false },
      head_repository: { id: 1298874780, full_name: review.source.repository } },
    job: { id: 126, run_id: 41, run_attempt: 1, head_sha: controlCommit, name: 'security', status: 'completed',
      conclusion: 'failure', started_at: '2026-11-04T19:00:01Z', completed_at: '2026-11-04T19:05:00Z',
      runner_name: 'GitHub Actions 1', labels: ['ubuntu-24.04'], steps: [
        ...required.map((name, i) => ({ name, number: i + 1, status: 'completed', conclusion: 'success' })),
        { name: 'Require no unresolved source security findings', number: 5, status: 'completed', conclusion: 'failure' }] },
    productReceipt: { controlCommit, commit: product.commit, tree: product.tree, sourceVerified: true,
      releaseQualified: false } };
  const reviewBytes = Buffer.from(JSON.stringify(review));
  return { rawSarif, reviewBytes, expectedReviewSha256: hash(reviewBytes), product: { ...product }, provenance, now };
}
function rewriteReview(input, edit) {
  const review = JSON.parse(input.reviewBytes); edit(review);
  input.reviewBytes = Buffer.from(JSON.stringify(review)); input.expectedReviewSha256 = hash(input.reviewBytes);
}
test('qualifies only the complete reviewed scan, retaining raw failure and no release authorization', () => {
  assert.deepEqual(verifyReviewedEvidence(fixture()), { rawFindings: 1, reviewedFalsePositives: 1,
    unresolved: 0, sourceRunId: 41, sourceJobId: 126, sourceScanConclusion: 'failure', releaseAuthorized: false });
});
test('rejects changes anywhere in raw SARIF, not only projected result fields', () => {
  for (const mutate of [
    s => { s.runs[0].results[0].relatedLocations[0].physicalLocation.region.startLine++; },
    s => { s.runs[0].results[0].stacks = [{ message: { text: 'different stack' } }]; },
    s => { s.runs[0].artifacts[0].location.uri = 'src/other.ts'; },
    s => { s.runs[0].results[0].rule.index = 99; },
    s => { s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uriBaseId = 'different'; },
    s => { s.runs[0].tool.extensions[0].semanticVersion = 'different'; },
    s => { s.runs[0].invocations[0].exitCode = 1; },
    s => { s.runs[0].results[0].suppressions = {}; },
  ]) {
    const input = fixture(); const s = JSON.parse(input.rawSarif); mutate(s);
    input.rawSarif = Buffer.from(JSON.stringify(s));
    assert.throws(() => verifyReviewedEvidence(input), /complete SARIF/);
  }
});
test('rejects failed extraction, warning, suppression or query drift even if a new review hash is supplied', () => {
  for (const mutate of [
    s => { s.runs[0].invocations[0].executionSuccessful = false; },
    s => { s.runs[0].invocations[0].exitCode = 1; },
    s => { s.runs[0].invocations[0].toolExecutionNotifications = [{ level: 'warning' }]; },
    s => { s.runs[0].invocations[0].toolConfigurationNotifications = [{ level: 'error' }]; },
    s => { s.runs[0].invocations[0].toolExecutionNotifications.push({ level: 'note',
      descriptor: { id: 'js/diagnostics/extraction-errors' } }); },
    s => { s.runs[0].invocations[0].toolExecutionNotifications.pop(); },
    s => { s.runs[0].invocations[0].toolExecutionNotifications = []; },
    s => { const n = s.runs[0].invocations[0].toolExecutionNotifications; n.push(structuredClone(n[0])); },
    s => { const n = s.runs[0].invocations[0].toolExecutionNotifications; n.push(structuredClone(n[1])); },
    s => { s.runs[0].invocations[0].toolExecutionNotifications[0].descriptor.index = 99; },
    s => { s.runs[0].invocations[0].toolExecutionNotifications[1].descriptor.toolComponent.index = 99; },
    s => { s.runs[0].invocations[0].toolExecutionNotifications[0].descriptor.toolComponent = { index: 0 }; },
    s => { s.runs[0].results[0].suppressions = {}; },
    s => { s.runs[0].results[0].suppressions = [{ kind: 'external' }]; },
    s => { s.runs[0].properties.codeqlConfigSummary.disableDefaultQueries = true; },
    s => { s.runs[0].properties.codeqlConfigSummary.queries = []; },
    s => { s.runs[0].results[0].rule.index = 1; },
    s => { s.runs[0].results[0].locations[0].physicalLocation.artifactLocation.index = 1; },
  ]) {
    const input = fixture(); const s = JSON.parse(input.rawSarif); mutate(s);
    input.rawSarif = Buffer.from(JSON.stringify(s));
    rewriteReview(input, r => { r.source.sarifSha256 = hash(input.rawSarif); r.source.sarifBytes = input.rawSarif.length;
      r.findings[0].resultSha256 = hash(JSON.stringify(s.runs[0].results[0])); });
    assert.throws(() => verifyReviewedEvidence(input));
  }
});
test('rejects foreign, replaced, failed or partial authoritative GitHub provenance', () => {
  for (const mutate of [
    p => { p.run.head_repository.full_name = 'other/repo'; },
    p => { p.run.repository.id++; },
    p => { p.run.head_repository.id++; },
    p => { p.run.workflow_id++; },
    p => { p.run.repository.private = true; },
    p => { p.run.run_attempt = 2; },
    p => { p.run.head_sha = 'e'.repeat(40); },
    p => { p.run.path = '.github/workflows/other.yml'; },
    p => { p.run.event = 'pull_request'; },
    p => { p.run.status = 'in_progress'; },
    p => { p.job.run_id++; },
    p => { p.job.id++; },
    p => { p.job.labels = ['self-hosted']; },
    p => { p.job.steps[2].conclusion = 'failure'; },
    p => { p.job.steps[1].conclusion = 'skipped'; },
    p => { p.job.steps.pop(); },
    p => { p.productReceipt.sourceVerified = false; },
    p => { p.productReceipt.commit = 'f'.repeat(40); },
    p => { p.workflowBytes = Buffer.from('changed workflow'); },
  ]) { const input = fixture(); mutate(input.provenance); assert.throws(() => verifyReviewedEvidence(input)); }
});
test('rejects stale or future scan and contradictory execution times', () => {
  for (const mutate of [
    i => { i.now += 24 * 3600_000; },
    i => { i.now = Date.parse('2026-11-04T18:59:00Z'); },
    i => { i.provenance.job.completed_at = '2026-11-04T18:00:00Z'; },
    i => { i.provenance.run.created_at = '2026-11-04T21:00:00Z'; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => verifyReviewedEvidence(input)); }
});
test('rejects changed product, dirty checkout, incomplete review, risk exception and forged release claims', () => {
  for (const edit of [
    r => { r.findings = []; }, r => { r.findings[0].disposition = 'accepted-risk'; },
    r => { r.findings[0].ordinal = 2; }, r => { r.findings[0].resultSha256 = 'f'.repeat(64); },
    r => { r.releaseAuthorized = true; }, r => { r.independentReviewer = ''; },
  ]) { const input = fixture(); rewriteReview(input, edit); assert.throws(() => verifyReviewedEvidence(input)); }
  for (const change of [{ clean: false }, { commit: 'e'.repeat(40) }, { tree: 'e'.repeat(40) }]) {
    const input = fixture(); Object.assign(input.product, change); assert.throws(() => verifyReviewedEvidence(input));
  }
  const input = fixture(); input.reviewBytes = Buffer.concat([input.reviewBytes, Buffer.from(' ')]);
  assert.throws(() => verifyReviewedEvidence(input));
});
