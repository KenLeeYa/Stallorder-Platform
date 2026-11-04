import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_SOURCES, verifySharedSources, verifyProductState } from './delivery-preview-source.mjs';
const state = { head: 'b9a98a0bff0490c04b2295e4bcfb2b7781774c91',
  tree: 'feaf67bea32aa15ba0e67374b8aa4ff4307dc208', status: '' };
test('binds actual shared fixture and storage dependency bytes', async () => {
  const receipt = await verifySharedSources(async p => Buffer.from(p), async p => Buffer.from(p));
  assert.equal(receipt.paths.length, SHARED_SOURCES.length);
  assert.ok(receipt.paths.every(p => /^[a-f0-9]{64}$/.test(p.sha256)));
  assert.equal(receipt.releaseAuthorized, false);
});
for (const path of ['supabase/fixtures/delivery_mock_preview.sql', 'src/lib/audit.ts', 'prisma/schema.prisma']) {
  test('rejects differing shared source: ' + path, async () => {
    await assert.rejects(verifySharedSources(async p => Buffer.from(p),
      async p => Buffer.from(p === path ? 'changed' : p)), /DELIVERY_SHARED_SOURCE_MISMATCH/);
  });
}
test('rejects missing source without accepting a partial receipt', async () => {
  await assert.rejects(verifySharedSources(async () => { throw Error('missing'); }, async () => Buffer.from('a')));
});
test('accepts only the frozen clean product', () => {
  assert.equal(verifyProductState(state).releaseAuthorized, false);
});
for (const change of [{head:'a'.repeat(40)}, {tree:'b'.repeat(40)}, {status:' M package-lock.json'}, {status:'?? injected.ts'}]) {
  test('rejects product revision or filesystem drift ' + JSON.stringify(change), () => {
    assert.throws(() => verifyProductState({...state,...change}), /DELIVERY_PRODUCT_SOURCE_MISMATCH/);
  });
}
