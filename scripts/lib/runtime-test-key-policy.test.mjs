import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import yaml from 'js-yaml';
import { hasUnsafeRuntimeTestKeys } from './runtime-test-key-policy.mjs';

const file = '.github/workflows/ephemeral-preview.yml';
const source = readFileSync(file, 'utf8');
test('permits only the approved isolated child/test and Vercel Preview operations', () => {
  expect(hasUnsafeRuntimeTestKeys(file, source)).toBe(false);
});
test.each(['src/runtime.ts', '.github/workflows/production-application-release.yml', 'vercel.json'])('rejects runtime test keys in %s', path => {
  expect(hasUnsafeRuntimeTestKeys(path, 'TURNSTILE_ALLOW_TEST_KEYS=true')).toBe(true);
});
test.each(['approval', 'approval-bypass', 'child-reassignment', 'branch', 'parent', 'production', 'env', 'edge-env', 'missing-child-binding', 'missing-child-guard', 'parent-write', 'job-env', 'production-step', 'other-step'])('rejects isolated scope drift: %s', drift => {
  const workflow = yaml.load(source);
  const steps = workflow.jobs.validate.steps;
  const edge = steps.find(step => step.name === 'Configure PR366 synthetic public ordering in the owned child only');
  const deploy = steps.find(step => step.name === 'Deploy matching Vercel Preview');
  if (drift === 'approval') workflow.jobs.validate.if = "github.event_name == 'push'";
  if (drift === 'approval-bypass') workflow.jobs.validate.if += ' || true';
  if (drift === 'child-reassignment') edge.run += '\nproject_ref="$SUPABASE_PARENT_PROJECT_REF"';
  if (drift === 'branch') edge.if = "github.ref_name == 'main'";
  if (drift === 'parent') edge.run = edge.run.replace('!= "$SUPABASE_PARENT_PROJECT_REF"', '= "$SUPABASE_PARENT_PROJECT_REF"');
  if (drift === 'production') deploy.run = deploy.run.replace('--target preview', '--target production');
  if (drift === 'env') deploy.run = deploy.run.replace('APP_ENV=test', 'APP_ENV=production');
  if (drift === 'edge-env') edge.run = edge.run.replace('APP_ENV=test', 'APP_ENV=production');
  if (drift === 'missing-child-binding') edge.run = edge.run.replace('project_ref="${{ steps.preview.outputs.branch_ref }}"', 'project_ref="$SUPABASE_PARENT_PROJECT_REF"');
  if (drift === 'missing-child-guard') edge.run = edge.run.replace('!= "daeqwtpaxcebmtwxqdkj"', '= "daeqwtpaxcebmtwxqdkj"');
  if (drift === 'parent-write') edge.run += '\nsupabase secrets set --project-ref "$SUPABASE_PARENT_PROJECT_REF" --env-file "$secret_file"';
  if (drift === 'job-env') workflow.jobs.validate.env = { TURNSTILE_ALLOW_TEST_KEYS: true };
  if (drift === 'production-step') steps.push({ name: 'Production deployment', env: { TURNSTILE_ALLOW_TEST_KEYS: 'true' }, run: 'vercel deploy --prod' });
  if (drift === 'other-step') steps.push({ name: 'unguarded runtime', run: 'TURNSTILE_ALLOW_TEST_KEYS=true' });
  expect(hasUnsafeRuntimeTestKeys(file, yaml.dump(workflow))).toBe(true);
});
