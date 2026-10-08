import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { run, ownedBranches, assertDeployment, approvedExpiry } from './manual-preview-cleanup.mjs';
const env = { PREVIEW_RESOURCE_KEY: 'manual-123', PREVIEW_BRANCH_NAME: 'manual-123', PREVIEW_GIT_BRANCH: 'candidate', SUPABASE_PARENT_PROJECT_REF: 'parent', VERCEL_ORG_ID: 'team', VERCEL_PROJECT_ID: 'project', VERCEL_TOKEN: 'synthetic' };
test('paid creation rechecks remaining time after watcher wait without changing the receipt', () => {
  const approved = { ...env, PREVIEW_GIT_BRANCH: 'codex/integrated-production-20261002', PREVIEW_APPROVED_DEADLINE_UTC: '2026-10-08T22:00:00Z' };
  expect(approvedExpiry(approved, new Date('2026-10-08T16:00:00Z')).toISOString()).toBe('2026-10-08T19:00:00.000Z');
  expect(approvedExpiry(approved, new Date('2026-10-08T19:00:00Z')).toISOString()).toBe('2026-10-08T22:00:00.000Z');
  expect(approvedExpiry(approved, new Date('2026-10-08T20:45:00Z')).toISOString()).toBe('2026-10-08T22:00:00.000Z');
  expect(() => approvedExpiry(approved, new Date('2026-10-08T20:45:01Z'))).toThrow('PREVIEW_APPROVAL_WINDOW_TOO_SHORT');
  expect(() => approvedExpiry({ ...approved, PREVIEW_APPROVED_DEADLINE_UTC: '2026-10-08T14:00:00Z' }, new Date('2026-10-08T16:00:00Z'))).toThrow('PREVIEW_APPROVED_DEADLINE_INVALID');
  const workflow = readFileSync(new URL('../.github/workflows/ephemeral-preview.yml', import.meta.url), 'utf8');
  expect(workflow).toMatch(/approvedExpiry\(process\.env, new Date\(\)\);"\s+supabase branches create/);
});
const branch = { name: 'manual-123', project_ref: 'child', with_data: false, git_branch: 'candidate' };
const deployment = { id: 'dpl_test', url: 'owned-preview.vercel.app', projectId: 'project', target: null, meta: { stallorderPreviewResource: 'manual-123', githubCommitRef: 'candidate' } };
function harness({ remain = false, failure = false, mismatch = false } = {}) {
  let branches = [branch], current = { ...deployment, projectId: mismatch ? 'other' : 'project' }, saved;
  const deleted = [];
  return { deleted, get saved() { return saved; }, adapters: {
    now: new Date('2026-10-03T00:00:00Z'), save: item => { saved = structuredClone(item); },
    cli(command, args) { if (command === 'npx') return JSON.stringify({ deployments: current ? [{ uid: current.id }] : [] });
      if (args.includes('delete')) { deleted.push('branch'); if (failure) throw Error('secret-bearing-provider-text'); if (!remain) branches = []; return ''; }
      return JSON.stringify(branches); },
    async api(method) { if (method === 'DELETE') { deleted.push('deployment'); if (failure) throw Error('secret-bearing-provider-text'); if (!remain) current = null; return null; } return current; },
  } };
}
test('exact owned resources are deleted and independently read back absent', async () => {
  const h = harness(); const receipt = await run(env, h.adapters, 'cleanup');
  expect(h.deleted).toEqual(['deployment', 'branch']); expect(receipt.status).toBe('CLEANED');
  expect(receipt.expiresAt).toBe('2026-10-03T06:00:00.000Z');
  expect(receipt.deployments[0].absent).toBe(true); expect(receipt.branches[0].absent).toBe(true);
  expect(receipt.cleanupStartedAt).toBe('2026-10-03T00:00:00.000Z');
  expect(Number.isFinite(Date.parse(receipt.cleanupCompletedAt))).toBe(true);
});
test('capture does not mutate providers and deadline does not extend on replay', async () => {
  const h = harness(); const first = await run(env, h.adapters, 'capture');
  expect(h.deleted).toEqual([]);
  const next = await run(env, { ...h.adapters, previous: first, now: new Date('2026-10-03T05:00:00Z') }, 'capture');
  expect(next.expiresAt).toBe(first.expiresAt);
});
test('recovered original receipt cleans idempotently when providers are already empty', async () => {
  const recovered = { resourceKey: env.PREVIEW_RESOURCE_KEY, branchName: env.PREVIEW_BRANCH_NAME,
    gitBranch: env.PREVIEW_GIT_BRANCH, parent: env.SUPABASE_PARENT_PROJECT_REF,
    team: env.VERCEL_ORG_ID, project: env.VERCEL_PROJECT_ID,
    createdAt: '2026-10-03T00:00:00.000Z', expiresAt: '2026-10-03T06:00:00.000Z',
    branches: [{ id: 'child', name: env.PREVIEW_BRANCH_NAME, absent: false }], deployments: [], status: 'RECOVERY_VERIFIED' };
  const deleted = [];
  const result = await run(env, { previous: recovered, save: () => {},
    cli(command, args) { if (args.includes('delete')) deleted.push('branch');
      return command === 'npx' ? JSON.stringify({ deployments: [] }) : JSON.stringify([]); },
    api() { deleted.push('deployment'); throw Error('UNEXPECTED_PROVIDER_CALL'); },
  }, 'cleanup');
  expect(deleted).toEqual([]);
  expect(result).toMatchObject({ status: 'CLEANED', branches: [{ id: 'child', absent: true }], deployments: [] });
});
test('PR366 manual receipt expires at the earlier of 3 hours and the approved cutoff', async () => {
  const approved = { ...env, PREVIEW_GIT_BRANCH: 'codex/integrated-production-20261002', PREVIEW_APPROVED_DEADLINE_UTC: '2026-10-08T22:00:00Z' };
  const h = harness();
  const cli = h.adapters.cli;
  h.adapters.cli = (command, args) => command === 'npx' ? cli(command, args)
    : JSON.stringify(JSON.parse(cli(command, args)).map(row => ({ ...row, git_branch: approved.PREVIEW_GIT_BRANCH })));
  h.adapters.api = async () => ({ ...deployment, meta: { ...deployment.meta, githubCommitRef: approved.PREVIEW_GIT_BRANCH } });
  const first = await run(approved, { ...h.adapters, now: new Date('2026-10-08T16:00:00Z') }, 'capture');
  expect(first.expiresAt).toBe('2026-10-08T19:00:00.000Z');
  const second = await run(approved, { ...h.adapters, now: new Date('2026-10-08T17:00:00Z') }, 'capture');
  expect(second.expiresAt).toBe('2026-10-08T20:00:00.000Z');
  await expect(run(approved, { ...h.adapters, now: new Date('2026-10-08T15:59:59Z') }, 'capture')).rejects.toThrow('PREVIEW_APPROVAL_NOT_STARTED');
  await expect(run(approved, { ...h.adapters, now: new Date('2026-10-08T22:00:00Z') }, 'capture')).rejects.toThrow('PREVIEW_APPROVAL_EXPIRED');
  expect((await run(approved, { ...h.adapters, now: new Date('2026-10-08T20:45:00Z') }, 'capture')).expiresAt).toBe('2026-10-08T22:00:00.000Z');
  await expect(run(approved, { ...h.adapters, now: new Date('2026-10-08T20:45:01Z') }, 'capture')).rejects.toThrow('PREVIEW_APPROVAL_WINDOW_TOO_SHORT');
  await expect(run(approved, { ...h.adapters, now: new Date('2026-10-08T21:00:00Z') }, 'capture')).rejects.toThrow('PREVIEW_APPROVAL_WINDOW_TOO_SHORT');
  for (const oldDeadline of ['2026-10-08T09:00:00Z', '2026-10-08T14:00:00Z', '2026-10-08T15:00:00Z', '2026-10-08T18:30:00Z']) {
    await expect(run({ ...approved, PREVIEW_APPROVED_DEADLINE_UTC: oldDeadline }, h.adapters, 'capture')).rejects.toThrow('PREVIEW_APPROVED_DEADLINE_INVALID');
  }
  await expect(run({ ...approved, PREVIEW_APPROVED_DEADLINE_UTC: '2026-10-08T19:00:00Z' }, h.adapters, 'capture')).rejects.toThrow('PREVIEW_APPROVED_DEADLINE_INVALID');
});
test('provider deletion failure saves sanitized exact recovery receipt and fails', async () => {
  const h = harness({ failure: true }); await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('PROVIDER_OPERATION_FAILED');
  expect(h.saved.status).toBe('RECOVERY_REQUIRED'); expect(JSON.stringify(h.saved)).not.toContain('secret-bearing'); expect(h.saved.deployments[0].id).toBe('dpl_test');
});
test('successful delete response cannot conceal remaining deployment', async () => {
  const h = harness({ remain: true }); await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('DEPLOYMENT_STILL_PRESENT'); expect(h.deleted).toEqual(['deployment']);
});
test('other project or Production deployment prevents deletion', async () => {
  const h = harness({ mismatch: true }); await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('DEPLOYMENT_IDENTITY_MISMATCH'); expect(h.deleted).toEqual([]);
  expect(() => assertDeployment({ ...deployment, target: 'production' }, env)).toThrow();
});
test('parent, with-data and changed owner are rejected', () => {
  for (const row of [{ ...branch, project_ref: 'parent' }, { ...branch, with_data: true }, { ...branch, git_branch: 'other' }]) expect(() => ownedBranches([row], env)).toThrow();
  expect(() => ownedBranches([branch, branch], env)).toThrow();
});
test('unknown operation refuses all provider calls and receipt writes', async () => {
  const forbidden = () => { throw Error('UNEXPECTED_PROVIDER_CALL'); };
  await expect(run(env, { cli: forbidden, api: forbidden, save: forbidden }, 'cleanupp')).rejects.toThrow('PREVIEW_OPERATION_INVALID');
});
test('missing recovered run owner and forged receipt scope refuse provider calls', async () => {
  const forbidden = () => { throw Error('UNEXPECTED_PROVIDER_CALL'); };
  const h = harness();
  await expect(run({ ...env, PREVIEW_RESOURCE_KEY: undefined }, { cli: forbidden, api: forbidden, save: forbidden }, 'cleanup'))
    .rejects.toThrow('PREVIEW_OWNER_INVALID');
  const receipt = { resourceKey: env.PREVIEW_RESOURCE_KEY, branchName: env.PREVIEW_BRANCH_NAME,
    gitBranch: env.PREVIEW_GIT_BRANCH, parent: env.SUPABASE_PARENT_PROJECT_REF,
    team: env.VERCEL_ORG_ID, project: env.VERCEL_PROJECT_ID, branches: [], deployments: [] };
  for (const patch of [{ resourceKey: 'manual-124' }, { parent: 'other-parent' }, { project: 'other-project' },
    { gitBranch: 'other-branch' }, { team: 'other-team' }]) {
    await expect(run(env, { ...h.adapters, previous: { ...receipt, ...patch } }, 'cleanup')).rejects.toThrow('RECEIPT_IDENTITY_MISMATCH');
  }
  expect(h.deleted).toEqual([]);
});
test('missing deployment readback reports explicit identity error', () => {
  expect(() => assertDeployment(null, env)).toThrow('DEPLOYMENT_IDENTITY_MISMATCH');
  expect(() => assertDeployment(undefined, env)).toThrow('DEPLOYMENT_IDENTITY_MISMATCH');
});
test('Vercel 58.3.0 list JSON deployments.id shape is supported', async () => {
  const h = harness();
  const cli = h.adapters.cli;
  h.adapters.cli = (command, args) => {
    const output = cli(command, args);
    if (command !== 'npx') return output;
    const listing = JSON.parse(output);
    listing.deployments = listing.deployments.map(item => ({ id: item.uid }));
    return JSON.stringify(listing);
  };
  const receipt = await run(env, h.adapters, 'cleanup');
  expect(receipt.deployments[0].id).toBe('dpl_test'); expect(receipt.status).toBe('CLEANED');
});
test('workflow saves recoverable receipts before mutation and at paired/final stages', () => {
  const workflow = readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8');
  expect(workflow.indexOf('Upload initial manual Preview recovery receipt')).toBeLessThan(workflow.indexOf('Create or reuse data-less Preview Branch'));
  expect(workflow).toContain('Upload paired manual Preview deployment receipt');
  const cleanup = workflow.slice(workflow.indexOf('name: Clean exact manual Preview resources'), workflow.indexOf('\n  cleanup:'));
  expect(cleanup).toContain('always()'); expect(cleanup).not.toContain('|| true'); expect(cleanup).toContain('Upload final manual Preview cleanup or recovery receipt');
});

test('URL-only deployment listing resolves and saves provider ID before cleanup', async () => {
  const h = harness();
  const cli = h.adapters.cli, api = h.adapters.api;
  const requests = [];
  h.adapters.cli = (command, args) => command === 'npx'
    ? JSON.stringify({ deployments: [{ url: 'owned-preview.vercel.app' }] }) : cli(command, args);
  h.adapters.api = (method, id) => { requests.push([method, id]); return api(method, id); };
  const receipt = await run(env, h.adapters, 'cleanup');
  expect(requests[0]).toEqual(['GET', 'owned-preview.vercel.app']);
  expect(requests).toContainEqual(['DELETE', 'dpl_test']);
  expect(receipt.deployments[0].id).toBe('dpl_test');
  expect(receipt.status).toBe('CLEANED');
});

test('URL-only identity mismatch prevents all deletion', async () => {
  const h = harness({ mismatch: true });
  h.adapters.cli = command => command === 'npx'
    ? JSON.stringify({ deployments: [{ url: 'https://owned-preview.vercel.app' }] }) : JSON.stringify([branch]);
  await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('DEPLOYMENT_IDENTITY_MISMATCH');
  expect(h.deleted).toEqual([]);
});

test.each([{ url: 'other-preview.vercel.app' }, { id: 'not-a-deployment' }])('URL-only wrong provider URL or malformed ID prevents deletion: %j', async change => {
  const h = harness();
  h.adapters.cli = command => command === 'npx'
    ? JSON.stringify({ deployments: [{ url: 'owned-preview.vercel.app' }] }) : JSON.stringify([branch]);
  h.adapters.api = async () => ({ ...deployment, ...change });
  await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('DEPLOYMENT_IDENTITY_MISMATCH');
  expect(h.deleted).toEqual([]);
  expect(h.saved.deployments).toEqual([]);
});

test.each(['evil.example', 'owned.vercel.app.evil.example', 'https://user@owned.vercel.app', 'https://owned.vercel.app/path', 'https://owned.vercel.app?token=value', 'https://owned.vercel.app:443', '//owned.vercel.app'])('invalid URL-only listing refuses provider lookup: %s', async url => {
  const h = harness();
  h.adapters.cli = command => command === 'npx'
    ? JSON.stringify({ deployments: [{ url }] }) : JSON.stringify([branch]);
  h.adapters.api = () => { throw Error('UNEXPECTED_LOOKUP'); };
  await expect(run(env, h.adapters, 'cleanup')).rejects.toThrow('DEPLOYMENT_ID_MISSING');
  expect(h.deleted).toEqual([]);
});
