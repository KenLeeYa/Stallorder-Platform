import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_SOURCES = Object.freeze([
  'supabase/seed.sql', 'supabase/fixtures/delivery_mock_preview.sql',
  'supabase/fixtures/delivery_mock_preview_cleanup.sql', 'supabase/fixtures/line_live_preview.sql',
  'prisma/schema.prisma', 'tsconfig.json', 'src/server/resilience/storage-replication-service.ts',
  'src/lib/audit.ts', 'src/lib/prisma.ts',
]);
export async function verifySharedSources(readControl, readProduct) {
  const paths = [];
  for (const path of SHARED_SOURCES) {
    const [control, product] = await Promise.all([readControl(path), readProduct(path)]);
    assert.ok(Buffer.isBuffer(control) && Buffer.isBuffer(product) && control.equals(product),
      'DELIVERY_SHARED_SOURCE_MISMATCH');
    paths.push({ path, sha256: createHash('sha256').update(product).digest('hex') });
  }
  return { paths, sourceVerified: true, releaseAuthorized: false };
}
export function verifyProductState(state) {
  assert.ok(state.head === 'b043052d564f102945aef72bb866a08d831e335f'
    && state.tree === 'bab38fe323aa9888737f1476c955a23eff1e57f9'
    && state.status === '', 'DELIVERY_PRODUCT_SOURCE_MISMATCH');
  return { ...state, sourceVerified: true, releaseAuthorized: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const control = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const product = resolve(control, '../product');
    const git = args => execFileSync('git', args, { cwd: product, encoding: 'utf8',
      maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const state = verifyProductState({ head: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']), status: git(['status', '--porcelain', '--untracked-files=normal']) });
    if (process.argv[2] === 'shared') {
      console.log(JSON.stringify({ product: state,
        shared: await verifySharedSources(p => readFileSync(resolve(control, p)), p => readFileSync(resolve(product, p))) }));
    } else {
      assert.equal(process.argv[2], 'product');
      console.log(JSON.stringify(state));
    }
  } catch {
    console.error('DELIVERY_PREVIEW_SOURCE_REJECTED');
    process.exitCode = 1;
  }
}
