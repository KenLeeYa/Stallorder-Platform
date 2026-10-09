import { expect, test, vi } from 'vitest';
import { setPreviewPublicSecrets } from './set-pr366-preview-public-secrets.mjs';

const timestamp = Date.parse('2026-10-09T00:00:00Z');
function fixture() {
  const childRef = 'abcdefghijklmnopqrst';
  const receipt = { resourceKey: 'manual-123', parent: 'eyuctbnlvnbnivwasvqr', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', gitBranch: 'codex/integrated-production-20261002', expiresAt: new Date(timestamp + 3600000).toISOString(), status: 'CAPTURED', branches: [{ id: childRef }], deployments: [{ id: 'dpl123', target: 'preview' }] };
  const binding = { origin: 'https://dedicated-test.vercel.app', resourceKey: receipt.resourceKey, providerReadback: 'VERIFIED', sha: 'a'.repeat(40), tree: 'b'.repeat(40), childRef, deploymentId: 'dpl123', productionAlias: false, dataLess: true };
  binding.readback = { verifiedAt: new Date(timestamp).toISOString(), child: { project_ref: childRef, name: receipt.resourceKey, parent_project_ref: receipt.parent, with_data: false, git_branch: receipt.gitBranch }, childScope: { provider: 'supabase-cli', operation: 'branches list', parentProjectRef: receipt.parent }, deployment: { id: 'dpl123', projectId: receipt.project, teamId: receipt.team, target: 'preview', origin: binding.origin, meta: { stallorderPreviewResource: receipt.resourceKey, githubCommitRef: receipt.gitBranch, githubCommitSha: binding.sha } }, source: { sha: binding.sha, tree: binding.tree } };
  const snapshots = [];
  return { receipt, binding, childRef, now: () => timestamp, wait: vi.fn(async () => {}), save: row => snapshots.push(structuredClone(row)), snapshots };
}
const metadataFailure = () => Object.assign(Error('private'), { code: 1, stderr: 'Unexpected error setting project secrets: {"message":"Failed to write functions metadata fields"}' });

test('same child and exact idempotent configuration retry once after the observed provider failure', async () => {
  const options = fixture();
  const run = vi.fn().mockRejectedValueOnce(metadataFailure()).mockResolvedValueOnce({});
  const result = await setPreviewPublicSecrets({ ...options, run });
  expect(result.status).toBe('PASS'); expect(run).toHaveBeenCalledTimes(2);
  expect(run.mock.calls[0]).toEqual(run.mock.calls[1]);
  expect(run.mock.calls[0]).toEqual(['supabase', ['secrets', 'set', '--project-ref', options.childRef, `PUBLIC_APP_ORIGINS=${options.binding.origin}`, 'TRUSTED_CLIENT_IP_HEADER=x-real-ip'], { timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 65536 }]);
  expect(options.wait).toHaveBeenCalledWith(2000);
  expect(JSON.stringify(options.snapshots)).not.toContain('private');
});

test.each([{ code: 1, stderr: 'authentication failed private-token' }, { code: 1, killed: true, stderr: 'Failed to write functions metadata fields' }, { code: 'ENOENT' }])('unknown, timeout and authentication errors are not retried', async error => {
  const options = fixture(); const run = vi.fn().mockRejectedValue(error);
  await expect(setPreviewPublicSecrets({ ...options, run })).rejects.toThrow('PREVIEW_SECRET_SET_FAILED');
  expect(run).toHaveBeenCalledOnce(); expect(options.wait).not.toHaveBeenCalled();
  expect(JSON.stringify(options.snapshots)).not.toContain('private-token');
});

test('repeated metadata failure stops after three attempts', async () => {
  const options = fixture(); const run = vi.fn().mockRejectedValue(metadataFailure());
  await expect(setPreviewPublicSecrets({ ...options, run })).rejects.toThrow('PREVIEW_SECRET_SET_FAILED');
  expect(run).toHaveBeenCalledTimes(3); expect(options.wait.mock.calls).toEqual([[2000], [5000]]);
});

test('deadline is checked again before each attempt and preserves ten-minute cleanup headroom', async () => {
  const options = fixture(); let clock = timestamp;
  const run = vi.fn().mockRejectedValue(metadataFailure());
  options.receipt.expiresAt = new Date(clock + 640000).toISOString();
  await expect(setPreviewPublicSecrets({ ...options, run, now: () => clock, wait: async () => { clock += 11000; } })).rejects.toThrow('PREVIEW_SECRET_DEADLINE');
  expect(run).toHaveBeenCalledOnce();
});

test.each(['child', 'source'])('mismatched %s binding refuses all CLI writes', async mismatch => {
  const options = fixture(); const run = vi.fn();
  if (mismatch === 'child') options.childRef = options.receipt.parent;
  else options.binding.readback.source.sha = 'f'.repeat(40);
  await expect(setPreviewPublicSecrets({ ...options, run })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});
