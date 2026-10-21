import { expect, test, vi } from 'vitest';
import { createFixtureClient } from './qa-pr366-preview-fixtures.mjs';
const now = Date.parse('2026-10-03T10:00:00Z');
function fixture() {
  const receipt = { resourceKey: 'manual-123', parent: 'eyuctbnlvnbnivwasvqr', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', gitBranch: 'codex/integrated-production-20261002', expiresAt: new Date(now + 60_000).toISOString(), status: 'CAPTURED', branches: [{ id: 'child123' }], deployments: [{ id: 'dpl123', target: 'preview' }] };
  const binding = { origin: 'https://dedicated-test.vercel.app', resourceKey: receipt.resourceKey, providerReadback: 'VERIFIED', sha: 'a'.repeat(40), tree: 'b'.repeat(40), childRef: 'child123', deploymentId: 'dpl123', productionAlias: false, dataLess: true };
  binding.readback = { verifiedAt: new Date(now).toISOString(), childScope: { provider: 'supabase-cli', operation: 'branches list', parentProjectRef: receipt.parent }, child: { project_ref: binding.childRef, name: receipt.resourceKey, parent_project_ref: receipt.parent, with_data: false, git_branch: receipt.gitBranch }, deployment: { id: binding.deploymentId, projectId: receipt.project, teamId: receipt.team, target: 'preview', origin: binding.origin, meta: { stallorderPreviewResource: receipt.resourceKey, githubCommitRef: receipt.gitBranch, githubCommitSha: binding.sha } }, source: { sha: binding.sha, tree: binding.tree } };
  return { receipt, binding };
}

function session(email = 'owner@stallorder.test') {
  const rows = []; const receipts = [];
  const request = { fetch: vi.fn(async (url, options) => {
    if (url.endsWith('/api/auth/me')) return { status: () => 200, json: async () => ({ user: { email } }) };
    if (options.method === 'POST') rows.push({ ...options.data, id: `expense-${rows.length}` });
    return { status: () => options.method === 'POST' ? 201 : 200, json: async () => ({ expenses: rows }) };
  }) };
  return { request, receipts, options: { ...fixture(), request, csrfToken: 'test-only', now: () => now,
    save: async value => receipts.push(structuredClone(value)) } };
}

test('creates bounded API expenses with per-write receipts and authoritative readback', async () => {
  const { request, receipts, options } = session();
  const evidence = await createFixtureClient(options).prepareExpenses();
  expect(evidence.createdIds).toHaveLength(13);
  expect(evidence.expectedFixtureTotal).toBe(1300);
  expect(evidence.cleanup).toBe('RETAIN_AUDITED_ROWS_UNTIL_EXACT_CHILD_TEARDOWN');
  expect(receipts[0].createdIds).toEqual([]);
  expect(receipts.at(-1).status).toBe('READBACK_VERIFIED');
  for (const [url, config] of request.fetch.mock.calls) {
    expect(new URL(url).origin).toBe(options.binding.origin);
    expect(config.maxRedirects).toBe(0);
    if (config.method === 'POST') expect(config.headers['x-csrf-token']).toBe('test-only');
  }
});

test('rejects wrong actor before fixture writes', async () => {
  const { request, options } = session('production-owner@example.test');
  await expect(createFixtureClient(options).prepareExpenses()).rejects.toThrow('FIXTURE_ACTOR_DENIED');
  expect(request.fetch).toHaveBeenCalledTimes(1);
});

test('rejects oversized fixture and expired child without network', async () => {
  const { request, options } = session();
  await expect(createFixtureClient(options).prepareExpenses(14)).rejects.toThrow('FIXTURE_BOUND_EXCEEDED');
  options.receipt.expiresAt = new Date(now - 1).toISOString();
  expect(() => createFixtureClient(options)).toThrow('TARGET_DENIED');
  expect(request.fetch).not.toHaveBeenCalled();
});

test('receipt failure stops before any POST', async () => {
  const { request, options } = session(); options.save = async () => { throw Error('DISK_UNAVAILABLE'); };
  await expect(createFixtureClient(options).prepareExpenses()).rejects.toThrow('DISK_UNAVAILABLE');
  expect(request.fetch.mock.calls.some(([, config]) => config.method === 'POST')).toBe(false);
});
