import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capturePrimaryBaseline } from './qa-pr366-preview-binding.mjs';
const project = 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team = 'team_MMfsiG94K9Zy3e6w7Ccc9xY4';
const fail = code => { throw Error(code); };
export function assertPrimaryConfiguration(env) {
  if (env.VERCEL_PROJECT_ID !== project || env.VERCEL_ORG_ID !== team || env.APP_BASE_URL !== 'https://app.qidaigo.com') fail('RELEASE_PRIMARY_CONFIGURATION_DRIFT');
}
export async function verifyReleaseTarget(expected, api, { promoted = false, baseline } = {}) {
  if (!expected || !/^[a-f0-9]{40}$/.test(expected.sha ?? '') || !/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(expected.deployment ?? '')) fail('RELEASE_TARGET_ARGUMENTS_INVALID');
  const deployment = await api(`/v13/deployments/${encodeURIComponent(new URL(expected.deployment).hostname)}?teamId=${team}`);
  const owner = await api(`/v9/projects/${project}?teamId=${team}`);
  if (!/^dpl_[A-Za-z0-9]+$/.test(deployment?.id ?? '') || deployment.projectId !== project || owner?.id !== project || owner.accountId !== team
    || deployment.target !== 'production' || deployment.readyState !== 'READY' || deployment.url !== new URL(expected.deployment).hostname
    || (deployment.meta?.git_commit ?? deployment.meta?.githubCommitSha) !== expected.sha) fail('RELEASE_TARGET_IDENTITY_DRIFT');
  if (!promoted) {
    if (!baseline?.deploymentId || !baseline?.sha || owner.targets?.production?.id !== baseline.deploymentId) fail('RELEASE_PRIMARY_CHANGED_DURING_BUILD');
    const actual = await capturePrimaryBaseline({ deploymentId: baseline.deploymentId, sha: baseline.sha }, api);
    if (JSON.stringify(actual.aliases) !== JSON.stringify(baseline.aliases)) fail('RELEASE_PRIMARY_CHANGED_DURING_BUILD');
  }
  const aliases = await api(`/v2/deployments/${encodeURIComponent(deployment.id)}/aliases?teamId=${team}`);
  if (!Array.isArray(aliases.aliases) || aliases.pagination?.next || aliases.aliases.some(row => typeof row.alias !== 'string' || !row.alias)) fail('RELEASE_ALIASES_UNPROVEN');
  const names = aliases.aliases.map(row => row.alias).sort();
  if (promoted && (owner.targets?.production?.id !== deployment.id || !baseline?.aliases?.includes('app.qidaigo.com')
    || JSON.stringify(names) !== JSON.stringify([...baseline.aliases].sort()))) fail('RELEASE_PROMOTION_DRIFT');
  return { projectId: project, teamId: team, deploymentId: deployment.id, url: expected.deployment, sha: expected.sha,
    readyState: deployment.readyState, target: deployment.target, aliases: names, productionDeploymentId: owner.targets?.production?.id,
    checkedAt: new Date().toISOString(), status: promoted ? 'PROMOTION_READBACK_VERIFIED' : 'CANDIDATE_READBACK_VERIFIED' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assertPrimaryConfiguration(process.env);
    if (!process.env.VERCEL_TOKEN) fail('RELEASE_TOKEN_REQUIRED');
    const api = async path => { const response = await fetch(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(30000) }); if (!response.ok) fail('RELEASE_PROVIDER_READBACK_FAILED'); return response.json(); };
    const mode = process.argv[2], output = process.argv[3]; let result;
    if (mode === 'baseline') {
      result = await capturePrimaryBaseline({ deploymentId: process.env.RELEASE_HEALTHY_DEPLOYMENT_ID, sha: process.env.RELEASE_HEALTHY_SHA }, api);
      if (!result.aliases.includes('app.qidaigo.com')) fail('RELEASE_PRIMARY_ALIAS_MISSING');
    } else if (mode === 'candidate' || mode === 'promoted') {
      result = await verifyReleaseTarget({ deployment: process.env.APPROVED_PRODUCTION_DEPLOYMENT, sha: process.env.GITHUB_SHA }, api,
        { promoted: mode === 'promoted', baseline: JSON.parse(readFileSync(process.argv[4], 'utf8')) });
    } else if (mode === 'recovered') {
      const baseline = JSON.parse(readFileSync(process.argv[4], 'utf8'));
      result = await capturePrimaryBaseline({ deploymentId: baseline.deploymentId, sha: baseline.sha }, api);
      if (JSON.stringify(result.aliases) !== JSON.stringify(baseline.aliases)) fail('RELEASE_RECOVERY_ALIAS_DRIFT');
      result.status = 'RECOVERY_READBACK_VERIFIED';
    } else fail('RELEASE_MODE_INVALID');
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    if (mode === 'baseline') console.log(`RELEASE_ROLLBACK_DEPLOYMENT=${result.deploymentId}`);
  } catch (error) { console.error(/^RELEASE_[A-Z_]+$|^BINDING_[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_TARGET_FAILED'); process.exitCode = 1; }
}
