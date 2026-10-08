import { expect, test, vi } from 'vitest';
import { createPreviewContext, shutdownPreviewBrowser } from './qa-pr366-preview-ui.mjs';

test.each(['unroute', 'context', 'browser', 'routes'])('a stalled %s cleanup terminates with failure and attempts remaining cleanup', async stalled => {
  vi.useFakeTimers();
  try {
    const steps = []; let handler;
    const never = () => new Promise(() => {});
    const context = { setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(), addCookies: vi.fn(),
      route: vi.fn(async (_pattern, callback) => { handler = callback; }),
      unrouteAll: vi.fn(stalled === 'unroute' ? never : async () => {}),
      close: vi.fn(stalled === 'context' ? never : async () => {}) };
    const browser = { newContext: async () => context, contexts: () => [context], close: vi.fn(stalled === 'browser' ? never : async () => {}) };
    await createPreviewContext(browser, 'https://isolated.test', undefined);
    if (stalled === 'routes') void handler({ request: () => ({ url: () => 'https://isolated.test/api/test', method: () => 'GET', isNavigationRequest: () => false, headers: () => ({}) }), fetch: never, abort: vi.fn() });
    const pending = shutdownPreviewBrowser(browser, { timeoutMs: 10, save: row => steps.push(row) });
    const failure = expect(pending).rejects.toThrow('PREVIEW_BROWSER_SHUTDOWN_FAILED');
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(steps.some(row => row.state === 'FAIL')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('successful cleanup reports individual passed stages and exposes no context data', async () => {
  const steps = [];
  const context = { unrouteAll: async () => {}, close: async () => {} };
  await shutdownPreviewBrowser({ contexts: () => [context], close: async () => {} }, { save: row => steps.push(row) });
  expect(steps.filter(row => row.state === 'PASS').map(row => row.stage)).toEqual(['context-unroute', 'context-close', 'browser-close']);
  expect(steps.every(row => Object.keys(row).every(key => ['stage', 'state'].includes(key)))).toBe(true);
});
