import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assertOwner(env) {
  if (!/^manual-[1-9][0-9]*$/.test(env.PREVIEW_RESOURCE_KEY ?? '') || env.PREVIEW_BRANCH_NAME !== env.PREVIEW_RESOURCE_KEY
    || !env.SUPABASE_PARENT_PROJECT_REF || !env.PREVIEW_GIT_BRANCH) throw Error('PREVIEW_OWNER_INVALID');
}
export function ownedBranches(rows, env) {
  if (!Array.isArray(rows)) throw Error('BRANCH_READBACK_INVALID');
  const matches = rows.filter(row => row.name === env.PREVIEW_BRANCH_NAME);
  if (matches.length > 1 || matches.some(row => !row.project_ref || row.project_ref === env.SUPABASE_PARENT_PROJECT_REF
    || row.with_data !== false || row.git_branch !== env.PREVIEW_GIT_BRANCH)) throw Error('BRANCH_IDENTITY_MISMATCH');
  return matches;
}
export function assertDeployment(row, env) {
  if (!row || !row.id || row.projectId !== env.VERCEL_PROJECT_ID || row.target === 'production'
    || row.meta?.stallorderPreviewResource !== env.PREVIEW_RESOURCE_KEY
    || row.meta?.githubCommitRef !== env.PREVIEW_GIT_BRANCH) throw Error('DEPLOYMENT_IDENTITY_MISMATCH');
}
export function approvedExpiry(env, now) {
  if (env.PREVIEW_GIT_BRANCH !== 'codex/integrated-production-20261002') return new Date(now.getTime() + 6 * 3600000);
  if (env.PREVIEW_APPROVED_DEADLINE_UTC !== '2026-10-07T20:30:00Z') throw Error('PREVIEW_APPROVED_DEADLINE_INVALID');
  const deadline = new Date(env.PREVIEW_APPROVED_DEADLINE_UTC);
  if (now < new Date('2026-10-07T17:30:00Z')) throw Error('PREVIEW_APPROVAL_NOT_STARTED');
  if (now >= deadline) throw Error('PREVIEW_APPROVAL_EXPIRED');
  const expiry = new Date(Math.min(now.getTime() + 3 * 3600000, deadline.getTime()));
  if (expiry.getTime() - now.getTime() < 75 * 60000) throw Error('PREVIEW_APPROVAL_WINDOW_TOO_SHORT');
  return expiry;
}
export async function run(env, { cli, api, save, previous, now = new Date() }, operation) {
  if (!['capture', 'cleanup'].includes(operation)) throw Error('PREVIEW_OPERATION_INVALID');
  assertOwner(env);
  const receipt = previous ?? { resourceKey: env.PREVIEW_RESOURCE_KEY, branchName: env.PREVIEW_BRANCH_NAME,
    gitBranch: env.PREVIEW_GIT_BRANCH, parent: env.SUPABASE_PARENT_PROJECT_REF,
    team: env.VERCEL_ORG_ID ?? null, project: env.VERCEL_PROJECT_ID ?? null,
    createdAt: now.toISOString(), expiresAt: approvedExpiry(env, now).toISOString(), branches: [], deployments: [] };
  if (receipt.resourceKey !== env.PREVIEW_RESOURCE_KEY || receipt.parent !== env.SUPABASE_PARENT_PROJECT_REF
    || receipt.gitBranch !== env.PREVIEW_GIT_BRANCH || receipt.team !== (env.VERCEL_ORG_ID ?? null)
    || receipt.project !== (env.VERCEL_PROJECT_ID ?? null)) throw Error('RECEIPT_IDENTITY_MISMATCH');
  save(receipt);
  try {
    const list = () => ownedBranches(JSON.parse(cli('supabase', ['branches', 'list', '--project-ref', receipt.parent, '--output', 'json', '--log-level', 'error'])), env);
    const branches = list();
    for (const row of branches) {
      if (receipt.branches.length && !receipt.branches.some(item => item.id === row.project_ref)) throw Error('BRANCH_REPLACED');
      if (!receipt.branches.length) receipt.branches.push({ id: row.project_ref, name: row.name });
    }
    save(receipt);
    if (env.VERCEL_TOKEN) {
      if (!env.VERCEL_ORG_ID || !env.VERCEL_PROJECT_ID) throw Error('VERCEL_SCOPE_MISSING');
      const listing = JSON.parse(cli('npx', ['--yes', 'vercel@58.3.0', 'list', env.VERCEL_PROJECT_ID, '--scope', env.VERCEL_ORG_ID,
        '--meta', `stallorderPreviewResource=${env.PREVIEW_RESOURCE_KEY}`, '--limit', '100', '--json', '--token', env.VERCEL_TOKEN]));
      if (!Array.isArray(listing.deployments) || listing.deployments.length >= 100) throw Error('DEPLOYMENT_LIST_INCOMPLETE');
      for (const item of listing.deployments) {
        const id = item.uid ?? item.id;
        const hostname = !id && typeof item.url === 'string'
          ? /^(?:https:\/\/)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app)\/?$/.exec(item.url)?.[1] : null;
        if (!id && !hostname) throw Error('DEPLOYMENT_ID_MISSING');
        const row = await api('GET', id ?? hostname); assertDeployment(row, env);
        if (hostname && (row.url !== hostname || !/^dpl_[A-Za-z0-9]+$/.test(row.id))) throw Error('DEPLOYMENT_IDENTITY_MISMATCH');
        if (id && row.id !== id) throw Error('DEPLOYMENT_IDENTITY_MISMATCH');
        if (!receipt.deployments.some(known => known.id === row.id)) receipt.deployments.push({ id: row.id, project: row.projectId, target: row.target ?? 'preview' });
      }
      save(receipt);
    } else if (receipt.deployments.length) throw Error('VERCEL_AUTH_MISSING');
    if (operation === 'cleanup') {
      for (const item of receipt.deployments) {
        const row = await api('GET', item.id);
        if (row) { assertDeployment(row, env); await api('DELETE', item.id); }
        if (await api('GET', item.id)) throw Error('DEPLOYMENT_STILL_PRESENT');
        item.absent = true; save(receipt);
      }
      for (const item of receipt.branches) {
        const current = list();
        if (current.length) {
          if (current[0].project_ref !== item.id) throw Error('BRANCH_REPLACED');
          cli('supabase', ['branches', 'delete', item.name, '--project-ref', receipt.parent, '--yes', '--log-level', 'error']);
        }
        if (list().length) throw Error('BRANCH_STILL_PRESENT');
        item.absent = true; save(receipt);
      }
      receipt.status = 'CLEANED';
    } else receipt.status = 'CAPTURED';
    save(receipt); return receipt;
  } catch (error) { receipt.status = 'RECOVERY_REQUIRED'; receipt.error = /^[A-Z_]+$/.test(error.message) ? error.message : 'PROVIDER_OPERATION_FAILED'; save(receipt); throw Error(receipt.error); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const file = '.preview-receipt/manual-resources.json'; mkdirSync('.preview-receipt', { recursive: true });
  const cli = (command, args) => { try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }); } catch { throw Error('PROVIDER_OPERATION_FAILED'); } };
  const api = async (method, id) => {
    const response = await fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`, { method,
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(30000) });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok) throw Error('VERCEL_OPERATION_FAILED');
    return method === 'DELETE' ? null : response.json();
  };
  try { await run(env, { cli, api, previous: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null,
    save: receipt => writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n') }, process.argv[2] ?? 'capture'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
