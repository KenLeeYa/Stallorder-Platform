import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { expect, test } from 'vitest';

const workflow = yaml.load(readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8'));
const main = workflow.jobs.validate.steps.find(step => step.name === 'Capture fresh PR366 paired target and run browser QA before cleanup').run;
const resume = readFileSync('scripts/qa-pr366-preview-resume.sh', 'utf8');

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
