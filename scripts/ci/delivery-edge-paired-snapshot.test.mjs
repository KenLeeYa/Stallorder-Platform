import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {sealPairedSnapshot, openPairedSnapshot, formatPairedSnapshot, decodePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {createUsageFixture} from './delivery-edge-usage-fixture.mjs';

const token = 'sbp_' + '1'.repeat(40);
const binding = {controlCommit: 'a'.repeat(40), runId: '1234', runAttempt: 1, archiveSha256: 'b'.repeat(64)};
function fixture() {
  const value={schema: 'stallorder-paired-edge-preimage/v2', project: 'teunnvfakbfzmodajqjz', ...binding,
    startedAt: '2026-11-05T07:00:00.000Z', finishedAt: '2026-11-05T07:00:01.000Z',
    functions: EDGE_SLUGS.map((slug, index) => {
      const wire = Buffer.from('EZBR-synthetic-private-source-' + slug);
      const sha256 = createHash('sha256').update(wire).digest('hex');
      return {slug, wireSha256: sha256, wireBase64: wire.toString('base64'), metadata: {
        id: '12345678-1234-1234-1234-' + String(index + 1).padStart(12, '0'), slug, status: 'ACTIVE',
        version: 10, verify_jwt: false, sha256, entrypoint_path: 'file:///source/' + slug + '/index.ts',
        import_map_path: 'file:///source/deno.json', import_map: true, unknown_field: {preserve: true},
      }};
    }), releaseAuthorized: false};
  value.replayTargets=value.functions.map(r=>({slug:r.slug,wireSha256:r.wireSha256,
    entrypoint_path:r.metadata.entrypoint_path,import_map_path:r.metadata.import_map_path,import_map:r.metadata.import_map??null}));
  value.usageFixtures=[createUsageFixture(binding.runId),createUsageFixture(binding.runId)];
  return value;
}
test('authenticated encrypted paired preimages survive an independent decoder with original metadata', () => {
  const original = fixture(), sealed = sealPairedSnapshot(original, token);
  const serialized = JSON.stringify(sealed);
  assert.ok(!serialized.includes('synthetic-private-source'));
  assert.ok(!serialized.includes('unknown_field'));
  assert.deepEqual(openPairedSnapshot(JSON.parse(serialized), token, binding), original);
  assert.notEqual(JSON.stringify(sealPairedSnapshot(original, token)), serialized);
});
test('formatted records are contiguous, digest-bound and contain ciphertext only', () => {
  const original = fixture(), sealed = sealPairedSnapshot(original, token);
  const events = formatPairedSnapshot(sealed, original);
  assert.deepEqual(decodePairedSnapshot(events, token, binding), original);
  assert.equal(events[0].releaseAuthorized, false);
  assert.ok(!JSON.stringify(events).includes(original.functions[0].wireBase64));
});
test('public formatter and opener reject plaintext or extra envelope fields', () => {
  const original = fixture(), sealed = sealPairedSnapshot(original, token);
  for (const unsafe of [original, {...sealed, privateContext: 'SYNTHETIC_PRIVATE_MARKER'},
    {...sealed, toJSON: () => original}, Object.defineProperty({...sealed}, 'privateContext', {value: 'hidden'}),
    {...sealed, [Symbol('privateContext')]: 'hidden'}]) {
    assert.throws(() => formatPairedSnapshot(unsafe, original));
    assert.throws(() => openPairedSnapshot(unsafe, token, binding));
  }
});
test('public formatter validates encryption format and canonical bounded binary fields', () => {
  const original = fixture(), sealed = sealPairedSnapshot(original, token);
  for (const mutation of [{algorithm: 'none'}, {salt: 'AA=='}, {iv: ''}, {tag: 'AA=='},
    {ciphertext: ''}, {ciphertext: sealed.ciphertext + '\n'}, {project: 'eyuctbnlvnbnivwasvqr'},
    {schema: 'other'}]) {
    assert.throws(() => formatPairedSnapshot({...sealed, ...mutation}, original));
    assert.throws(() => openPairedSnapshot({...sealed, ...mutation}, token, binding));
  }
});
for (const [label, change] of [
  ['wrong target', x => {x.project = 'eyuctbnlvnbnivwasvqr';}],
  ['missing function', x => {x.functions.pop();}],
  ['duplicate function', x => {x.functions[1] = x.functions[0];}],
  ['damaged bytes', x => {x.functions[0].wireBase64 = Buffer.from('not an archive').toString('base64');}],
  ['wrong metadata digest', x => {x.functions[0].metadata.sha256 = '0'.repeat(64);}],
  ['version is not an integer', x => {x.functions[0].metadata.version = 1.5;}],
  ['backwards capture', x => {x.finishedAt = '2026-11-05T06:00:00.000Z';}],
  ['unbounded capture', x => {x.finishedAt = '2026-11-05T08:00:00.000Z';}],
  ['invalid source', x => {x.controlCommit = 'main';}],
  ['release authorization', x => {x.releaseAuthorized = true;}],
  ['missing durable usage manifests', x => {delete x.usageFixtures;}],
  ['shared usage identifiers', x => {x.usageFixtures[1]=x.usageFixtures[0];}],
  ['missing replay targets', x => {delete x.replayTargets;}],
  ['duplicate replay target', x => {x.replayTargets[1]=x.replayTargets[0];}],
  ['unbound replay digest', x => {x.replayTargets[0].wireSha256='main';}],
  ['unsafe replay configuration', x => {x.replayTargets[0].import_map_path='bad\npath';}],
]) test('refuses unsafe snapshot before sealing: ' + label, () => {
  const x = fixture(); change(x); assert.throws(() => sealPairedSnapshot(x, token));
});
for (const field of ['controlCommit', 'runId', 'runAttempt', 'archiveSha256']) test('rejects cross-run or cross-source replay: ' + field, () => {
  const sealed = sealPairedSnapshot(fixture(), token);
  assert.throws(() => openPairedSnapshot(sealed, token, {...binding, [field]: field === 'runAttempt' ? 2 : '9'.repeat(40)}));
});
test('rejects a changed key, ciphertext, authentication tag or outer target', () => {
  const sealed = sealPairedSnapshot(fixture(), token);
  assert.throws(() => openPairedSnapshot(sealed, 'sbp_' + '2'.repeat(40), binding));
  for (const field of ['ciphertext', 'tag', 'project']) {
    const x = structuredClone(sealed); x[field] = field === 'project' ? 'eyuctbnlvnbnivwasvqr' : Buffer.from('tampered').toString('base64');
    assert.throws(() => openPairedSnapshot(x, token, binding));
  }
});
test('incomplete, reordered, duplicated or renamed log records cannot supply recovery state', () => {
  const original = fixture(), events = formatPairedSnapshot(sealPairedSnapshot(original, token), original);
  for (const bad of [events.slice(0, -1), [events[1], events[0], ...events.slice(2)],
    [...events.slice(0, -1), events[1], events.at(-1)], events.map((e, i) => i === 1 ? {...e, index: 2} : e),
    events.map((e, i) => i === 0 ? {...e, event: 'other'} : e)]) {
    assert.throws(() => decodePairedSnapshot(bad, token, binding));
  }
});
test('header metadata cannot relabel otherwise authenticated captured preimages', () => {
  const x = fixture(), events = formatPairedSnapshot(sealPairedSnapshot(x, token), x);
  for (const mutation of [{archiveSha256: 'c'.repeat(64)}, {finishedAt: '2026-11-05T07:01:00.000Z'},
    {functions: events[0].functions.slice(1)}, {releaseAuthorized: true}]) {
    assert.throws(() => decodePairedSnapshot([{...events[0], ...mutation}, ...events.slice(1)], token, binding));
  }
});
