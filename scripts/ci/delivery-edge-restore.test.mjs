import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {restoreIsolatedEdgeBinary} from './delivery-edge-restore.mjs';
const project = 'teunnvfakbfzmodajqjz', token = 'sbp_' + 'a'.repeat(40);
function fixture() {
  const body = Buffer.from('EZBRsynthetic-eszip');
  const sha256 = createHash('sha256').update(body).digest('hex');
  return {project, token, record: {slug: 'create-public-order', wireSha256: sha256,
    wireBase64: body.toString('base64'), metadata: {sha256, verify_jwt: false,
      entrypoint_path: 'file:///source/create-public-order/index.ts',
      import_map_path: 'file:///source/deno.json', import_map: true}}};
}
function fake({status = 200, encoding = 'identity', complete = true, stream} = {}) {
  const req = new EventEmitter(), res = new EventEmitter(), calls = [];
  req.destroy = () => {req.destroyed = true;}; res.destroy = () => {res.destroyed = true;};
  res.statusCode = status; res.headers = {'content-encoding': encoding}; res.complete = complete;
  req.end = body => {calls[0].body = body; queueMicrotask(() => {
    calls[0].callback(res);
    if (stream) stream(res);
    else {res.emit('data', Buffer.from('{"id":"preview-only"}')); res.emit('end');}
  });};
  return {calls, req, res, request: (options, callback) => {calls.push({options, callback}); return req;}};
}
test('sends the exact archived binary only to the isolated project using official raw update semantics', async () => {
  const x = fixture(), t = fake();
  const out = await restoreIsolatedEdgeBinary(x, t.request);
  assert.equal(t.calls.length, 1);
  const {options, body} = t.calls[0];
  assert.equal(options.hostname, 'api.supabase.com'); assert.equal(options.method, 'PATCH');
  const url = new URL('https://' + options.hostname + options.path);
  assert.equal(url.pathname, '/v1/projects/' + project + '/functions/create-public-order');
  assert.deepEqual(Object.fromEntries(url.searchParams), {verify_jwt: 'false', entrypoint_path: x.record.metadata.entrypoint_path,
    import_map_path: x.record.metadata.import_map_path, import_map: 'true', ezbr_sha256: x.record.wireSha256});
  assert.deepEqual(body, Buffer.from(x.record.wireBase64, 'base64'));
  assert.equal(options.headers['Content-Type'], 'application/vnd.denoland.eszip');
  assert.equal(options.headers['Content-Length'], body.length);
  assert.equal(options.headers.Authorization, 'Bearer ' + token);
  assert.deepEqual(out, {id: 'preview-only'});
});
for (const [name, change] of [
  ['Primary target', x => x.project = 'eyuctbnlvnbnivwasvqr'],
  ['arbitrary target', x => x.project = 'other'],
  ['foreign slug', x => x.record.slug = '../other'],
  ['changed bytes', x => x.record.wireBase64 = Buffer.from('EZBRchanged').toString('base64')],
  ['noncanonical encoding', x => x.record.wireBase64 += '?'],
  ['metadata digest drift', x => x.record.metadata.sha256 = 'b'.repeat(64)],
  ['JWT policy drift', x => x.record.metadata.verify_jwt = true],
  ['entrypoint control character', x => x.record.metadata.entrypoint_path += '\n'],
  ['missing import map', x => delete x.record.metadata.import_map_path],
  ['invalid import-map flag', x => x.record.metadata.import_map = 'true'],
  ['invalid token', x => x.token = token + ' '],
  ['expired deadline', x => x.deadlineAt = Date.now() - 1],
]) test('rejects before network: ' + name, async () => {
  const x = fixture(), t = fake(); change(x);
  await assert.rejects(restoreIsolatedEdgeBinary(x, t.request), /^Error: EDGE_RESTORE_/);
  assert.equal(t.calls.length, 0);
});
for (const [status, encoding, complete, expected] of [
  [302, 'identity', true, 'HTTP_302'], [403, 'identity', true, 'HTTP_403'],
  [500, 'identity', true, 'HTTP_500'], [200, 'br', true, 'ENCODING'],
  [200, 'identity', false, 'INCOMPLETE'],
]) test('does not retry or follow an invalid response: ' + expected, async () => {
  const t = fake({status, encoding, complete});
  await assert.rejects(restoreIsolatedEdgeBinary(fixture(), t.request), new RegExp('EDGE_RESTORE_' + expected));
  assert.equal(t.calls.length, 1); assert.equal(t.req.destroyed, true); assert.equal(t.res.destroyed, true);
});
test('masks provider JSON and synchronous transport failures', async () => {
  const marker = 'private-synthetic-source';
  const t = fake({stream: r => {r.emit('data', Buffer.from(marker)); r.emit('end');}});
  for (const transport of [t.request, () => {throw new Error(marker);}]) {
    await assert.rejects(restoreIsolatedEdgeBinary(fixture(), transport), e => /^EDGE_RESTORE_/.test(e.message) && !e.message.includes(marker));
  }
});
test('absolute deadline destroys a continuously active response', async () => {
  let interval;
  const t = fake({stream: r => {interval = setInterval(() => r.emit('data', Buffer.from('x')), 2);}});
  try {
    await assert.rejects(restoreIsolatedEdgeBinary({...fixture(), deadlineAt: Date.now() + 40}, t.request), /EDGE_RESTORE_DEADLINE/);
    assert.equal(t.req.destroyed, true); assert.equal(t.res.destroyed, true);
  } finally {clearInterval(interval);}
});
test('response overflow is bounded and never echoed', async () => {
  const t = fake({stream: r => r.emit('data', Buffer.alloc(1024 * 1024 + 1))});
  await assert.rejects(restoreIsolatedEdgeBinary(fixture(), t.request), /EDGE_RESTORE_TOO_LARGE/);
});
