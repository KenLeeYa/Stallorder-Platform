import { readFileSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// A coordinator-produced provider readback is required; never infer a child from a URL.
export function assertTarget(receipt, binding, now = Date.now()) {
  const url = new URL(binding.origin);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^manual-[1-9]\d*$/.test(receipt.resourceKey)
    || receipt.parent !== 'eyuctbnlvnbnivwasvqr' || receipt.project !== 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP'
    || receipt.team !== 'team_MMfsiG94K9Zy3e6w7Ccc9xY4' || receipt.gitBranch !== 'codex/integrated-production-20261002'
    || !(Date.parse(receipt.expiresAt) > now) || receipt.status !== 'CAPTURED'
    || binding.resourceKey !== receipt.resourceKey || binding.providerReadback !== 'VERIFIED'
    || !/^[a-f0-9]{40}$/.test(binding.sha ?? '') || !/^[a-f0-9]{40}$/.test(binding.tree ?? '')
    || !receipt.branches?.some(row => row.id === binding.childRef && row.id !== receipt.parent && !row.absent)
    || !receipt.deployments?.some(row => row.id === binding.deploymentId && row.target === 'preview' && !row.absent)
    || binding.productionAlias !== false || binding.dataLess !== true) throw Error('PREVIEW_UI_TARGET_DENIED');
  const proof = binding.readback;
  if (!proof || !(Date.parse(proof.verifiedAt) <= now && Date.parse(proof.verifiedAt) > now - 15 * 60_000)
    || proof.child?.project_ref !== binding.childRef || proof.child?.name !== receipt.resourceKey
    || (proof.child?.parent_project_ref !== undefined && proof.child.parent_project_ref !== receipt.parent)
    || proof.childScope?.provider !== 'supabase-cli' || proof.childScope?.operation !== 'branches list'
    || proof.childScope?.parentProjectRef !== receipt.parent || proof.child?.with_data !== false
    || proof.child?.git_branch !== receipt.gitBranch || proof.deployment?.id !== binding.deploymentId
    || proof.deployment?.projectId !== receipt.project || proof.deployment?.teamId !== receipt.team
    || proof.deployment?.target !== 'preview' || proof.deployment?.origin !== url.origin
    || proof.deployment?.meta?.stallorderPreviewResource !== receipt.resourceKey
    || proof.deployment?.meta?.githubCommitRef !== receipt.gitBranch
    || proof.deployment?.meta?.githubCommitSha !== binding.sha
    || proof.source?.sha !== binding.sha || proof.source?.tree !== binding.tree) throw Error('PREVIEW_UI_READBACK_DENIED');
  return url.origin;
}

export function requestPolicy(requestUrl, origin, method, navigation, bypassSecret) {
  const sameOrigin = new URL(requestUrl).origin === origin;
  void method; void navigation;
  return { abort: !sameOrigin,
    headers: sameOrigin && bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {} };
}

export async function routePreviewRequest(route, origin, bypassSecret) {
  const request = route.request();
  const policy = requestPolicy(request.url(), origin, request.method(), request.isNavigationRequest(), bypassSecret);
  if (policy.abort) return route.abort();
  const headers = { ...request.headers() };
  delete headers['x-vercel-protection-bypass'];
  const response = await route.fetch({ headers: { ...headers, ...policy.headers }, maxRedirects: 0 });
  return route.fulfill({ response });
}

export function assertCatalogFixture(fixture, binding) {
  if (!fixture || fixture.resourceKey !== binding.resourceKey || fixture.childRef !== binding.childRef
    || fixture.deploymentId !== binding.deploymentId || fixture.sha !== binding.sha || fixture.tree !== binding.tree
    || fixture.organizationId !== '11111111-1111-4111-8111-111111111111'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixture.productId ?? '') || fixture.isolatedSeed !== true
    || typeof fixture.originalName !== 'string' || !fixture.originalName || fixture.originalName.length > 60) throw Error('CATALOG_FIXTURE_DENIED');
  return fixture;
}

export function assertReadbackFixture(fixture, binding, kind) {
  if (!fixture || fixture.kind !== kind || fixture.status !== 'READBACK_VERIFIED'
    || fixture.resourceKey !== binding.resourceKey || fixture.childRef !== binding.childRef
    || fixture.deploymentId !== binding.deploymentId || fixture.sha !== binding.sha || fixture.tree !== binding.tree
    || fixture.rows?.length !== 13 || new Set(fixture.rows.map(row => row.id)).size !== 13
    || fixture.rows.some(row => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.id))) throw Error('DENSE_FIXTURE_DENIED');
  return fixture;
}

export function assertInboxFixture(fixture, binding) {
  if (!fixture || fixture.kind !== 'INBOX' || fixture.status !== 'READBACK_VERIFIED'
    || fixture.resourceKey !== binding.resourceKey || fixture.childRef !== binding.childRef
    || fixture.deploymentId !== binding.deploymentId || fixture.sha !== binding.sha || fixture.tree !== binding.tree
    || fixture.organizationId !== '11111111-1111-4111-8111-111111111111' || fixture.source !== 'BILLING'
    || fixture.scope?.kind !== 'ORGANIZATION' || fixture.scope?.organizationId !== fixture.organizationId
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixture.notificationId ?? '')
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixture.profileId ?? '')
    || fixture.title !== `PR366 ${binding.resourceKey} 通知測試`) throw Error('INBOX_FIXTURE_DENIED');
  return fixture;
}

export function assertPublicQrFixture(fixture, binding) {
  if (!fixture || fixture.kind !== 'PUBLIC_QR' || fixture.status !== 'READBACK_VERIFIED'
    || fixture.resourceKey !== binding.resourceKey || fixture.childRef !== binding.childRef
    || fixture.deploymentId !== binding.deploymentId || fixture.sha !== binding.sha || fixture.tree !== binding.tree
    || fixture.organizationId !== '11111111-1111-4111-8111-111111111111'
    || fixture.stallId !== '22222222-2222-4222-8222-222222222222' || fixture.slug !== 'aming-chicken'
    || fixture.deliveryModuleEnabled !== true || fixture.qrs?.length !== 2
    || new Set(fixture.qrs.map(row => row.mode)).size !== 2
    || fixture.qrs.some(row => !['DEFAULT', 'DELIVERY'].includes(row.mode) || typeof row.qrToken !== 'string'
      || row.qrToken.length < 24 || !fixture.rows?.some(publicRow => publicRow.id === row.id && publicRow.mode === row.mode
        && publicRow.tokenFingerprint === createHash('sha256').update(row.qrToken).digest('hex')))) throw Error('PUBLIC_QR_FIXTURE_DENIED');
  return fixture;
}

export async function runHoursPhase(receipt, binding, outDir, phase) {
  const origin = assertTarget(receipt, binding);
  if (!['hours-open', 'hours-closed'].includes(phase)) throw Error('HOURS_PHASE_DENIED');
  const privateDir = process.env.PR366_PRIVATE_FIXTURE_DIR;
  if (!privateDir || realpathSync(privateDir).startsWith(`${realpathSync(process.cwd())}${sep}`)
    || realpathSync(privateDir) === realpathSync(process.cwd())) throw Error('PRIVATE_HANDOFF_DIRECTORY_REQUIRED');
  const qr = assertPublicQrFixture(JSON.parse(readFileSync(resolve(privateDir, 'fixture-public-qr.json'), 'utf8')), binding);
  const hours = binding.fixtures?.hours;
  if (hours?.kind !== 'HOURS' || hours.status !== 'READBACK_VERIFIED' || hours.resourceKey !== receipt.resourceKey
    || hours.childRef !== binding.childRef || hours.deploymentId !== binding.deploymentId || hours.sha !== binding.sha
    || hours.tree !== binding.tree || hours.mode !== (phase === 'hours-open' ? 'OPEN' : 'CLOSED')
    || hours.after?.length !== 7 || hours.after.some(row => row.isClosed !== (phase === 'hours-closed'))) throw Error('HOURS_FIXTURE_DENIED');
  const product = binding.fixtures.pos ? assertCatalogFixture({ ...binding.fixtures.pos, originalName: binding.fixtures.pos.name }, binding)
    : assertCatalogFixture(binding.fixtures.catalogProduct, binding);
  const { chromium, expect } = await import('@playwright/test');
  const handoffPath = resolve(privateDir, `hours-handoff-${receipt.resourceKey}.json`);
  if (phase === 'hours-open' && existsSync(handoffPath)) throw Error('HOURS_HANDOFF_ALREADY_EXISTS');
  const identity = { resourceKey: receipt.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree };
  const state = phase === 'hours-open' ? { ...identity, status: 'PREPARING', modes: [] } : JSON.parse(readFileSync(handoffPath, 'utf8'));
  if (Object.entries(identity).some(([key, value]) => state[key] !== value)
    || (phase === 'hours-closed' && (state.status !== 'OPEN_VERIFIED' || state.modes?.length !== 2))) throw Error('HOURS_HANDOFF_DENIED');
  const browser = await chromium.launch(); const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => routePreviewRequest(route, origin, process.env.PREVIEW_BYPASS_SECRET));
  const evidence = { ...identity, phase, status: 'INCOMPLETE', results: [], orderIds: state.modes.map(mode => mode.orderId), complete: false,
    turnstile: 'OFFICIAL_TEST_KEY_ONLY', pending: ['MIDNIGHT_CUTOFF_FUTURE_PREORDER_DEVICE_UI'] };
  mkdirSync(outDir, { recursive: true });
  function body(mode, token, quantity, orderId) {
    return { qrToken: mode.qrToken, orderSessionToken: token, deviceId: mode.deviceId, idempotencyKey: randomUUID(), clientOrderId: orderId,
      turnstileIdempotencyKey: randomUUID(), turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX', orderingMode: mode.mode,
      customerName: 'PR366 隔離營業時間', customerPhone: '0900000000', deliveryAddress: mode.mode === 'DELIVERY' ? '隔離測試地址，不實際外送' : '',
      customerNote: `PR366 ${receipt.resourceKey} hours`, waitAcknowledged: true, items: [{ productId: product.productId, quantity }] };
  }
  async function call(path, method, data, deviceId) {
    assertTarget(receipt, binding);
    return context.request.fetch(`${origin}${path}`, { method, maxRedirects: 0, ...(data ? { data } : {}), headers: {
      Origin: origin, 'x-stallorder-protocol-version': '1', 'x-stallorder-operation-id': randomUUID(),
      ...requestPolicy(origin, origin, method, false, process.env.PREVIEW_BYPASS_SECRET).headers,
      ...(deviceId ? { 'x-stallorder-device-id': deviceId } : {}) } });
  }
  try {
    for (const item of qr.qrs) {
      const mode = phase === 'hours-open' ? { ...item, deviceId: randomUUID(), orderId: randomUUID() } : state.modes.find(row => row.mode === item.mode);
      const issue = await call('/api/public/order-session', 'POST', { qrToken: item.qrToken, deviceId: phase === 'hours-open' ? mode.deviceId : randomUUID(), sessionRequestId: randomUUID(), orderingMode: item.mode });
      if (phase === 'hours-open') {
        expect(issue.status()).toBe(201);
        mode.orderSessionToken = (await issue.json()).orderSessionToken;
        const reserve = await call('/api/public/order-session', 'POST', { qrToken: item.qrToken, deviceId: mode.deviceId, sessionRequestId: randomUUID(), orderingMode: item.mode });
        expect(reserve.status()).toBe(201); mode.unusedSessionToken = (await reserve.json()).orderSessionToken;
        state.modes.push(mode); writeFileSync(handoffPath, JSON.stringify(state), { mode: 0o600 });
        evidence.orderIds.push(mode.orderId);
        const created = await call('/api/public/orders', 'POST', body(mode, mode.orderSessionToken, 2, mode.orderId));
        expect(created.status()).toBe(201); const accepted = await created.json(); mode.trackingToken = accepted.trackingToken;
        expect(accepted.orderStatus).toBe('WAITING_CONFIRMATION');
        const tracked = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'GET', undefined, mode.deviceId);
        expect(tracked.status()).toBe(200); mode.orderSnapshot = (await tracked.json()).order;
        expect(mode.orderSnapshot.items).toHaveLength(1); expect(mode.orderSnapshot.items[0].quantity).toBe(2);
        writeFileSync(handoffPath, JSON.stringify(state), { mode: 0o600 });
      } else {
        expect(issue.status()).toBe(409); expect((await issue.json()).code).toBe('STALL_CLOSED');
        const before = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'GET', undefined, mode.deviceId);
        expect(before.status()).toBe(200); const snapshot = (await before.json()).order;
        expect(snapshot).toEqual(mode.orderSnapshot);
        const rejectedId = randomUUID(); const submit = await call('/api/public/orders', 'POST', body(mode, mode.unusedSessionToken, 2, rejectedId));
        expect(submit.status()).toBe(409); expect((await submit.json()).code).toBe('STALL_CLOSED');
        const editBody = body(mode, mode.orderSessionToken, 3, mode.orderId);
        const edit = { deviceId: mode.deviceId, idempotencyKey: randomUUID(), turnstileToken: editBody.turnstileToken,
          customerName: editBody.customerName, customerPhone: editBody.customerPhone, deliveryAddress: editBody.deliveryAddress,
          customerNote: editBody.customerNote, items: editBody.items };
        const increase = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'PATCH', edit);
        expect(increase.status()).toBe(409); expect((await increase.json()).code).toBe('STALL_CLOSED');
        const unchanged = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'GET', undefined, mode.deviceId);
        expect(unchanged.status()).toBe(200); expect((await unchanged.json()).order).toEqual(snapshot);
        const decrease = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'PATCH', { ...edit, idempotencyKey: randomUUID(), items: [{ productId: product.productId, quantity: 1 }] });
        expect(decrease.status()).toBe(200);
        const reduced = await call(`/api/public/orders/${encodeURIComponent(mode.trackingToken)}`, 'GET', undefined, mode.deviceId);
        expect(reduced.status()).toBe(200); const finalOrder = (await reduced.json()).order;
        expect(finalOrder.items).toHaveLength(1); expect(finalOrder.items[0].quantity).toBe(1);
        expect(finalOrder.total).toBeLessThan(snapshot.total);
        evidence.results.push({ mode: item.mode, rejectedCreateOrderId: rejectedId, increaseUnchanged: true, decreasedQuantity: 1 });
      }
      if (phase === 'hours-open') evidence.results.push({ mode: item.mode, opened: true, created: true, quantity: 2 });
    }
    state.status = phase === 'hours-open' ? 'OPEN_VERIFIED' : 'CLOSED_VERIFIED'; writeFileSync(handoffPath, JSON.stringify(state), { mode: 0o600 });
    evidence.status = 'PASS';
  } finally {
    writeFileSync(resolve(outDir, `ui-${phase}.json`), JSON.stringify(evidence, null, 2)); await browser.close();
  }
  return evidence;
}

export async function runCashShiftPhase(receipt, binding, outDir) {
  const origin = assertTarget(receipt, binding);
  const { chromium, expect } = await import('@playwright/test');
  const browser = await chromium.launch(); const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => routePreviewRequest(route, origin, process.env.PREVIEW_BYPASS_SECRET));
  mkdirSync(outDir, { recursive: true });
  const evidence = { resourceKey: receipt.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree,
    kind: 'CASH_SHIFT', status: 'INCOMPLETE', cleanup: 'EXACT_CHILD_TEARDOWN' };
  try {
    const page = await context.newPage(); await page.goto(`${origin}/staff/login?next=%2Fstaff%2Faming-chicken%2Fcash`);
    await page.getByRole('button', { name: '使用電子郵件與密碼登入', exact: true }).click();
    await page.locator('input[name="email"]').fill('staff@stallorder.test'); await page.locator('input[name="password"]').fill('StallOrderDemo!2026');
    await page.getByRole('button', { name: '登入', exact: true }).click(); await expect(page).toHaveURL(/\/staff\/aming-chicken\/cash/);
    const headers = requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers;
    const before = await context.request.get(`${origin}/api/stalls/aming-chicken/cash-shifts`, { headers, maxRedirects: 0 });
    expect(before.status()).toBe(200); expect((await before.json()).openShift).toBeNull();
    await page.getByRole('button', { name: '開始現金班次', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '開啟現金班次', exact: true });
    await dialog.getByLabel('開班金額', { exact: true }).fill('1000');
    await dialog.getByLabel('備註（選填）', { exact: true }).fill(`PR366 ${receipt.resourceKey} isolated shift`);
    assertTarget(receipt, binding);
    const accepted = page.waitForResponse(response => response.url() === `${origin}/api/stalls/aming-chicken/cash-shifts` && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: '開始班次', exact: true }).click();
    expect((await accepted).status()).toBe(200);
    const after = await context.request.get(`${origin}/api/stalls/aming-chicken/cash-shifts`, { headers, maxRedirects: 0 });
    expect(after.status()).toBe(200); const shift = (await after.json()).openShift;
    expect(shift).toMatchObject({ status: 'OPEN', openingAmount: 1000 });
    evidence.cashShiftId = shift.id; evidence.status = 'READBACK_VERIFIED';
  } finally { writeFileSync(resolve(outDir, 'ui-cash-shift.json'), JSON.stringify(evidence, null, 2)); await browser.close(); }
  return evidence;
}

export async function run(receipt, binding, outDir) {
  const origin = assertTarget(receipt, binding);
  const { chromium, expect } = await import('@playwright/test');
  const browser = await chromium.launch();
  const results = [];
  mkdirSync(outDir, { recursive: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  // Fetch redirects individually so credentials cannot follow an unreviewed origin.
  await context.route('**/*', route => routePreviewRequest(route, origin, process.env.PREVIEW_BYPASS_SECRET));
  const org = '11111111-1111-4111-8111-111111111111';
  async function check(name, action) {
    try { await action(); results.push({ name, status: 'PASS' }); }
    catch { results.push({ name, status: 'FAIL' }); }
  }
  try {
    await page.goto(`${origin}/login?next=${encodeURIComponent(`/merchant?organizationId=${org}`)}`);
    await page.getByRole('button', { name: '使用電子郵件與密碼登入', exact: true }).click();
    await page.locator('input[name="email"]').fill('owner@stallorder.test');
    await page.locator('input[name="password"]').fill('StallOrderDemo!2026');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    const identity = await context.request.get(`${origin}/api/auth/me`, { maxRedirects: 0, headers:
      requestPolicy(`${origin}/api/auth/me`, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
    expect(identity.status()).toBe(200);
    expect((await identity.json()).user?.email).toBe('owner@stallorder.test');
    await check('isolated-seed-role-logins-and-cross-scope-denials', async () => {
      const cases = [
        ['staff@stallorder.test', '/staff/aming-chicken', /\/staff\/aming-chicken/],
        ['kitchen@stallorder.test', '/kitchen?stall=aming-chicken', /\/kitchen\?stall=aming-chicken/],
        ['platform.admin@stallorder.test', '/admin/billing', /\/admin\/billing/],
      ];
      for (const [email, next, expected] of cases) {
        const roleContext = await browser.newContext({ serviceWorkers: 'block' });
        await roleContext.route('**/*', route => routePreviewRequest(route, origin, process.env.PREVIEW_BYPASS_SECRET));
        try {
          const rolePage = await roleContext.newPage();
          await rolePage.goto(`${origin}/${email.startsWith('platform.') ? 'login' : 'staff/login'}?next=${encodeURIComponent(next)}`);
          await rolePage.getByRole('button', { name: '使用電子郵件與密碼登入', exact: true }).click();
          await rolePage.locator('input[name="email"]').fill(email); await rolePage.locator('input[name="password"]').fill('StallOrderDemo!2026');
          await rolePage.getByRole('button', { name: '登入', exact: true }).click(); await expect(rolePage).toHaveURL(expected);
          const me = await roleContext.request.get(`${origin}/api/auth/me`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
          expect(me.status()).toBe(200); expect((await me.json()).user?.email).toBe(email);
          if (!email.startsWith('platform.')) {
            const denied = await roleContext.request.get(`${origin}/api/merchant/organizations/${org}/catalog/editor`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
            expect([403, 404]).toContain(denied.status());
          }
        } finally { await roleContext.close(); }
      }
      const foreign = await context.request.get(`${origin}/api/merchant/organizations/99999999-9999-4999-8999-999999999999/catalog/editor`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
      expect([403, 404]).toContain(foreign.status());
      const anonymous = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const denied = await anonymous.request.get(`${origin}/api/merchant/organizations/${org}/catalog/editor`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(denied.status()).toBe(401);
      } finally { await anonymous.close(); }
    });
    await check('catalog-responsive-edit-cancel-return-mounted-save-failure', async () => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/merchant/catalog?organizationId=${org}`);
        await expect(page.getByRole('heading', { name: '共用商品', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      await page.getByRole('searchbox', { name: '搜尋商品', exact: true }).fill('香酥雞排');
      await expect(page).toHaveURL(/q=/);
      const before = page.url();
      await page.getByRole('button', { name: '編輯 香酥雞排', exact: true }).filter({ visible: true }).click();
      const editor = page.getByRole('dialog', { name: '編輯商品', exact: true });
      await expect(editor).toBeVisible();
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(page.getByRole('searchbox', { name: '搜尋商品', exact: true })).toHaveValue('香酥雞排');
      expect(page.url()).toBe(before);
      // A mounted transport failure is not provider failure or database rollback evidence.
      await page.getByRole('button', { name: '編輯 香酥雞排', exact: true }).filter({ visible: true }).click();
      await editor.getByLabel('商品名稱', { exact: true }).fill('PR366 transport failure — not persisted');
      const commandUrl = `${origin}/api/merchant/organizations/${org}/catalog`;
      await page.route(commandUrl, route => route.request().method() === 'POST'
        ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '隔離測試：模擬儲存失敗' }) })
        : route.continue());
      try {
        await editor.getByRole('button', { name: '儲存', exact: true }).click();
        await expect(editor.getByRole('alert')).toBeVisible();
        await expect(editor).toBeVisible();
        expect(page.url()).toBe(before);
        await editor.getByRole('button', { name: '取消', exact: true }).click();
      } finally { await page.unroute(commandUrl); }
      await expect(page.getByRole('searchbox', { name: '搜尋商品', exact: true })).toHaveValue('香酥雞排');
    });
    await check('notification-navigation', async () => {
      await page.goto(`${origin}/merchant?organizationId=${org}`);
      await page.getByRole('link', { name: /通知中心/ }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/notifications\?/);
      await expect(page.getByRole('heading', { name: '通知中心', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
    });
    if (binding.fixtures?.inbox) await check('inbox-real-unread-read-persisted-and-owner-scope', async () => {
      const fixture = assertInboxFixture(binding.fixtures.inbox, binding);
      const identityUrl = `${origin}/api/auth/me`;
      const identity = await context.request.get(identityUrl, { maxRedirects: 0, headers: requestPolicy(identityUrl, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
      expect(identity.status()).toBe(200); expect((await identity.json()).user.id).toBe(fixture.profileId);
      const query = `kind=ORGANIZATION&organizationId=${org}`;
      const detailUrl = `${origin}/api/notifications/BILLING/${fixture.notificationId}?${query}`;
      const readUrl = `${origin}/api/notifications/BILLING/${fixture.notificationId}/read?${query}`;
      async function readNotification() {
        const response = await context.request.get(detailUrl, { maxRedirects: 0, headers: requestPolicy(detailUrl, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(response.status()).toBe(200);
        const { item } = await response.json();
        expect(item.id).toBe(fixture.notificationId); expect(item.source).toBe('BILLING'); expect(item.title).toBe(fixture.title);
        return item;
      }
      expect((await readNotification()).readAt).toBeNull();
      await page.goto(`${origin}/notifications?${query}`);
      const list = page.getByRole('region', { name: '通知列表', exact: true });
      const notification = list.getByRole('button').filter({ hasText: fixture.title });
      await expect(notification).toHaveCount(1); await expect(notification).toContainText('未讀');
      await notification.click();
      const detail = page.getByRole('region', { name: '通知詳情', exact: true });
      await expect(detail.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible();
      assertTarget(receipt, binding);
      const marked = page.waitForResponse(response => response.url() === readUrl && response.request().method() === 'PATCH');
      await detail.getByRole('button', { name: '標記為已讀', exact: true }).click();
      const response = await marked; expect(response.status()).toBe(200);
      const { readAt } = await response.json(); expect(Number.isFinite(Date.parse(readAt))).toBe(true);
      expect((await readNotification()).readAt).toBe(readAt);
      await expect(notification).toContainText('已讀');
      await page.reload(); await expect(notification).toContainText('已讀');
      expect((await readNotification()).readAt).toBe(readAt);
      writeFileSync(resolve(outDir, 'inbox-read.json'), JSON.stringify({ resourceKey: binding.resourceKey, childRef: binding.childRef,
        deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, notificationId: fixture.notificationId,
        profileId: fixture.profileId, readAt, status: 'API_READ_PERSISTED', independentDatabaseReadback: 'PENDING' }, null, 2));
    }); else results.push({ name: 'inbox-real-unread-read-persisted-and-owner-scope', status: 'PENDING', reason: 'BOUND_INBOX_FIXTURE_REQUIRED' });
    await check('inbox-mounted-unauthorized-clears-private-state', async () => {
      await page.goto(`${origin}/notifications?kind=ORGANIZATION&organizationId=${org}`);
      await expect(page.getByRole('region', { name: '通知列表', exact: true })).toBeVisible();
      const endpoint = `${origin}/api/notifications?*`;
      await page.route(endpoint, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }));
      try {
        await page.getByRole('button', { name: '套用篩選', exact: true }).click();
        await expect(page.getByText('登入或權限已變更，通知內容已清除。', { exact: true })).toBeVisible();
        await expect(page.getByRole('region', { name: '通知列表', exact: true })).toBeHidden();
        await expect(page.getByRole('region', { name: '通知詳情', exact: true })).toBeHidden();
      } finally { await page.unroute(endpoint); }
    });
    if (binding.fixtures?.catalogProduct) await check('catalog-real-save-readback-return-restore', async () => {
      const fixture = assertCatalogFixture(binding.fixtures.catalogProduct, binding);
      async function readProduct() {
        const response = await context.request.get(`${origin}/api/merchant/organizations/${org}/catalog/editor`, { maxRedirects: 0, headers:
          requestPolicy(`${origin}/api/merchant/organizations/${org}/catalog/editor`, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(response.status()).toBe(200);
        const product = (await response.json()).editor?.initialCatalog?.products?.find(row => row.id === fixture.productId);
        expect(product).toBeTruthy(); return product;
      }
      const snapshot = await readProduct();
      expect(snapshot.name).toBe(fixture.originalName);
      writeFileSync(resolve(outDir, 'catalog-before.json'), JSON.stringify({ productId: snapshot.id, snapshot }, null, 2));
      const changedName = `${snapshot.name} QA${receipt.resourceKey.slice(7)}`;
      let attempted = false;
      async function editName(name) {
        assertTarget(receipt, binding);
        await page.goto(`${origin}/merchant/catalog?organizationId=${org}&q=${encodeURIComponent(snapshot.name)}&pageSize=5`);
        const before = page.url();
        const list = page.getByRole('button', { name: /^編輯 / }).filter({ visible: true });
        // Bind the visible row to the exact API product ID rather than choosing the first search result.
        const response = await context.request.get(`${origin}/api/merchant/organizations/${org}/catalog/products?q=${encodeURIComponent(snapshot.name)}&pageSize=5`, { maxRedirects: 0, headers:
          requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(response.status()).toBe(200);
        const rows = (await response.json()).rows;
        expect(rows).toHaveLength(1); expect(rows[0].id).toBe(snapshot.id);
        await expect(list).toHaveCount(1); await list.click();
        const editor = page.getByRole('dialog', { name: '編輯商品', exact: true });
        await editor.getByLabel('商品名稱', { exact: true }).fill(name);
        assertTarget(receipt, binding);
        const command = page.waitForResponse(response => response.url() === `${origin}/api/merchant/organizations/${org}/catalog` && response.request().method() === 'POST');
        await editor.getByRole('button', { name: '儲存', exact: true }).click();
        expect((await command).status()).toBe(200);
        await expect(editor).toBeHidden(); expect(page.url()).toBe(before);
        await expect(page.getByRole('searchbox', { name: '搜尋商品', exact: true })).toHaveValue(snapshot.name);
      }
      try {
        attempted = true; await editName(changedName);
        expect(await readProduct()).toEqual({ ...snapshot, name: changedName });
      } finally {
        if (attempted) {
          const current = await readProduct();
          // Never overwrite a concurrent edit. Restoration is allowed only for our exact controlled value.
          if (JSON.stringify(current) !== JSON.stringify(snapshot)) {
            expect(current).toEqual({ ...snapshot, name: changedName });
            await editName(snapshot.name);
          }
          expect(await readProduct()).toEqual(snapshot);
          writeFileSync(resolve(outDir, 'catalog-restored.json'), JSON.stringify({ productId: snapshot.id, restored: true }, null, 2));
        }
      }
    });
    else results.push({ name: 'catalog-real-save-readback-return-restore', status: 'PENDING', reason: 'EXACT_ISOLATED_SEED_PRODUCT_RECEIPT_REQUIRED' });
    if (binding.fixtureActions?.prepareDenseExpenses === true) await check('dense-expense-mobile-more-collapse-full-desktop-summary', async () => {
      const { createFixtureClient } = await import('./qa-pr366-preview-fixtures.mjs');
      const csrfToken = (await context.cookies(origin)).find(cookie => cookie.name === 'stallorder_csrf')?.value;
      const request = { fetch: (url, options) => {
        if (new URL(url).origin !== origin) throw Error('FIXTURE_ORIGIN_DENIED');
        return context.request.fetch(url, { ...options, maxRedirects: 0, headers: { ...options.headers,
          ...requestPolicy(url, origin, options.method, false, process.env.PREVIEW_BYPASS_SECRET).headers } });
      } };
      const fixture = await createFixtureClient({ receipt, binding, request, csrfToken,
        save: evidence => writeFileSync(resolve(outDir, 'dense-expense-fixture.json'), JSON.stringify(evidence, null, 2)) }).prepareExpenses(13);
      expect(fixture.status).toBe('READBACK_VERIFIED');
      expect(fixture.totalRows).toBeGreaterThanOrEqual(13);
      expect(fixture.expectedVisibleIds).toHaveLength(fixture.totalRows);
      await page.setViewportSize({ width: 390, height: 900 }); await page.goto(fixture.ui.url);
      const records = page.getByTestId(/^correct-operating-expense-/);
      const controls = page.getByLabel('已入帳支出清單顯示', { exact: true });
      await expect(records).toHaveCount(6);
      await controls.getByRole('button', { name: '顯示更多已入帳支出', exact: true }).click();
      await expect(records).toHaveCount(12);
      for (let count = 12; count < fixture.totalRows; count += 6) {
        await controls.getByRole('button', { name: '顯示更多已入帳支出', exact: true }).click();
        await expect(records).toHaveCount(Math.min(count + 6, fixture.totalRows));
      }
      for (const id of fixture.expectedVisibleIds) await expect(page.getByTestId(`correct-operating-expense-${id}`)).toBeVisible();
      const last = page.getByTestId(`correct-operating-expense-${fixture.expectedVisibleIds.at(-1)}`);
      await last.click(); await expect(page.getByRole('heading', { name: '更正已入帳支出', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await controls.getByRole('button', { name: '收合已入帳支出', exact: true }).click(); await expect(records).toHaveCount(6);
      await page.setViewportSize({ width: 1440, height: 900 }); await expect(records).toHaveCount(fixture.totalRows);
      await expect(controls).toBeHidden();
      const metric = page.getByRole('region', { name: '營運損益摘要', exact: true }).locator('article').filter({ hasText: '其他營業支出' });
      expect(Number.isFinite(fixture.summary?.operatingExpenseAmount)).toBe(true);
      const amount = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(fixture.summary.operatingExpenseAmount);
      await expect(metric).toContainText(amount);
    });
    else results.push({ name: 'dense-expense-mobile-more-collapse-full-desktop-summary', status: 'PENDING', reason: 'DEDICATED_CHILD_EXPENSE_FIXTURE_ACTION_REQUIRED' });
    for (const [key, kind, label] of [['schedule', 'DENSE_SCHEDULE', '行程與現場狀態'], ['workforce', 'DENSE_WORKFORCE', '班表安排'], ['invoices', 'DENSE_MOCK_INVOICE', '電子發票紀錄']]) {
      if (!binding.fixtures?.[key]) { results.push({ name: `dense-${key}-mobile-more-collapse`, status: 'PENDING', reason: 'EXACT_CHILD_READBACK_FIXTURE_REQUIRED' }); continue; }
      await check(`dense-${key}-mobile-more-collapse`, async () => {
        const fixture = assertReadbackFixture(binding.fixtures[key], binding, kind);
        const stall = '22222222-2222-4222-8222-222222222222';
        const month = new Date().toISOString().slice(0, 7);
        const range = `dateFrom=${month}-01&dateTo=${month}-31`;
        // The workforce API requires calendar-valid dates; use the actual final day of this month.
        const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
        const query = range.replace(`${month}-31`, end);
        const api = key === 'schedule' ? `/api/merchant/stalls/${stall}/schedule` : key === 'workforce'
          ? `/api/merchant/organizations/${org}/workforce?${query}` : `/api/merchant/organizations/${org}/e-invoice`;
        const response = await context.request.get(`${origin}${api}`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(response.status()).toBe(200); const data = await response.json();
        const rows = key === 'invoices' ? data.documents : key === 'workforce' ? data.schedules.filter(row => row.status !== 'CANCELLED') : data.schedules;
        expect(rows.length).toBeGreaterThanOrEqual(13);
        for (const row of fixture.rows) expect(rows.some(actual => actual.id === row.id)).toBe(true);
        const path = key === 'schedule' ? `/merchant/stalls/${stall}/schedule?organizationId=${org}` : key === 'workforce'
          ? `/merchant/workforce?organizationId=${org}&${query}` : `/merchant/integrations/e-invoice?organizationId=${org}`;
        await page.setViewportSize({ width: 390, height: 900 }); await page.goto(`${origin}${path}`);
        const section = page.locator('section').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
        const cards = section.locator('article'); const controls = page.getByLabel(`${label}清單顯示`, { exact: true });
        await expect(cards).toHaveCount(6);
        await controls.getByRole('button', { name: `顯示更多${label}`, exact: true }).click(); await expect(cards).toHaveCount(12);
        for (let count = 12; count < rows.length; count += 6) {
          await controls.getByRole('button', { name: `顯示更多${label}`, exact: true }).click(); await expect(cards).toHaveCount(Math.min(count + 6, rows.length));
        }
        await expect(cards.last()).toBeVisible();
        if (key === 'schedule') {
          for (const row of rows.filter(row => fixture.rows.some(owned => owned.id === row.id))) await expect(section.getByText(row.specialNotice, { exact: true })).toBeVisible();
          await expect(cards.last().getByRole('button', { name: '修改行程', exact: true })).toBeEnabled();
        } else if (key === 'workforce') await expect(cards.last().getByRole('button', { name: '取消／調整', exact: true })).toBeEnabled();
        else await expect(cards.last().getByRole('button', { name: '查詢', exact: true })).toBeEnabled();
        await controls.getByRole('button', { name: `收合${label}`, exact: true }).click(); await expect(cards).toHaveCount(6);
        await page.setViewportSize({ width: 1440, height: 900 }); await expect(cards).toHaveCount(rows.length); await expect(controls).toBeHidden();
      });
    }
    if (binding.fixtures?.supply) await check('dense-supply-mobile-pagination-last-record', async () => {
      const fixture = assertReadbackFixture(binding.fixtures.supply, binding, 'DENSE_SUPPLY');
      const response = await context.request.get(`${origin}/api/merchant/organizations/${org}/supply`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
      expect(response.status()).toBe(200); const data = await response.json();
      for (const row of fixture.rows) expect(data.productCosts.some(product => product.productId === row.id)).toBe(true);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 }); await page.goto(`${origin}/merchant/supply?organizationId=${org}`);
        const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '商品配方毛利', exact: true }) });
        await section.getByRole('searchbox', { name: '搜尋毛利商品', exact: true }).fill(`${fixture.marker} recipe`);
        const cards = section.locator('article'); await expect(cards).toHaveCount(6);
        const seen = [];
        for (const expectedCount of [6, 6, 1]) {
          await expect(cards).toHaveCount(expectedCount);
          seen.push(...await cards.locator('p.font-semibold').allTextContents());
          if (seen.length < 13) await section.getByRole('button', { name: '商品配方毛利下一頁', exact: true }).click();
        }
        expect(new Set(seen).size).toBe(13);
        expect(new Set(seen)).toEqual(new Set(data.productCosts.filter(product => fixture.rows.some(row => row.id === product.productId)).map(product => product.productName)));
        await expect(section.getByRole('button', { name: '商品配方毛利下一頁', exact: true })).toBeDisabled();
        await section.getByRole('button', { name: '商品配方毛利上一頁', exact: true }).click(); await expect(cards).toHaveCount(6);
      }
      await page.setViewportSize({ width: 390, height: 900 });
      const recipes = page.locator('section').filter({ has: page.getByRole('heading', { name: '商品配方項目', exact: true }) });
      await recipes.getByRole('searchbox', { name: '搜尋配方商品或食材', exact: true }).fill(`${fixture.marker} recipe`);
      for (let index = 0; index < 2; index++) await recipes.getByRole('button', { name: '商品配方項目下一頁', exact: true }).click();
      const lastId = fixture.recipeIds?.at(-1) ?? fixture.relatedIds?.recipeIds?.at(-1);
      expect(typeof lastId).toBe('string');
      // Exact fixture recipe is reachable on one of the three pages; no destructive action is submitted.
      if (!await recipes.getByTestId(`manage-supply-recipe-${lastId}`).isVisible()) {
        for (let index = 0; index < 2; index++) {
          await recipes.getByRole('button', { name: '商品配方項目上一頁', exact: true }).click();
          if (await recipes.getByTestId(`manage-supply-recipe-${lastId}`).isVisible()) break;
        }
      }
      await recipes.getByTestId(`manage-supply-recipe-${lastId}`).click(); await expect(page.getByTestId('supply-record-dialog')).toBeVisible();
      await page.getByTestId('supply-record-dialog').getByRole('button', { name: '關閉管理視窗', exact: true }).click();
    });
    else results.push({ name: 'dense-supply-mobile-pagination-last-record', status: 'PENDING', reason: 'EXACT_CHILD_SUPPLY_READBACK_REQUIRED' });
    if (binding.fixtures?.pos) await check('staff-toolbar-and-real-cash-pos-checkout', async () => {
      const fixture = binding.fixtures.pos;
      assertCatalogFixture({ ...fixture, originalName: fixture.name }, binding);
      expect(fixture.status).toBe('READBACK_VERIFIED'); expect(fixture.kind).toBe('STAFF_POS');
      expect(Number.isInteger(fixture.price) && fixture.price >= 1 && fixture.price <= 9999).toBe(true);
      const staffContext = await browser.newContext({ serviceWorkers: 'block' });
      await staffContext.route('**/*', route => routePreviewRequest(route, origin, process.env.PREVIEW_BYPASS_SECRET));
      try {
        const staffPage = await staffContext.newPage();
        await staffPage.goto(`${origin}/staff/login?next=%2Fstaff%2Faming-chicken`);
        await staffPage.getByRole('button', { name: '使用電子郵件與密碼登入', exact: true }).click();
        await staffPage.locator('input[name="email"]').fill('staff@stallorder.test'); await staffPage.locator('input[name="password"]').fill('StallOrderDemo!2026');
        await staffPage.getByRole('button', { name: '登入', exact: true }).click(); await expect(staffPage).toHaveURL(/\/staff\/aming-chicken/);
        const response = await staffContext.request.get(`${origin}/api/stalls/aming-chicken/pos-configuration?includeCatalog=true`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(response.status()).toBe(200); const config = await response.json();
        expect(config.modules.print).toBe(false);
        const product = config.catalog.products.find(row => row.id === fixture.productId);
        expect(product?.name).toBe(fixture.name); expect(product?.price).toBe(fixture.price);
        expect(product?.noteGroups).toHaveLength(0); expect(product?.bundleChoiceGroups ?? []).toHaveLength(0);
        const cash = config.paymentOptions.find(option => option.kind === 'CASH');
        if (config.modules.payment) expect(cash).toBeTruthy();
        for (const width of [320, 390, 768, 1440]) {
          await staffPage.setViewportSize({ width, height: 900 });
          const reminder = staffPage.getByTestId('staff-start-reminder-backdrop');
          if (await reminder.isVisible()) await reminder.getByRole('button', { name: '稍後處理', exact: true }).last().click();
          await expect(staffPage.getByRole('button', { name: '店員點餐', exact: true }).filter({ visible: true })).toBeVisible();
          expect(await staffPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
        await staffPage.setViewportSize({ width: 390, height: 900 });
        await staffPage.getByRole('button', { name: '店員點餐', exact: true }).click();
        const pos = staffPage.getByRole('dialog', { name: '店員點餐', exact: true });
        const card = pos.getByTestId('staff-product-card').filter({ hasText: fixture.name });
        await expect(card).toHaveCount(1); await card.getByRole('button', { name: `增加 ${fixture.name}`, exact: true }).click();
        await card.getByRole('button', { name: '加入購物車', exact: true }).click();
        await pos.getByTestId('staff-order-cart-tab').click(); await pos.getByTestId('staff-tablet-confirm-order').click();
        if (config.modules.payment) await pos.getByTestId('staff-checkout-payment-row').getByRole('button', { name: cash.name, exact: true }).click();
        const received = pos.getByTestId('staff-cash-received-field').getByRole('textbox');
        for (const [amount, change] of [[fixture.price - 1, 1], [fixture.price, 0], [fixture.price + 20, 20]]) {
          await received.fill(String(amount)); await expect(pos.getByTestId('cash-change-summary').locator('strong')).toHaveText(`$${change}`);
        }
        await pos.getByTestId('staff-checkout-note-button').click();
        const note = staffPage.getByRole('dialog', { name: '整單備註', exact: true });
        await note.locator('textarea').fill(`PR366 ${receipt.resourceKey} cash POS isolation`);
        await note.getByRole('button', { name: '儲存', exact: true }).click();
        assertTarget(receipt, binding);
        writeFileSync(resolve(outDir, 'pos-orders.json'), JSON.stringify({ resourceKey: receipt.resourceKey, childRef: binding.childRef, status: 'SUBMITTING', productId: fixture.productId, orderIds: [], cleanup: 'EXACT_CHILD_TEARDOWN' }));
        const accepted = staffPage.waitForResponse(response => response.url() === `${origin}/api/stalls/aming-chicken/orders` && response.request().method() === 'POST');
        await pos.getByRole('button', { name: '建立訂單並收款', exact: true }).click();
        const created = await accepted; expect(created.status()).toBe(201); const order = (await created.json()).order;
        expect(order.total).toBe(fixture.price); expect(order.paymentStatus).toBe('PAID');
        expect(created.request().postDataJSON().items).toEqual([{ productId: fixture.productId, quantity: 1, note: '', noteOptionIds: [], bundleChoiceIds: [] }]);
        expect(order.items).toHaveLength(1); expect(order.items[0]).toMatchObject({ name: fixture.name, unitPrice: fixture.price, quantity: 1 });
        const readback = await staffContext.request.get(`${origin}/api/stalls/aming-chicken/orders`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
        expect(readback.status()).toBe(200);
        const persisted = (await readback.json()).orders.find(row => row.id === order.id);
        expect(persisted).toMatchObject({ total: fixture.price, paymentStatus: 'PAID', note: `PR366 ${receipt.resourceKey} cash POS isolation` });
        expect(persisted.items).toHaveLength(1); expect(persisted.items[0]).toMatchObject({ name: fixture.name, unitPrice: fixture.price, quantity: 1 });
        writeFileSync(resolve(outDir, 'pos-orders.json'), JSON.stringify({ resourceKey: receipt.resourceKey, childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree, status: 'READBACK_VERIFIED', productId: fixture.productId, orderIds: [order.id], total: order.total, paymentStatus: order.paymentStatus, cleanup: 'EXACT_CHILD_TEARDOWN' }, null, 2));
        await expect(pos).toBeHidden();
      } finally { await staffContext.close(); }
    });
    else results.push({ name: 'staff-toolbar-and-real-cash-pos-checkout', status: 'PENDING', reason: 'EXACT_CHILD_POS_PRODUCT_AND_PRINT_OFF_READBACK_REQUIRED' });
    await check('inbox-real-session-revocation-clears-private-state', async () => {
      await page.goto(`${origin}/notifications?kind=ORGANIZATION&organizationId=${org}`);
      await expect(page.getByRole('region', { name: '通知列表', exact: true })).toBeVisible();
      const csrfToken = (await context.cookies(origin)).find(cookie => cookie.name === 'stallorder_csrf')?.value;
      expect(csrfToken).toBeTruthy();
      const revoked = await context.request.post(`${origin}/api/auth/logout`, { maxRedirects: 0, data: {}, headers: {
        ...requestPolicy(origin, origin, 'POST', false, process.env.PREVIEW_BYPASS_SECRET).headers,
        Origin: origin, 'x-csrf-token': csrfToken } });
      expect(revoked.status()).toBe(200);
      const me = await context.request.get(`${origin}/api/auth/me`, { maxRedirects: 0, headers: requestPolicy(origin, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
      expect(me.status()).toBe(401);
      // Keep the authorized page mounted; the actual revoked cookie/session must cause the denial.
      await page.getByRole('button', { name: '套用篩選', exact: true }).click();
      await expect(page.getByText('登入或權限已變更，通知內容已清除。', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: '通知列表', exact: true })).toBeHidden();
      await expect(page.getByRole('region', { name: '通知詳情', exact: true })).toBeHidden();
    });
    await check('hosted-line-local-mock-denied', async () => {
      const response = await context.request.get(`${origin}/local-qa/line`, { maxRedirects: 0, headers:
        requestPolicy(`${origin}/local-qa/line`, origin, 'GET', false, process.env.PREVIEW_BYPASS_SECRET).headers });
      expect(response.status()).toBe(404);
    });
    for (const name of ['inbox-membership-revocation',
      'public-hours-negative-and-midnight']) results.push({ name, status: 'PENDING', reason: 'BOUND_CHILD_FIXTURE_AND_ACTIONS_REQUIRED' });
  } finally {
    await browser.close();
    writeFileSync(resolve(outDir, 'ui-results.json'), JSON.stringify({ resourceKey: receipt.resourceKey,
      childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree,
      results, complete: false }, null, 2));
  }
  if (results.some(row => row.status === 'FAIL')) throw Error('PREVIEW_UI_CASE_FAILED');
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const execute = process.argv[5] === 'prepare-cash-shift' ? runCashShiftPhase : process.argv[5] ? runHoursPhase : run;
    await execute(JSON.parse(readFileSync(process.argv[2], 'utf8')), JSON.parse(readFileSync(process.argv[3], 'utf8')),
      process.argv[4] ?? '.release-evidence/pr366-preview-ui', process.argv[5]);
  } catch { console.error('PREVIEW_UI_FAILED'); process.exitCode = 1; }
}
