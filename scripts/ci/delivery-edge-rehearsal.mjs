import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';

const project = 'teunnvfakbfzmodajqjz';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mutableProviderFields = new Set(['version', 'updated_at', 'sha256', 'ezbr_sha256', 'entrypoint_path', 'import_map_path', 'import_map']);
function validate(record, slug) {
  assert.equal(record.slug, slug); assert.equal(record.metadata.slug, slug);
  assert.equal(record.metadata.status, 'ACTIVE'); assert.equal(record.metadata.verify_jwt, false);
  assert.match(record.metadata.id ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.ok(Number.isSafeInteger(record.metadata.version) && record.metadata.version > 0);
  assert.match(record.wireSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(typeof record.wireBase64, 'string'); assert.ok(record.wireBase64.length <= 16 * 1024 * 1024 * 4 / 3 + 4);
  const bytes = Buffer.from(record.wireBase64, 'base64');
  assert.equal(bytes.toString('base64'), record.wireBase64);
  assert.ok(bytes.length > 4 && bytes.length <= 16 * 1024 * 1024 && bytes.subarray(0, 4).equals(Buffer.from('EZBR')));
  assert.equal(hash(bytes), record.wireSha256); assert.equal(record.metadata.sha256, record.wireSha256);
  if (record.metadata.ezbr_sha256 !== undefined) assert.equal(record.metadata.ezbr_sha256, record.wireSha256);
  for (const key of ['entrypoint_path', 'import_map_path']) assert.ok(typeof record.metadata[key] === 'string' && record.metadata[key].length > 0 && record.metadata[key].length < 4096 && !/[\x00-\x1f\x7f]/.test(record.metadata[key]));
  if (record.metadata.import_map !== undefined) assert.equal(typeof record.metadata.import_map, 'boolean');
}
function compatible(actual, expectedBytes, targetIdentity) {
  validate(actual, expectedBytes.slug);
  assert.equal(actual.wireBase64, expectedBytes.wireBase64);
  assert.ok(actual.metadata.version >= targetIdentity.metadata.version);
  const keys = new Set([...Object.keys(actual.metadata), ...Object.keys(targetIdentity.metadata)]);
  for (const key of keys) if (!mutableProviderFields.has(key)) assert.deepEqual(actual.metadata[key], targetIdentity.metadata[key]);
  for (const key of ['entrypoint_path', 'import_map_path', 'import_map']) assert.deepEqual(actual.metadata[key], expectedBytes.metadata[key]);
}
// Trusted protected workflow must supply source-authenticated archive, the one
// shared Preview writer lock, fixed-project adapter and actual usage verifier.
// Callbacks exist for offline failure injection; this module has no CLI.
export async function rehearseIsolatedEdgeRecovery({archive, read, apply, verifyUsage}) {
  const saved = new Map(), owned = new Map(), attempted = [], restored = [], replayed = [];
  let failed = false, cleanupFailed = false, usageVerified = false;
  try {
    archive = structuredClone(archive);
    assert.equal(archive.project, 'eyuctbnlvnbnivwasvqr');
    assert.equal(archive.schema, 'stallorder-delivery-edge-recovery/v1');
    assert.equal(archive.releaseAuthorized, false); assert.equal(archive.restoreVerified, false);
    assert.equal(archive.functions.length, 5);
    assert.equal(typeof verifyUsage, 'function');
    for (const slug of EDGE_SLUGS) {
      const items = archive.functions.filter(f => f.slug === slug); assert.equal(items.length, 1); validate(items[0], slug);
    }
    // Save all five preimages before the first mutation. Each adapter read must
    // bind metadata/body/metadata; neither metadata alone nor HTTP 200 suffices.
    for (const slug of EDGE_SLUGS) {
      const record = await read({project, slug}); validate(record, slug); saved.set(slug, structuredClone(record));
    }
    for (const slug of EDGE_SLUGS) {
      const before = saved.get(slug), source = archive.functions.find(f => f.slug === slug);
      assert.ok(isDeepStrictEqual(await read({project, slug}), before), 'PREIMAGE_CHANGED');
      attempted.push(slug); // A timeout may have committed remotely: reconcile it.
      await apply({project, record: source});
      const after = await read({project, slug}); compatible(after, source, before);
      assert.equal(after.metadata.version, before.metadata.version + 1);
      owned.set(slug, structuredClone(after)); replayed.push(slug);
    }
    await verifyUsage(); usageVerified = true;
  } catch {failed = true;}
  finally {
    for (const slug of attempted.toReversed()) {
      const before = saved.get(slug), source = archive.functions.find(f => f.slug === slug);
      try {
        const current = await read({project, slug});
        let alreadyRestored = false;
        try {compatible(current, before, before); alreadyRestored = true;} catch { /* Compare the known replay below. */ }
        if (!alreadyRestored) {
          // Never overwrite an unrecognized third-party version after failure.
          compatible(current, source, before);
          if (owned.has(slug)) assert.ok(isDeepStrictEqual(current, owned.get(slug)), 'POSTIMAGE_CHANGED');
          else assert.equal(current.metadata.version, before.metadata.version + 1, 'AMBIGUOUS_VERSION');
          await apply({project, record: before});
        }
        compatible(await read({project, slug}), before, before); restored.push(slug);
      } catch {cleanupFailed = true;}
    }
  }
  const receipt = {schema: 'stallorder-isolated-edge-rehearsal/v1', project,
    replayed, restored, usageVerified, cleanupVerified: !cleanupFailed && restored.length === attempted.length,
    releaseAuthorized: false, productionRecoveryVerified: false};
  if (failed || cleanupFailed) {
    const error = new Error(cleanupFailed ? 'EDGE_REHEARSAL_CLEANUP_REQUIRED' : 'EDGE_REHEARSAL_FAILED');
    error.receipt = receipt; throw error;
  }
  return receipt;
}
