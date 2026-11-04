import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '../../../product/node_modules/@playwright/test/index.mjs';
import base from '../../../product/playwright.config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const product = resolve(here, '../../../product');
export default defineConfig({
  ...base,
  testDir: here,
  testMatch: 'delivery-flow.spec.mjs',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  webServer: base.webServer.map(server => ({ ...server, cwd: product })),
});
