import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '../../../product/node_modules/@playwright/test/index.mjs';
import importedBase from '../../../product/playwright.config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const product = resolve(here, '../../../product');
// Playwright's TS loader can expose the CommonJS default-export wrapper to ESM.
const base = importedBase.default ?? importedBase;
assert.ok(Array.isArray(base.webServer), 'Acceptance requires its own product web servers');
export default defineConfig({
  ...base,
  testDir: here,
  testMatch: 'delivery-flow.spec.mjs',
  timeout: 960_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: base.webServer.map(server => ({ ...server, cwd: product })),
});
