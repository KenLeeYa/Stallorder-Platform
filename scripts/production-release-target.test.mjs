import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { assertPrimaryConfiguration, verifyReleaseTarget } from './production-release-target.mjs';
const project = 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team = 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', sha = 'a'.repeat(40);
test('approved Production artifact overrides inherited platform sender settings until separately activated', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/production-readiness.yml', 'utf8'));
  const build = workflow.jobs['verify-remote'].steps.find(step => step.name === 'Build approved Production deployment without assigning domains').run;
  for (const flag of ['LINE_PLATFORM_ENABLED', 'LINE_PLATFORM_NOTIFICATIONS_ENABLED']) {
    expect(build).toContain(`--build-env "${flag}=false"`);
    expect(build).toContain(`-e "${flag}=false"`);
    expect(build).not.toContain(`${flag}=true`);
  }
  expect(build).toContain('--skip-domain');
});
test('DR artifact also overrides inherited deferred integration and governance flags at build and runtime', () => {
  const source = readFileSync('scripts/manage-dr-operator-entry.mjs', 'utf8');
  const buildAndRuntime = source.slice(source.indexOf('const buildAndRuntime = {'), source.indexOf('const runtimeOnly = {'));
  for (const flag of ['LINE_PLATFORM_ENABLED', 'LINE_PLATFORM_NOTIFICATIONS_ENABLED', 'COMPLIANCE_ENABLED']) {
    expect(buildAndRuntime).toContain(`${flag}: "false"`);
  }
  expect(buildAndRuntime).toContain('COMPLIANCE_DELETION_DRY_RUN: "true"');
  expect(source).toContain('deploymentArgs.push("--build-env", `${name}=${value}`, "--env", `${name}=${value}`)');
});
function fixture() {
  const deployment = { id: 'dpl_candidate', projectId: project, target: 'production', readyState: 'READY', url: 'candidate.vercel.app', meta: { git_commit: sha } };
  const owner = { id: project, accountId: team, targets: { production: { id: deployment.id } } };
  const aliases = { aliases: [{ alias: 'app.qidaigo.com' }, { alias: 'stable.vercel.app' }] };
  const healthy = { ...deployment, id: 'dpl_healthy', meta: { git_commit: 'b'.repeat(40) } };
  const api = async path => path.startsWith('/v13/deployments/dpl_healthy') ? healthy : path.startsWith('/v13/') ? deployment : path.startsWith('/v9/') ? owner : aliases;
  return { deployment, owner, aliases, api, expected: { deployment: 'https://candidate.vercel.app', sha }, baseline: { deploymentId: 'dpl_healthy', sha: 'b'.repeat(40), aliases: ['app.qidaigo.com', 'stable.vercel.app'] } };
}
test('requires exact Primary variables, not DR or an inferred project', () => {
  const env = { VERCEL_PROJECT_ID: project, VERCEL_ORG_ID: team, APP_BASE_URL: 'https://app.qidaigo.com' };
  expect(() => assertPrimaryConfiguration(env)).not.toThrow();
  for (const patch of [{ VERCEL_PROJECT_ID: 'dr' }, { VERCEL_ORG_ID: 'other' }, { APP_BASE_URL: 'https://other.example' }]) expect(() => assertPrimaryConfiguration({ ...env, ...patch })).toThrow('CONFIGURATION_DRIFT');
});
test('accepts exact READY production candidate with git_commit metadata and complete promoted alias set', async () => {
  const f = fixture(); f.owner.targets.production.id = 'dpl_healthy'; expect((await verifyReleaseTarget(f.expected, f.api, { baseline: f.baseline })).deploymentId).toBe('dpl_candidate');
  f.owner.targets.production.id = 'dpl_candidate';
  expect((await verifyReleaseTarget(f.expected, f.api, { promoted: true, baseline: f.baseline })).status).toBe('PROMOTION_READBACK_VERIFIED');
});
test.each(['project', 'team', 'source', 'target', 'state', 'url'])('rejects candidate drift: %s', async kind => {
  const f = fixture();
  if (kind === 'project') f.deployment.projectId = 'other';
  if (kind === 'team') f.owner.accountId = 'other';
  if (kind === 'source') f.deployment.meta.git_commit = 'b'.repeat(40);
  if (kind === 'target') f.deployment.target = 'preview';
  if (kind === 'state') f.deployment.readyState = 'BUILDING';
  if (kind === 'url') f.deployment.url = 'different.vercel.app';
  await expect(verifyReleaseTarget(f.expected, f.api)).rejects.toThrow('IDENTITY_DRIFT');
});
test('rejects partial aliases, changed production pointer and unexpected alias transfer', async () => {
  const f = fixture(); f.owner.targets.production.id = 'dpl_healthy'; f.aliases.pagination = { next: 1 };
  await expect(verifyReleaseTarget(f.expected, f.api, { baseline: f.baseline })).rejects.toThrow('BINDING_ALIASES_INVALID');
  delete f.aliases.pagination; f.owner.targets.production.id = 'dpl_previous';
  await expect(verifyReleaseTarget(f.expected, f.api, { promoted: true, baseline: f.baseline })).rejects.toThrow('PROMOTION_DRIFT');
  f.owner.targets.production.id = 'dpl_candidate'; f.aliases.aliases.push({ alias: 'unapproved.example' });
  await expect(verifyReleaseTarget(f.expected, f.api, { promoted: true, baseline: f.baseline })).rejects.toThrow('PROMOTION_DRIFT');
});


test('candidate rejects build that changed Primary before migration', async () => {
  const f = fixture();
  await expect(verifyReleaseTarget(f.expected, f.api, { baseline: f.baseline })).rejects.toThrow('PRIMARY_CHANGED_DURING_BUILD');
  f.owner.targets.production.id = 'dpl_healthy'; f.aliases.aliases.push({ alias: 'unexpected.example' });
  await expect(verifyReleaseTarget(f.expected, f.api, { baseline: f.baseline })).rejects.toThrow('PRIMARY_CHANGED_DURING_BUILD');
});
