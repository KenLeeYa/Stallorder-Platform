import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { expect, test } from 'vitest';

const workflow = yaml.load(readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8'));
const main = workflow.jobs.validate.steps.find(step => step.name === 'Capture fresh PR366 paired target and run browser QA before cleanup').run;
const resume = readFileSync('scripts/qa-pr366-preview-resume.sh', 'utf8');
const ci = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));

test('manual regression runner is isolated from provider writes and full CI remains the default', () => {
  const job = workflow.jobs['regression-local'];
  expect(job.if).toContain("inputs.operation == 'regression-local'");
  expect(job.if).toContain('inputs.approve_external_preview == false');
  expect(job.if).toContain("github.ref_name == 'codex/integrated-production-20261002'");
  expect(job.uses).toBe('./.github/workflows/ci.yml');
  expect(job.secrets).toBeUndefined();
  expect(job.environment).toBeUndefined();
  expect(workflow.concurrency.group).toContain("inputs.operation == 'regression-local' && format('regression-local-{0}', github.ref)");
  expect(ci.on.workflow_call.inputs.regression_only.default).toBe(false);
  const steps = ci.jobs.verify.steps;
  expect(steps.find(step => step.name === 'Playwright end-to-end tests')).toMatchObject({
    if: 'inputs.regression_only != true', run: 'npm run test:e2e',
  });
  expect(steps.find(step => step.name === 'Stop local Supabase').if).toBe('always()');
  expect(steps.find(step => step.name === 'Production-mode resilience smoke').run).toBe('npm run test:e2e:resilience:production');
});

test.each([['validate', main], ['resume', resume]])('%s prepares and binds membership before UI and verifies persisted revocation after UI', (_name, source) => {
  const fixtures = source.indexOf('synthetic-invoices inbox inbox-membership;');
  const binding = source.indexOf('membership:load("inbox-membership")');
  const browser = source.indexOf('node scripts/qa-pr366-preview-ui.mjs .preview-receipt/manual-resources.json .preview-receipt/ui-binding.json .preview-receipt/pr366-ui\n');
  const readback = source.indexOf('inbox-membership-readback .preview-receipt/pr366-ui/inbox-membership-revoked.json');
  expect(fixtures).toBeGreaterThanOrEqual(0); expect(binding).toBeGreaterThan(fixtures);
  expect(browser).toBeGreaterThan(binding); expect(readback).toBeGreaterThan(browser);
});
test.each([['validate', main], ['resume', resume]])('%s verifies midnight rollback between fresh open binding and open UI', (_name, source) => {
  const fresh = source.indexOf('refresh_binding open\n');
  const rollback = source.indexOf('pr366-ui midnight-rollback\n');
  const browser = source.indexOf('pr366-ui hours-open\n');
  expect(fresh).toBeGreaterThanOrEqual(0); expect(rollback).toBeGreaterThan(fresh); expect(browser).toBeGreaterThan(rollback);
});
