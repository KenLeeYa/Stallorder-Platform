import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { assertTarget, assertCatalogFixture, assertReadbackFixture, assertPublicQrFixture, assertInboxFixture, assertMembershipFixture, hoursPhasePolicy, assertPreorderFixture, requestPolicy, routePreviewRequest } from './qa-pr366-preview-ui.mjs';

const now = Date.parse('2026-10-03T10:00:00Z');
function fixture() {
  const receipt = { resourceKey: 'manual-123', parent: 'eyuctbnlvnbnivwasvqr', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', gitBranch: 'codex/integrated-production-20261002', expiresAt: new Date(now + 60_000).toISOString(), status: 'CAPTURED', branches: [{ id: 'child123' }], deployments: [{ id: 'dpl123', target: 'preview' }] };
  const binding = { origin: 'https://dedicated-test.vercel.app', resourceKey: receipt.resourceKey, providerReadback: 'VERIFIED', sha: 'a'.repeat(40), tree: 'b'.repeat(40), childRef: 'child123', deploymentId: 'dpl123', productionAlias: false, dataLess: true };
  binding.readback = { verifiedAt: new Date(now).toISOString(), child: { project_ref: binding.childRef, name: receipt.resourceKey, parent_project_ref: receipt.parent, with_data: false, git_branch: receipt.gitBranch }, deployment: { id: binding.deploymentId, projectId: receipt.project, teamId: receipt.team, target: 'preview', origin: binding.origin, meta: { stallorderPreviewResource: receipt.resourceKey, githubCommitRef: receipt.gitBranch, githubCommitSha: binding.sha } }, source: { sha: binding.sha, tree: binding.tree } };
  binding.readback.childScope = { provider: 'supabase-cli', operation: 'branches list', parentProjectRef: receipt.parent };
  return { receipt, binding };
}

test('membership descriptor binds non-primary staff and exact owned notification', () => {
  const { binding } = fixture();
  const row = { ...binding, kind: 'INBOX_MEMBERSHIP', status: 'READBACK_VERIFIED', organizationId: '11111111-1111-4111-8111-111111111111',
    membershipId: '66666666-6666-4666-8666-666666666669', profileId: '55555555-5555-4555-8555-555555555552',
    ownerProfileId: '55555555-5555-4555-8555-555555555551', notificationId: '77777777-7777-4777-8777-777777777777',
    role: 'FINANCE_VIEWER', isPrimaryOwner: false, email: 'staff@stallorder.test', title: 'PR366 manual-123 通知測試' };
  expect(assertMembershipFixture(row, binding)).toBe(row);
  for (const patch of [{ childRef: 'parent' }, { role: 'ORGANIZATION_OWNER' }, { isPrimaryOwner: true },
    { email: 'owner@stallorder.test' }, { profileId: row.ownerProfileId }, { membershipId: '../unsafe' }, { title: 'unowned' }])
    expect(() => assertMembershipFixture({ ...row, ...patch }, binding)).toThrow('MEMBERSHIP_FIXTURE_DENIED');
});
test('requires freshly read back exact child, deployment, owner and source', () => {
  const { receipt, binding } = fixture();
  expect(assertTarget(receipt, binding, now)).toBe(binding.origin);
});
test('uses verified branches-list parent scope when provider row has no parent field', () => {
  const { receipt, binding } = fixture(); delete binding.readback.child.parent_project_ref;
  expect(assertTarget(receipt, binding, now)).toBe(binding.origin);
  delete binding.readback.childScope;
  expect(() => assertTarget(receipt, binding, now)).toThrow('READBACK_DENIED');
});
test.each(['CLEANED', 'RECOVERY_REQUIRED', undefined])('rejects unavailable receipt status %s', status => {
  const { receipt, binding } = fixture(); receipt.status = status;
  expect(() => assertTarget(receipt, binding, now)).toThrow('TARGET_DENIED');
});
test.each([
  proof => { proof.child.with_data = true; },
  proof => { proof.child.parent_project_ref = 'production'; },
  proof => { proof.childScope.parentProjectRef = 'production'; },
  proof => { proof.child.name = 'another-owner'; },
  proof => { proof.deployment.origin = 'https://production.vercel.app'; },
  proof => { proof.deployment.meta.githubCommitSha = 'c'.repeat(40); },
  proof => { proof.source.tree = 'c'.repeat(40); },
  proof => { proof.deployment.teamId = 'another-team'; },
  proof => { proof.verifiedAt = new Date(now - 16 * 60_000).toISOString(); },
])('rejects mismatched provider proof %#', mutate => {
  const { receipt, binding } = fixture(); mutate(binding.readback);
  expect(() => assertTarget(receipt, binding, now)).toThrow('READBACK_DENIED');
});
test('never sends bypass credential to third parties and blocks foreign writes or navigation', () => {
  const origin = 'https://dedicated-test.vercel.app';
  expect(requestPolicy(`${origin}/asset`, origin, 'GET', false, 'secret')).toEqual({ abort: false, headers: { 'x-vercel-protection-bypass': 'secret' } });
  expect(requestPolicy('https://cdn.example/a', origin, 'GET', false, 'secret')).toEqual({ abort: true, headers: {} });
  expect(requestPolicy('https://cdn.example/a', origin, 'POST', false, 'secret').abort).toBe(true);
  expect(requestPolicy('https://other.vercel.app/', origin, 'GET', true, 'secret').abort).toBe(true);
});
test('browser fetch never automatically follows a credentialed redirect and foreign requests abort', async () => {
  const origin = 'https://dedicated-test.vercel.app';
  const response = { status: () => 302 };
  const route = { request: () => ({ url: () => `${origin}/redirect`, method: () => 'GET', isNavigationRequest: () => true, headers: () => ({ 'x-vercel-protection-bypass': 'stale' }) }), fetch: vi.fn(async () => response), fulfill: vi.fn(), abort: vi.fn() };
  await routePreviewRequest(route, origin, 'secret');
  expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, headers: { 'x-vercel-protection-bypass': 'secret' } });
  expect(route.fulfill).toHaveBeenCalledWith({ response });
  route.request = () => ({ url: () => 'https://foreign.example/', method: () => 'GET', isNavigationRequest: () => true });
  await routePreviewRequest(route, origin, 'secret');
  expect(route.abort).toHaveBeenCalledOnce(); expect(route.fetch).toHaveBeenCalledTimes(1);
});
test('catalog writes require exact isolated seed product and release binding', () => {
  const { binding } = fixture();
  const product = { resourceKey: binding.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, organizationId: '11111111-1111-4111-8111-111111111111', productId: '22222222-2222-4222-8222-222222222222', originalName: '香酥雞排', isolatedSeed: true };
  expect(assertCatalogFixture(product, binding)).toBe(product);
  for (const patch of [{ childRef: 'production' }, { isolatedSeed: false }, { tree: 'c'.repeat(40) }, { organizationId: 'foreign' }, { productId: '../escape' }]) expect(() => assertCatalogFixture({ ...product, ...patch }, binding)).toThrow('FIXTURE_DENIED');
});
test('dense consumers reject stale, foreign, duplicated or unsupported fixture evidence', () => {
  const { binding } = fixture();
  const dense = { resourceKey: binding.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, kind: 'DENSE_SCHEDULE', status: 'READBACK_VERIFIED', rows: Array.from({ length: 13 }, (_, index) => ({ id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}` })) };
  expect(assertReadbackFixture(dense, binding, 'DENSE_SCHEDULE')).toBe(dense);
  for (const patch of [{ status: 'PLANNED' }, { childRef: 'production' }, { kind: 'HOURS' }, { rows: [dense.rows[0]] }, { rows: dense.rows.map(() => dense.rows[0]) }]) expect(() => assertReadbackFixture({ ...dense, ...patch }, binding, 'DENSE_SCHEDULE')).toThrow('DENSE_FIXTURE_DENIED');
});


test('public QR handoff requires two exact child modes and verified token fingerprints', () => {
  const { binding } = fixture();
  const qrs = ['DEFAULT', 'DELIVERY'].map((mode, index) => ({ id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`, mode, qrToken: `private-test-token-${mode}-123456789` }));
  const qr = { resourceKey: binding.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, kind: 'PUBLIC_QR', status: 'READBACK_VERIFIED', organizationId: '11111111-1111-4111-8111-111111111111', stallId: '22222222-2222-4222-8222-222222222222', slug: 'aming-chicken', deliveryModuleEnabled: true, qrs, rows: qrs.map(row => ({ id: row.id, mode: row.mode, tokenFingerprint: createHash('sha256').update(row.qrToken).digest('hex') })) };
  expect(assertPublicQrFixture(qr, binding)).toBe(qr);
  for (const patch of [{ childRef: 'production' }, { status: 'PLANNED' }, { deliveryModuleEnabled: false }, { qrs: [qrs[0], qrs[0]] }, { rows: qr.rows.map(row => ({ ...row, tokenFingerprint: '0'.repeat(64) })) }, { qrs: qrs.map(row => ({ ...row, qrToken: 'changed-private-token-123456789' })) }]) expect(() => assertPublicQrFixture({ ...qr, ...patch }, binding)).toThrow('PUBLIC_QR_FIXTURE_DENIED');
});


test('inbox read requires exact owner-scoped isolated notification receipt', () => {
  const { binding } = fixture();
  const inbox = { ...binding, kind: 'INBOX', status: 'READBACK_VERIFIED', organizationId: '11111111-1111-4111-8111-111111111111', source: 'BILLING', scope: { kind: 'ORGANIZATION', organizationId: '11111111-1111-4111-8111-111111111111' }, notificationId: '22222222-2222-4222-8222-222222222222', profileId: '33333333-3333-4333-8333-333333333333', title: `PR366 ${binding.resourceKey} 通知測試` };
  expect(assertInboxFixture(inbox, binding)).toBe(inbox);
  for (const patch of [{ childRef: 'production' }, { source: 'APPLICATION' }, { status: 'PLANNED' }, { title: 'real customer notice' }, { scope: { kind: 'PERSONAL' } }, { notificationId: '../escape' }, { profileId: 'foreign' }]) expect(() => assertInboxFixture({ ...inbox, ...patch }, binding)).toThrow('INBOX_FIXTURE_DENIED');
});


test('overnight success and cutoff rejection retain distinct actual database error contracts', () => {
  expect(hoursPhasePolicy('hours-overnight')).toEqual({ opening: true, expectedMode: 'OVERNIGHT', deniedCode: 'STALL_CLOSED' });
  expect(hoursPhasePolicy('hours-cutoff')).toEqual({ opening: false, expectedMode: 'CUTOFF', deniedCode: 'QR_LAST_ORDER_PASSED' });
  expect(hoursPhasePolicy('hours-closed').deniedCode).toBe('STALL_CLOSED');
  expect(() => hoursPhasePolicy('hours-fake-clock')).toThrow('HOURS_PHASE_DENIED');
});


test('future preorder accepts only actual canonical future slot and closed-current-hours receipt', () => {
  const { binding } = fixture();
  const future = { ...binding, kind: 'FUTURE_PREORDER', status: 'READBACK_VERIFIED', organizationId: '11111111-1111-4111-8111-111111111111', stallId: '22222222-2222-4222-8222-222222222222', currentHoursClosed: true, tomorrow: '2026-10-04', scheduledPickupAt: '2026-10-04T09:00:00.000Z', canonicalSlots: ['2026-10-04T17:00:00+08:00'], after: { settings: { takeoutPreorderEnabled: true }, hours: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: dayOfWeek !== 0 })) } };
  expect(assertPreorderFixture(future, binding, now)).toBe(future);
  for (const patch of [{ childRef: 'production' }, { currentHoursClosed: false }, { canonicalSlots: [] }, { scheduledPickupAt: '2026-10-03T09:00:00Z' }, { tomorrow: '2026-10-05' }, { after: { settings: { takeoutPreorderEnabled: false }, hours: future.after.hours } }]) expect(() => assertPreorderFixture({ ...future, ...patch }, binding, now)).toThrow('PREORDER_FIXTURE_DENIED');
});
