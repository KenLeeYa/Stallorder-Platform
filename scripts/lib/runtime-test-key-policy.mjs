import yaml from 'js-yaml';
import { createHash } from 'node:crypto';

const testFlag = /TURNSTILE_ALLOW_TEST_KEYS\s*[:=]\s*["']?true/i;
const officialKey = '1x0000000000000000000000000000000AA';
const branch = 'codex/integrated-production-20261002';
const reviewedSteps = {
  'Configure PR366 synthetic public ordering in the owned child only': 'f3e5c9ff1f06fefdbcd3eaad7366ccaa286b494c4db62d165e240dc835e3915c',
  'Deploy matching Vercel Preview': 'b1091d05b5e7222b73830735d4b148494b34a1d19cb1c1bd56b664ee331128de',
};
const digest = value => createHash('sha256').update(value).digest('hex');

// Only these two explicitly synthetic, approval-gated child/Preview operations may use test keys.
export function hasUnsafeRuntimeTestKeys(file, content) {
  if (!testFlag.test(content)) return false;
  if (file !== '.github/workflows/ephemeral-preview.yml') return true;
  let workflow;
  try { workflow = yaml.load(content); } catch { return true; }
  const job = workflow?.jobs?.validate;
  if (typeof job?.if !== 'string' || digest(job.if) !== '2307419fe417a7d5f11bf9d5d53f3d1d7bbe43280a15d884fb4ef9d484832282') return true;
  const permitted = new Set();
  for (const [index, step] of (job.steps ?? []).entries()) {
    if (!testFlag.test(step.run ?? '')) continue;
    if (digest(JSON.stringify({ if: step.if ?? null, run: step.run })) !== reviewedSteps[step.name]) return true;
    if (step.name === 'Configure PR366 synthetic public ordering in the owned child only') {
      if (step.if !== `github.ref_name == '${branch}'` || !step.run.includes('APP_ENV=test')
        || !step.run.includes(officialKey) || !step.run.includes('!= "$SUPABASE_PARENT_PROJECT_REF"')
        || !step.run.includes('!= "daeqwtpaxcebmtwxqdkj"')
        || !step.run.includes('project_ref="${{ steps.preview.outputs.branch_ref }}"')
        || /--project-ref\s+["']?(?:\$SUPABASE_PARENT_PROJECT_REF|eyuctbnlvnbnivwasvqr|daeqwtpaxcebmtwxqdkj)/.test(step.run)
        || /APP_ENV=(?!test\b)[a-z]+/i.test(step.run)
        || !step.run.includes('--project-ref "$project_ref" --env-file "$secret_file"')) return true;
    } else if (step.name === 'Deploy matching Vercel Preview') {
      const block = step.run.match(/if \[ "\$PREVIEW_GIT_BRANCH" = "codex\/integrated-production-20261002" \]; then[\s\S]*?\n\s*fi/);
      if (!block || !block[0].includes('"APP_ENV=test"') || !block[0].includes(officialKey)
        || testFlag.test(step.run.replace(block[0], '')) || !/--target preview\b/.test(step.run)
        || /--prod\b|--target production\b/.test(step.run)) return true;
    } else return true;
    permitted.add(`jobs.validate.steps.${index}.run`);
  }
  let unsafe = false;
  function visit(value, location = '') {
    if (location.endsWith('.TURNSTILE_ALLOW_TEST_KEYS') && (value === true || value === 'true')) unsafe = true;
    else if (typeof value === 'string' && testFlag.test(value) && !permitted.has(location)) unsafe = true;
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, location ? `${location}.${key}` : key);
  }
  visit(workflow);
  return unsafe;
}
