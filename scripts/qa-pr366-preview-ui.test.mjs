import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test, vi } from 'vitest';
import { assertTarget, assertCatalogFixture, assertReadbackFixture, assertPublicQrFixture, assertInboxFixture, assertMembershipFixture, hoursPhasePolicy, assertPreorderFixture, requestPolicy, routePreviewRequest, createPreviewContext, shutdownPreviewBrowser, sanitizedCaseFailure, readPreviewOpenCashShift } from './qa-pr366-preview-ui.mjs';

test('cash shift readback accepts the API state envelope before opening a shift', () => {
  const response = { state: { openShift: null, history: [], refundablePayments: [] }, permissions: { canManage: true } };
  expect(response.openShift).not.toBe(null); // The old root-level lookup rejected this valid response.
  expect(readPreviewOpenCashShift(response)).toBe(null);
});

test('cash shift readback retains the opened shift for ownership and amount verification', () => {
  const shift = { id: 'owned-shift', status: 'OPEN', openingAmount: 1000 };
  expect(readPreviewOpenCashShift({ state: { openShift: shift } })).toBe(shift);
});

test.each([null, {}, { openShift: null }, { state: {} }, { state: { openShift: undefined } },
  { state: { openShift: [] } }, { state: { openShift: 'OPEN' } }])('cash shift readback rejects a missing or malformed state contract: %j', (response) => {
  expect(() => readPreviewOpenCashShift(response)).toThrow('PREVIEW_CASH_SHIFT_RESPONSE_INVALID');
});

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
  expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 30_000, headers: { 'x-vercel-protection-bypass': 'secret' } });
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


test('bypass header trims surrounding whitespace without exposing invalid values', () => {
  const origin = 'https://isolated.vercel.app';
  expect(requestPolicy(origin, origin, 'GET', false, ' \r\nsynthetic-token\n ')).toEqual({
    abort: false, headers: { 'x-vercel-protection-bypass': 'synthetic-token' },
  });
  for (const value of ['synthetic\r\ninjected', 'synthetic\0token', 'synthetic\u0100token', ' \r\n ']) {
    expect(() => requestPolicy(origin, origin, 'GET', false, value)).toThrow(/^PREVIEW_BYPASS_HEADER_INVALID$/);
  }
  expect(requestPolicy('https://foreign.example', origin, 'GET', true, 'synthetic\r\ninvalid'))
    .toEqual({ abort: true, headers: {} });
});

test('invalid bypass values fail before a browser route sends any header', async () => {
  const origin = 'https://isolated.vercel.app';
  const route = { request: () => ({ url: () => `${origin}/asset`, method: () => 'GET',
    isNavigationRequest: () => false, headers: () => ({}) }), fetch: vi.fn(), fulfill: vi.fn(), abort: vi.fn() };
  await expect(routePreviewRequest(route, origin, 'synthetic\r\ninjected')).rejects.toThrow(/^PREVIEW_BYPASS_HEADER_INVALID$/);
  expect(route.fetch).not.toHaveBeenCalled();
  expect(route.fulfill).not.toHaveBeenCalled();
});

test('direct route failure exposes only a safe code and preserves redirect isolation', async () => {
  const origin = 'https://isolated.vercel.app';
  const route = { request: () => ({ url: () => `${origin}/api/connectivity`, method: () => 'HEAD',
    isNavigationRequest: () => false, headers: () => ({}) }), fetch: vi.fn(async () => { throw Error('secret raw headers'); }), fulfill: vi.fn() };
  await expect(routePreviewRequest(route, origin, 'synthetic')).rejects.toThrow(/^PREVIEW_ROUTE_REQUEST_FAILED$/);
  expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 30_000, headers: { 'x-vercel-protection-bypass': 'synthetic' } });
});


test('only the exact owned-stall EventSource streams get the finite 50-second contract allowance', async () => {
  const origin = 'https://isolated.vercel.app';
  for (const [path, method, accept, timeout] of [
    ['/api/stalls/aming-chicken/orders/stream', 'GET', 'text/event-stream', 60_000],
    ['/api/stalls/aming-chicken/kitchen/stream', 'GET', 'text/event-stream', 60_000],
    ['/api/stalls/other-store/orders/stream', 'GET', 'text/event-stream', 30_000],
    ['/api/stalls/aming-chicken/orders/stream', 'POST', 'text/event-stream', 30_000],
    ['/api/stalls/aming-chicken/orders/stream', 'GET', 'application/json', 30_000],
  ]) {
    const response = {};
    const route = { request: () => ({ url: () => `${origin}${path}`, method: () => method,
      isNavigationRequest: () => false, headers: () => ({ accept }) }), fetch: vi.fn(async () => response), fulfill: vi.fn() };
    await routePreviewRequest(route, origin, 'synthetic');
    expect(route.fetch).toHaveBeenCalledWith({ headers: { accept, 'x-vercel-protection-bypass': 'synthetic' }, maxRedirects: 0, timeout });
  }
});

test.each([
  ['before-close disposal', false, 'route.fetch: Request context disposed.', true],
  ['closing timeout', true, 'route.fetch: Timeout 30000ms exceeded; synthetic header', true],
  ['closing disposal', true, 'route.fetch: Request context disposed.', false],
])('%s is classified without disclosing raw request details', async (_label, closing, message, fail) => {
  const origin = 'https://isolated.vercel.app';
  let handler;
  let finish;
  let routed;
  const pending = new Promise(resolve => { finish = resolve; });
  const order = [];
  const context = { addCookies: vi.fn(), route: vi.fn(async (_pattern, callback) => { handler = callback; }),
    unrouteAll: vi.fn(async options => { expect(options).toEqual({ behavior: 'ignoreErrors' }); order.push('unrouted'); }),
    close: vi.fn(async () => { order.push('context-closed'); finish(); }) };
  const browser = { newContext: vi.fn(async () => context), contexts: () => [context], close: vi.fn(async () => { order.push('browser-closed'); }) };
  await createPreviewContext(browser, origin, 'synthetic');
  expect(browser.newContext).toHaveBeenCalledWith({ serviceWorkers: 'block', locale: 'zh-TW' });
  expect(context.addCookies).toHaveBeenCalledWith([{ name: 'stallorder_locale', value: 'zh-TW', url: origin }]);
  const route = { request: () => ({ url: () => `${origin}/api/connectivity`, method: () => 'HEAD',
    isNavigationRequest: () => false, headers: () => ({}) }), fetch: vi.fn(async () => { await pending; throw Error(message); }), abort: vi.fn() };
  routed = handler(route);
  if (!closing) { finish(); await routed; }
  const shutdown = shutdownPreviewBrowser(browser);
  if (fail) await expect(shutdown).rejects.toThrow(/^PREVIEW_BROWSER_SHUTDOWN_FAILED$/);
  else await expect(shutdown).resolves.toBeUndefined();
  await routed;
  expect(order).toEqual(['unrouted', 'context-closed', 'browser-closed']);
  expect(sanitizedCaseFailure({ name: 'TimeoutError', message }, 'STAFF_PASSWORD_LOGIN'))
    .toEqual({ stage: 'STAFF_PASSWORD_LOGIN', code: 'PREVIEW_UI_TIMEOUT' });
});

test('context setup failure closes the launched browser and never exposes raw errors', async () => {
  const { launchPreviewBrowser } = await import('./qa-pr366-preview-ui.mjs');
  const context = { addCookies: vi.fn(async () => { throw Error('private cookie'); }), close: vi.fn(), unrouteAll: vi.fn() };
  const browser = { newContext: vi.fn(async () => context), contexts: () => [context], close: vi.fn() };
  await expect(launchPreviewBrowser({ launch: async () => browser }, 'https://isolated.vercel.app', 'synthetic'))
    .rejects.toThrow(/^PREVIEW_BROWSER_SETUP_FAILED$/);
  expect(context.close).toHaveBeenCalled(); expect(browser.close).toHaveBeenCalled();
});

test('slow Preview password login waits for a real successful response and rejects denied login', async () => {
  const { chromium } = await import('@playwright/test');
  const { submitPreviewPasswordLogin } = await import('./qa-pr366-preview-ui.mjs');
  let denied = false;
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/login') {
      setTimeout(() => { response.writeHead(denied ? 403 : 200); response.end('{}'); }, denied ? 0 : 6000);
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<button onclick="fetch(\'/api/auth/login\',{method:\'POST\'}).then(r=>{if(r.ok)location.href=\'/staff/aming-chicken/cash\'})">登入</button>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/login`);
    await submitPreviewPasswordLogin(page, `${origin}/staff/aming-chicken/cash`);
    denied = true;
    await page.goto(`${origin}/login`);
    await expect(submitPreviewPasswordLogin(page, `${origin}/staff/aming-chicken/cash`)).rejects.toThrow('PREVIEW_LOGIN_HTTP_403');
    expect(page.url()).toBe(`${origin}/login`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}, 25000);
