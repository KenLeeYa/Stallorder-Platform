import test from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_SOURCES, verifySharedSources, verifyProductState } from './delivery-preview-source.mjs';
const state = { head: '0d2b27144fcf589bb887e669c09e82158e3de7a2',
  tree: 'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0', status: '' };
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
