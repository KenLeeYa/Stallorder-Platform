import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';

const workflow = load(readFileSync(new URL('../.github/workflows/ephemeral-preview.yml', import.meta.url), 'utf8'));
const job = workflow.jobs['deployment-evidence'];

test('only an explicit evidence request creates the required Vercel context', () => {
  assert.equal(job.name, "${{ github.event_name == 'workflow_dispatch' && inputs.operation == 'verify-deployment-evidence' && 'Vercel' || 'deployment-evidence-not-requested' }}");
  assert.equal(job.if, "github.event_name == 'workflow_dispatch' && inputs.operation == 'verify-deployment-evidence'");
  const request = job.steps.find(step => step.name === 'Require the authorized read-only verification request');
  assert.match(request.run, /test "\$APPROVE_EXTERNAL_PREVIEW" = 'false'/);
  assert.match(request.run, /\[\[ "\$GITHUB_REF_NAME" = 'codex\/integrated-production-20261002' \|\| "\$GITHUB_REF_NAME" = 'staging' \]\]/);
  assert.match(request.run, /\[\[ "\$VALIDATION_RUN_ID" =~ \^\[1-9\]\[0-9\]\{0,19\}\$ \]\]/);
  // Invalid source or flag must fail inside a requested check, never skip that required check.
  assert.doesNotMatch(job.if, /approve_external_preview|conclusion|cleanup_run_id|head_sha|ref_name/);
});

test('evidence reads cannot cancel a validation writer or mutate provider resources', () => {
  assert.match(workflow.concurrency.group, /format\('deployment-evidence-\{0\}', inputs.cleanup_run_id\)/);
  assert.match(workflow.concurrency['cancel-in-progress'], /"verify-deployment-evidence"/);
  assert.deepEqual(job.permissions, { contents: 'read', actions: 'read' });
  assert.equal(job.environment.name, 'Preview');
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.doesNotMatch(commands, /vercel deploy|secrets set|branches create|db reset|gh api.*statuses|manual-preview-cleanup\.mjs cleanup/);
  assert.doesNotMatch(commands, /\$\{\{ inputs\./);
  assert.match(commands, /gh run download "\$VALIDATION_RUN_ID"/);
  assert.match(commands, /manual-preview-final-\$VALIDATION_RUN_ID/);
  assert.match(commands, /pr366-browser-qa-\$VALIDATION_RUN_ID/);
  assert.match(commands, /verify-pr366-deployment-evidence\.mjs "\$VALIDATION_RUN_ID"/);
});

test('failure evidence preservation does not turn verification into an optional step', () => {
  const verify = job.steps.find(step => step.name === 'Verify repository-owned deployment gate with fresh provider reads');
  assert.equal(verify.if, undefined);
  assert.equal(verify['continue-on-error'], undefined);
  const preserve = job.steps.find(step => step.name === 'Preserve the sanitized repository-owned gate receipt');
  assert.equal(preserve.if, 'always()');
  assert.equal(preserve.with.path, '.deployment-proof/result.json');
});
