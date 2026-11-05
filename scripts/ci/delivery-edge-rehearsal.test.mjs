import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {rehearseIsolatedEdgeRecovery} from './delivery-edge-rehearsal.mjs';
function record(slug, label, index) {
  const bytes = Buffer.from('EZBRsynthetic-' + label + '-' + slug), sha256 = createHash('sha256').update(bytes).digest('hex');
  return {slug, wireBase64: bytes.toString('base64'), wireSha256: sha256, metadata: {
    id: '12345678-1234-1234-1234-' + String(index + 1).padStart(12, '0'), slug, name: slug,
    version: 10, status: 'ACTIVE', verify_jwt: false, sha256,
    entrypoint_path: 'file:///source/' + slug + '/index.ts', import_map_path: 'file:///source/deno.json', import_map: true,
    unknown_config: {retained: true},
  }};
}
function fixture() {
  const original = new Map(EDGE_SLUGS.map((s, i) => [s, record(s, 'current', i)]));
  const state = structuredClone(original), calls = [];
  const archive = {project: 'eyuctbnlvnbnivwasvqr', schema: 'stallorder-delivery-edge-recovery/v1',
    releaseAuthorized: false, restoreVerified: false, functions: EDGE_SLUGS.map((s, i) => record(s, 'archive', i + 10))};
  const read = async ({project, slug}) => {assert.equal(project, 'teunnvfakbfzmodajqjz'); calls.push({read: slug}); return structuredClone(state.get(slug));};
  const apply = async ({project, record: r}) => {
    assert.equal(project, 'teunnvfakbfzmodajqjz'); calls.push({apply: r.slug, sha256: r.wireSha256});
    const before = state.get(r.slug), next = structuredClone(r);
    next.metadata = {...before.metadata, sha256: r.wireSha256, version: before.metadata.version + 1,
      entrypoint_path: r.metadata.entrypoint_path, import_map_path: r.metadata.import_map_path, import_map: r.metadata.import_map};
    state.set(r.slug, next);
  };
  const verifyUsage = async () => {
    calls.push({usage: true});
    for (const r of archive.functions) assert.equal(state.get(r.slug).wireSha256, r.wireSha256);
  };
  return {archive, read, apply, verifyUsage, original, state, calls};
}
function restored(x, except) {
  for (const [slug, before] of x.original) if (slug !== except) {
    const actual = x.state.get(slug); assert.equal(actual.wireBase64, before.wireBase64);
    assert.deepEqual({...actual.metadata, version: before.metadata.version}, before.metadata);
  }
}
test('captures all five before writing, verifies real usage, then restores exact owned bytes in reverse', async () => {
  const x = fixture(), out = await rehearseIsolatedEdgeRecovery(x);
  assert.deepEqual(x.calls.slice(0, 5), EDGE_SLUGS.map(read => ({read})));
  assert.deepEqual(out.replayed, EDGE_SLUGS); assert.deepEqual(out.restored, EDGE_SLUGS.toReversed());
  assert.equal(out.usageVerified, true); assert.equal(out.cleanupVerified, true);
  assert.equal(out.releaseAuthorized, false); assert.equal(out.productionRecoveryVerified, false); restored(x);
});
test('reconciles an ambiguous write failure without retrying that write and restores all attempted functions', async () => {
  const x = fixture(); let writes = 0;
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, apply: async a => {await x.apply(a); if (++writes === 3) throw new Error('ambiguous private transport error');}}), e => {
    assert.equal(e.message, 'EDGE_REHEARSAL_FAILED'); assert.equal(e.receipt.cleanupVerified, true);
    assert.equal(e.receipt.usageVerified, false); assert.equal(e.receipt.restored.length, 3); return true;
  });
  assert.equal(writes, 6); restored(x);
});
test('restores all owned changes after affected-flow failure', async () => {
  const x = fixture();
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, verifyUsage: async () => {throw new Error('private fixture');}}), e => e.message === 'EDGE_REHEARSAL_FAILED' && e.receipt.cleanupVerified && !JSON.stringify(e).includes('private fixture'));
  restored(x);
});
test('retains foreign changed state and reports incomplete cleanup while restoring other owned functions', async () => {
  const x = fixture(), slug = EDGE_SLUGS[1], foreign = record(slug, 'foreign', 1);
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, verifyUsage: async () => {x.state.set(slug, foreign);}}), e => e.message === 'EDGE_REHEARSAL_CLEANUP_REQUIRED' && !e.receipt.cleanupVerified);
  assert.deepEqual(x.state.get(slug), foreign); restored(x, slug);
});
test('rejects preimage drift before its write and only rolls back earlier owned writes', async () => {
  const x = fixture(), slug = EDGE_SLUGS[1]; let reads = 0;
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, read: async a => {
    if (a.slug === slug && ++reads === 2) x.state.get(slug).metadata.version++;
    return x.read(a);
  }}), e => e.message === 'EDGE_REHEARSAL_FAILED' && e.receipt.restored.length === 1);
  assert.equal(x.calls.filter(c => c.apply).length, 2); restored(x);
});
test('restores known owned configuration changes even when bundle bytes are identical', async () => {
  const x = fixture(); x.archive.functions = [...x.original.values()].map(r => {
    const next = structuredClone(r); next.metadata.import_map_path = 'file:///source/previous-deno.json'; return next;
  });
  const out = await rehearseIsolatedEdgeRecovery(x); assert.equal(out.cleanupVerified, true); restored(x);
});
test('preserves a later third-party deployment even when replay bytes and configuration match', async () => {
  const x = fixture(), slug = EDGE_SLUGS[1];
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, verifyUsage: async () => {
    x.state.get(slug).metadata.version = 100; x.state.get(slug).metadata.updated_at = 123;
  }}), e => e.message === 'EDGE_REHEARSAL_CLEANUP_REQUIRED' && !e.receipt.cleanupVerified);
  assert.equal(x.state.get(slug).metadata.version, 100);
  assert.equal(x.calls.filter(c => c.apply === slug).length, 1); restored(x, slug);
});
test('does not overwrite an ambiguous failure with more than one version transition', async () => {
  const x = fixture(), slug = EDGE_SLUGS[0];
  await assert.rejects(rehearseIsolatedEdgeRecovery({...x, apply: async a => {
    await x.apply(a); x.state.get(slug).metadata.version += 2; throw new Error('ambiguous');
  }}), e => e.message === 'EDGE_REHEARSAL_CLEANUP_REQUIRED');
  assert.equal(x.calls.filter(c => c.apply).length, 1);
});
for (const [name, change] of [
  ['foreign archive project', x => x.archive.project = 'foreign'],
  ['wrong schema', x => x.archive.schema = 'other'],
  ['missing function', x => x.archive.functions.pop()],
  ['duplicate function', x => x.archive.functions[1] = x.archive.functions[0]],
  ['unbound archive bytes', x => x.archive.functions[0].wireBase64 = Buffer.from('changed').toString('base64')],
  ['missing usage verifier', x => x.verifyUsage = null],
]) test('rejects invalid source before network: ' + name, async () => {
  const x = fixture(); change(x); await assert.rejects(rehearseIsolatedEdgeRecovery(x), /EDGE_REHEARSAL_FAILED/);
  assert.equal(x.calls.length, 0);
});
