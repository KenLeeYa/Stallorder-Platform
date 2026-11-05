import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {readIsolatedEdgeRecord, readIsolatedEdgeResponse} from './delivery-isolated-edge-read.mjs';
const project = 'teunnvfakbfzmodajqjz', slug = 'create-public-order', token = 'sbp_' + 'a'.repeat(40);
function fixture() {
  const wire = Buffer.from('EZBRsynthetic-eszip');
  const sha256 = createHash('sha256').update(wire).digest('hex');
  const metadata = {slug, id: '12345678-1234-1234-1234-123456789012', version: 10, status: 'ACTIVE', verify_jwt: false,
    entrypoint_path: 'file:///source/' + slug + '/index.ts', import_map_path: 'file:///source/deno.json', sha256};
  const reads = [];
  const read = async args => {reads.push(args); return args.body ? {bytes: wire, encoding: 'identity'} : {bytes: Buffer.from(JSON.stringify(metadata)), encoding: 'identity'};};
  return {project, slug, token, wire, metadata, reads, read};
}
test('binds stable metadata/body/metadata and exact original bytes to the isolated project', async () => {
  const x = fixture(), out = await readIsolatedEdgeRecord(x);
  assert.deepEqual(x.reads.map(r => r.body), [false, true, false]); assert.ok(x.reads.every(r => r.project === project));
  assert.equal(out.wireBase64, x.wire.toString('base64')); assert.equal(out.wireSha256, x.metadata.sha256);
  assert.deepEqual(out.metadata, x.metadata);
});
test('reattaches only the documented EZBR envelope to raw br bytes after checking digest', async () => {
  const x = fixture();
  const out = await readIsolatedEdgeRecord({...x, read: a => a.body ? {bytes: x.wire.subarray(4), encoding: 'br'} : x.read(a)});
  assert.equal(out.wireBase64, x.wire.toString('base64'));
});
for (const [name, change] of [
  ['Primary target', x => x.project = 'eyuctbnlvnbnivwasvqr'], ['foreign slug', x => x.slug = '../other'],
  ['invalid token', x => x.token += ' '], ['expired deadline', x => x.deadlineAt = Date.now() - 1],
]) test('rejects before any read: ' + name, async () => {
  const x = fixture(); change(x); await assert.rejects(readIsolatedEdgeRecord(x), /EDGE_ISOLATED_/); assert.equal(x.reads.length, 0);
});
for (const key of ['version', 'verify_jwt', 'import_map_path', 'unknown_config']) test('rejects metadata drift during body read: ' + key, async () => {
  const x = fixture(); let count = 0;
  await assert.rejects(readIsolatedEdgeRecord({...x, read: async a => {const result = await x.read(a); if (++count === 3) result.bytes = Buffer.from(JSON.stringify({...x.metadata, [key]: 'changed'})); return result;}}), /EDGE_ISOLATED_/);
});
test('rejects body digest changes and malformed provider JSON without leaking bytes', async () => {
  for (const body of [false, true]) {
    const x = fixture(), marker = 'private-synthetic-source';
    await assert.rejects(readIsolatedEdgeRecord({...x, read: a => a.body === body ? {bytes: Buffer.from(marker), encoding: 'identity'} : x.read(a)}), e => /^EDGE_ISOLATED_/.test(e.message) && !JSON.stringify(e).includes(marker));
  }
});
function fake(status = 200, encoding = 'identity') {
  const req = new EventEmitter(), res = new EventEmitter(), calls = [];
  req.destroy = () => {req.destroyed = true;}; res.destroy = () => {res.destroyed = true;};
  res.statusCode = status; res.headers = {'content-encoding': encoding}; res.complete = true;
  return {req, res, calls, get: (options, callback) => {calls.push(options); queueMicrotask(() => {callback(res); res.emit('data', Buffer.from('EZBRsynthetic')); res.emit('end');}); return req;}};
}
test('native raw read uses fixed HTTPS endpoint and never decompresses returned bytes', async () => {
  const t = fake(200, 'br'), x = fixture();
  const r = await readIsolatedEdgeResponse({...x, body: true}, t.get);
  assert.equal(t.calls[0].hostname, 'api.supabase.com');
  assert.equal(t.calls[0].path, '/v1/projects/' + project + '/functions/' + slug + '/body');
  assert.equal(t.calls[0].headers['Accept-Encoding'], 'identity'); assert.equal(r.encoding, 'br');
  assert.equal(r.bytes.toString(), 'EZBRsynthetic');
});
for (const [status, encoding] of [[302, 'identity'], [403, 'identity'], [200, 'gzip'], [200, 'br']]) test('aborts disallowed metadata response: ' + status + '/' + encoding, async () => {
  const t = fake(status, encoding);
  await assert.rejects(readIsolatedEdgeResponse({...fixture(), body: false}, t.get), /EDGE_ISOLATED_/);
  assert.equal(t.calls.length, 1); assert.equal(t.req.destroyed, true); assert.equal(t.res.destroyed, true);
});
