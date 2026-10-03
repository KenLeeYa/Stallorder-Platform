import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A coordinator-produced provider readback is required; never infer a child from a URL.
export function assertTarget(receipt, binding, now = Date.now()) {
  const url = new URL(binding.origin);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !/^manual-[1-9]\d*$/.test(receipt.resourceKey)
    || receipt.parent !== 'eyuctbnlvnbnivwasvqr' || receipt.project !== 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP'
    || receipt.team !== 'team_MMfsiG94K9Zy3e6w7Ccc9xY4' || receipt.gitBranch !== 'codex/integrated-production-20261002'
    || !(Date.parse(receipt.expiresAt) > now) || receipt.state === 'CLEANED'
    || binding.resourceKey !== receipt.resourceKey || binding.providerReadback !== 'VERIFIED'
    || !/^[a-f0-9]{40}$/.test(binding.sha ?? '') || !/^[a-f0-9]{40}$/.test(binding.tree ?? '')
    || !receipt.branches?.some(row => row.id === binding.childRef && row.id !== receipt.parent && !row.absent)
    || !receipt.deployments?.some(row => row.id === binding.deploymentId && row.target === 'preview' && !row.absent)
    || binding.productionAlias !== false || binding.dataLess !== true) throw Error('PREVIEW_UI_TARGET_DENIED');
  return url.origin;
}

export async function run(receipt, binding, outDir) {
  const origin = assertTarget(receipt, binding);
  const { chromium, expect } = await import('@playwright/test');
  const browser = await chromium.launch();
  const results = [];
  mkdirSync(outDir, { recursive: true });
  const context = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders:
    process.env.PREVIEW_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.PREVIEW_BYPASS_SECRET } : {} });
  const page = await context.newPage();
  // Prevent navigations to Production or another Preview. Third-party assets may still load.
  await page.route('**/*', route => route.request().isNavigationRequest()
    && new URL(route.request().url()).origin !== origin ? route.abort() : route.continue());
  const org = '11111111-1111-4111-8111-111111111111';
  async function check(name, action) {
    try { await action(); results.push({ name, status: 'PASS' }); }
    catch { results.push({ name, status: 'FAIL' }); }
  }
  try {
    await page.goto(`${origin}/login?next=${encodeURIComponent(`/merchant?organizationId=${org}`)}`);
    await page.locator('input[name="email"]').fill('owner@stallorder.test');
    await page.locator('input[name="password"]').fill('StallOrderDemo!2026');
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await check('catalog-responsive-edit-cancel-return', async () => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/merchant/catalog?organizationId=${org}`);
        await expect(page.getByRole('heading', { name: '共用商品', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }
      const before = page.url();
      await page.getByTestId('open-catalog-navigator').filter({ visible: true }).click();
      const list = page.getByTestId('catalog-navigator-dialog');
      await list.getByPlaceholder('搜尋所有商品').fill('香酥雞排');
      await list.getByTestId('shared-product-actions').first().click();
      await list.getByRole('button', { name: '編輯商品', exact: true }).click();
      const editor = page.getByRole('dialog', { name: '編輯商品', exact: true });
      await expect(editor).toBeVisible();
      await editor.getByRole('button', { name: '取消', exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(list.getByPlaceholder('搜尋所有商品')).toHaveValue('香酥雞排');
      expect(page.url()).toBe(before);
    });
    await check('notification-navigation', async () => {
      await page.goto(`${origin}/merchant?organizationId=${org}`);
      await page.getByRole('link', { name: /通知中心/ }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/notifications\?/);
      await expect(page.getByRole('heading', { name: '通知中心', exact: true })).toBeVisible();
    });
    await check('hosted-line-local-mock-denied', async () => {
      const response = await context.request.get(`${origin}/local-qa/line`);
      expect(response.status()).toBe(404);
    });
    for (const name of ['catalog-save-error-origin', 'inbox-read-back-and-revocation', 'dense-mobile-more-collapse',
      'staff-toolbar-and-pos-checkout', 'public-hours-negative-and-midnight']) results.push({ name, status: 'PENDING', reason: 'BOUND_CHILD_FIXTURE_AND_ACTIONS_REQUIRED' });
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
    await run(JSON.parse(readFileSync(process.argv[2], 'utf8')), JSON.parse(readFileSync(process.argv[3], 'utf8')),
      process.argv[4] ?? '.release-evidence/pr366-preview-ui');
  } catch { console.error('PREVIEW_UI_FAILED'); process.exitCode = 1; }
}
