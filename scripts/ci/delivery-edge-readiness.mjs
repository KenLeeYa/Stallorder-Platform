import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3000';
const timed = value => typeof value === 'string' && /(?:^|,\s*)edge-function;dur=\d+(?:\.\d+)?(?:,|$)/.test(value);
export function verifyOwnedEdgeReadiness({ options, allowed, denied }) {
  assert.equal(options.status, 204);
  // The disposable Supabase gateway can replace this with '*'. OPTIONS alone
  // never proves the application's origin boundary; both real POSTs below must.
  assert.ok([origin, '*'].includes(options.allowOrigin));
  assert.ok(timed(options.serverTiming));
  for (const response of [allowed, denied]) {
    assert.ok(timed(response.serverTiming));
    assert.match(response.cacheControl ?? '', /(?:^|,\s*)no-store(?:,|$)/);
    assert.match(response.requestId ?? '', /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  }
  assert.ok([origin, '*'].includes(allowed.allowOrigin));
  assert.equal(allowed.status, 400); assert.equal(allowed.code, 'INVALID_REQUEST');
  assert.equal(denied.status, 403); assert.equal(denied.code, 'ORIGIN_NOT_ALLOWED');
  return { ready: true, applicationOriginEnforced: true, preflightAllowOrigin: options.allowOrigin };
}
