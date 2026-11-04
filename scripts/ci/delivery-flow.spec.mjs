import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from '../../../product/node_modules/@playwright/test/index.mjs';

test('exact product delivery creation, confirmation, expiry, history, SSE and responsive read-only UI', async () => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath,
      [fileURLToPath(new URL('./delivery-flow.mjs', import.meta.url))], {
        cwd: fileURLToPath(new URL('../../../product/', import.meta.url)),
        env: { ...process.env, APP_ENV: 'test', NODE_ENV: 'test',
          ACCEPTANCE_DATABASE_URL: process.env.DATABASE_URL,
          DELIVERY_ACCEPTANCE_LOCAL_ONLY: '20261029-owned-synthetic' },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 900_000,
      });
    console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (error) {
    console.log(error.stdout ?? '');
    console.error(error.stderr ?? '');
    throw error;
  }
});
