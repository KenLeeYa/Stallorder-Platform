import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:https';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';

// Raw EZBR update contract is pinned to supabase/cli 2.109.1 commit
// 9d25ff8b5b0fba3c6f0ef000e7dd658c8d710c38, apps/cli-go/pkg/function/batch.go.
// This primitive is restricted to the existing data-less PR389 branch. It is
// not a Production rollback entrypoint and has no CLI or automatic invocation.
export async function restoreIsolatedEdgeBinary({project, record, token, deadlineAt = Date.now() + 20000}, transport = request) {
  let body, path;
  try {
    assert.equal(project, 'teunnvfakbfzmodajqjz');
    assert.ok(EDGE_SLUGS.includes(record.slug));
    assert.ok(typeof token === 'string' && /^sbp_[a-f0-9]{40}$/.test(token));
    assert.match(record.wireSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(typeof record.wireBase64, 'string'); assert.ok(record.wireBase64.length <= 16 * 1024 * 1024 * 4 / 3 + 4);
    body = Buffer.from(record.wireBase64, 'base64');
    assert.equal(body.toString('base64'), record.wireBase64);
    assert.ok(body.length > 4 && body.length <= 16 * 1024 * 1024 && body.subarray(0, 4).equals(Buffer.from('EZBR')));
    assert.equal(createHash('sha256').update(body).digest('hex'), record.wireSha256);
    assert.equal(record.metadata.sha256, record.wireSha256); assert.equal(record.metadata.verify_jwt, false);
    const params = new URLSearchParams({verify_jwt: 'false'});
    for (const key of ['entrypoint_path', 'import_map_path']) {
      const value = record.metadata[key];
      assert.ok(typeof value === 'string' && value.length > 0 && value.length < 4096 && !/[\x00-\x1f\x7f]/.test(value));
      params.set(key, value);
    }
    if (record.metadata.import_map !== undefined) {
      assert.equal(typeof record.metadata.import_map, 'boolean'); params.set('import_map', String(record.metadata.import_map));
    }
    params.set('ezbr_sha256', record.wireSha256);
    path = '/v1/projects/' + project + '/functions/' + record.slug + '?' + params;
  } catch {throw new Error('EDGE_RESTORE_INPUT');}
  const remaining = Math.min(20000, deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('EDGE_RESTORE_DEADLINE');
  return new Promise((resolve, reject) => {
    let req, res, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) {res?.destroy(); req?.destroy(); reject(error);} else resolve(value);
    };
    timer = setTimeout(() => finish(new Error('EDGE_RESTORE_DEADLINE')), remaining);
    try {
      req = transport({hostname: 'api.supabase.com', path, method: 'PATCH', headers: {
        Authorization: 'Bearer ' + token, 'Content-Type': 'application/vnd.denoland.eszip',
        'Content-Length': body.length, Accept: 'application/json', 'Accept-Encoding': 'identity',
      }}, response => {
        res = response; res.on('error', () => finish(new Error('EDGE_RESTORE_STREAM')));
        if (res.statusCode !== 200) {finish(new Error('EDGE_RESTORE_HTTP_' + res.statusCode)); return;}
        if ((res.headers['content-encoding'] ?? 'identity') !== 'identity') {finish(new Error('EDGE_RESTORE_ENCODING')); return;}
        const parts = []; let bytes = 0;
        res.on('data', chunk => {
          if (settled) return; bytes += chunk.length;
          if (bytes > 1024 * 1024) finish(new Error('EDGE_RESTORE_TOO_LARGE')); else parts.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          if (!res.complete) {finish(new Error('EDGE_RESTORE_INCOMPLETE')); return;}
          try {finish(null, JSON.parse(Buffer.concat(parts).toString('utf8')));}
          catch {finish(new Error('EDGE_RESTORE_RESPONSE'));}
        });
        res.on('close', () => {if (!res.complete) finish(new Error('EDGE_RESTORE_INCOMPLETE'));});
      });
      req.on('error', () => finish(new Error('EDGE_RESTORE_TRANSPORT')));
      if (settled) req.destroy(); else req.end(body);
    } catch {finish(new Error('EDGE_RESTORE_TRANSPORT'));}
  });
}
