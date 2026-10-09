import { existsSync, readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { merchantDashboardPath, openMerchantDashboard, sanitizedCaseFailure } from './qa-pr366-preview-ui.mjs';

const origin = 'https://isolated.test';
const org = '11111111-1111-4111-8111-111111111111';

function routePage(override) {
  let current;
  let status;
  const page = {
    goto: vi.fn(async target => {
      current = override?.landed ?? target;
      const path = new URL(target).pathname;
      status = override?.status ?? (existsSync(new URL(`../src/app${path}/page.tsx`, import.meta.url)) ? 200 : 404);
      return { ok: () => status >= 200 && status < 300, status: () => status };
    }),
    url: () => current,
    getByTestId: vi.fn(id => ({ id, visible: status === 200 })),
  };
  const assertion = locator => ({ toBeVisible: async () => {
    expect(locator.id).toBe('merchant-function-navigation');
    expect(locator.visible).toBe(true);
  } });
  return { page, assertion };
}

test('actual notification case uses a real merchant route and renders the workspace landmark', async () => {
  const source = readFileSync(new URL('./qa-pr366-preview-ui.mjs', import.meta.url), 'utf8');
  const prefix = source.match(/await check\('notification-navigation', async \(\) => \{\s*([^\n]+)/)[1];
  const { page, assertion } = routePage();
  // Execute the actual case's navigation, rather than checking a copied URL string.
  await new Function('page', 'origin', 'org', 'expect', 'openMerchantDashboard', `return (async () => { ${prefix} })();`)(page, origin, org, assertion, openMerchantDashboard);
  expect(new URL(page.url()).pathname).toBe('/merchant/dashboard');
  expect(page.getByTestId).toHaveBeenCalledWith('merchant-function-navigation');
});

test('bare merchant root is absent: the former case navigated to a 404', async () => {
  const { page } = routePage();
  const response = await page.goto(`${origin}/merchant?organizationId=${org}`);
  expect(response.status()).toBe(404);
  expect(merchantDashboardPath(org)).toBe(`/merchant/dashboard?organizationId=${org}`);
});

test.each([404, 500])('navigation rejects HTTP %s before waiting for a notification link', async status => {
  const { page, assertion } = routePage({ status });
  await expect(openMerchantDashboard(page, origin, org, assertion)).rejects.toThrow(`PREVIEW_MERCHANT_HTTP_${status}`);
  expect(page.getByTestId).not.toHaveBeenCalled();
  expect(sanitizedCaseFailure(Error(`PREVIEW_MERCHANT_HTTP_${status}`), 'notification-navigation').code).toBe(`PREVIEW_MERCHANT_HTTP_${status}`);
});

test('successful HTTP with a login redirect fails before treating the page as a dashboard', async () => {
  const { page, assertion } = routePage({ landed: `${origin}/login`, status: 200 });
  await expect(openMerchantDashboard(page, origin, org, assertion)).rejects.toThrow('PREVIEW_MERCHANT_REDIRECT_FAILED');
  expect(page.getByTestId).not.toHaveBeenCalled();
});
