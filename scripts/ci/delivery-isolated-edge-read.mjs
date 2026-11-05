import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {get} from 'node:https';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
const target = 'teunnvfakbfzmodajqjz', maximum = 16 * 1024 * 1024;
function inputs({project, slug, token, deadlineAt}) {
  if (project !== target || !EDGE_SLUGS.includes(slug) || typeof token !== 'string' || !/^sbp_[a-f0-9]{40}$/.test(token)) throw new Error('EDGE_ISOLATED_INPUT');
  if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) throw new Error('EDGE_ISOLATED_DEADLINE');
}
function metadata(value, slug) {
  assert.equal(value.slug, slug); assert.equal(value.status, 'ACTIVE'); assert.equal(value.verify_jwt, false);
  assert.match(value.id ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.ok(Number.isSafeInteger(value.version) && value.version > 0);
  const digest = value.sha256 ?? value.ezbr_sha256; assert.match(digest ?? '', /^[a-f0-9]{64}$/);
  if (value.sha256 && value.ezbr_sha256) assert.equal(value.sha256, value.ezbr_sha256);
  for (const key of ['entrypoint_path', 'import_map_path']) assert.ok(typeof value[key] === 'string' && value[key].length > 0 && value[key].length < 4096 && !/[\x00-\x1f\x7f]/.test(value[key]));
  if (value.import_map !== undefined) assert.equal(typeof value.import_map, 'boolean');
  return {...value, sha256: digest};
}
export async function readIsolatedEdgeRecord({project, slug, token, deadlineAt = Date.now() + 20000, read = readIsolatedEdgeResponse}) {
  inputs({project, slug, token, deadlineAt});
  try {
    const request = async body => {
      inputs({project, slug, token, deadlineAt});
      const result = await read({project, slug, token, deadlineAt, body});
      inputs({project, slug, token, deadlineAt}); return result;
    };
    const before = metadata(JSON.parse((await request(false)).bytes.toString('utf8')), slug);
    const raw = await request(true);
    assert.ok(Buffer.isBuffer(raw.bytes) && raw.bytes.length > 0 && raw.bytes.length <= maximum);
    assert.ok(['identity', 'br'].includes(raw.encoding));
    const wire = raw.bytes.subarray(0, 4).equals(Buffer.from('EZBR')) ? raw.bytes :
      raw.encoding === 'br' ? Buffer.concat([Buffer.from('EZBR'), raw.bytes]) : null;
    assert.ok(wire && wire.length > 4 && wire.length <= maximum);
    assert.equal(createHash('sha256').update(wire).digest('hex'), before.sha256);
    const after = metadata(JSON.parse((await request(false)).bytes.toString('utf8')), slug);
    assert.deepEqual(after, before);
    return {slug, metadata: before, wireSha256: before.sha256, wireBase64: wire.toString('base64')};
  } catch {throw new Error('EDGE_ISOLATED_READBACK');}
}
export async function readIsolatedEdgeResponse({project, slug, token, body = false, deadlineAt = Date.now() + 20000}, transport = get) {
  inputs({project, slug, token, deadlineAt});
  if (typeof body !== 'boolean') throw new Error('EDGE_ISOLATED_INPUT');
  const remaining = Math.min(20000, deadlineAt - Date.now());
  return new Promise((resolve, reject) => {
    let req, res, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) {res?.destroy(); req?.destroy(); reject(error);} else resolve(value);
    };
    timer = setTimeout(() => finish(new Error('EDGE_ISOLATED_DEADLINE')), remaining);
    try {
      req = transport({hostname: 'api.supabase.com', path: '/v1/projects/' + target + '/functions/' + slug + (body ? '/body' : ''),
        headers: {Authorization: 'Bearer ' + token, Accept: body ? 'application/octet-stream' : 'application/json', 'Accept-Encoding': 'identity'}}, response => {
        res = response; res.on('error', () => finish(new Error('EDGE_ISOLATED_STREAM')));
        if (res.statusCode !== 200) {finish(new Error('EDGE_ISOLATED_HTTP_' + res.statusCode)); return;}
        const encoding = res.headers['content-encoding'] ?? 'identity';
        if (!['identity', 'br'].includes(encoding) || (!body && encoding !== 'identity')) {finish(new Error('EDGE_ISOLATED_ENCODING')); return;}
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          if (settled) return; size += chunk.length;
          if (size > (body ? maximum : 1024 * 1024)) finish(new Error('EDGE_ISOLATED_TOO_LARGE')); else chunks.push(chunk);
        });
        res.on('end', () => {
          if (!res.complete) {finish(new Error('EDGE_ISOLATED_INCOMPLETE')); return;}
          finish(null, {bytes: Buffer.concat(chunks), encoding});
        });
        res.on('close', () => {if (!res.complete) finish(new Error('EDGE_ISOLATED_INCOMPLETE'));});
      });
      req.on('error', () => finish(new Error('EDGE_ISOLATED_TRANSPORT'))); if (settled) req.destroy();
    } catch {finish(new Error('EDGE_ISOLATED_TRANSPORT'));}
  });
}
