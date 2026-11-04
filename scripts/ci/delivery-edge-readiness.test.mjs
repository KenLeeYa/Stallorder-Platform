import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOwnedEdgeReadiness } from './delivery-edge-readiness.mjs';

function fixture() {
  const common = { serverTiming: 'total;dur=0.1, edge-function;dur=0.1', cacheControl: 'no-store',
    requestId: '11111111-1111-4111-8111-111111111111', allowOrigin: '*' };
  return { options: { ...common, status: 204 },
    allowed: { ...common, status: 400, code: 'INVALID_REQUEST' },
    denied: { ...common, status: 403, code: 'ORIGIN_NOT_ALLOWED' } };
}
test('requires actual allowed and rejected POSTs when local gateway returns wildcard OPTIONS', () => {
  assert.deepEqual(verifyOwnedEdgeReadiness(fixture()), { ready: true,
    applicationOriginEnforced: true, preflightAllowOrigin: '*' });
});
test('also accepts exact-origin preflight with the same enforced POST boundary', () => {
  const value = fixture(); value.options.allowOrigin = 'http://127.0.0.1:3000';
  assert.equal(verifyOwnedEdgeReadiness(value).applicationOriginEnforced, true);
});
test('never accepts OPTIONS alone, untrusted origin success, uninstrumented or cached responses', () => {
  for (const mutate of [
    v => { delete v.denied; }, v => { delete v.allowed; },
    v => { v.options.allowOrigin = 'https://untrusted.invalid'; },
    v => { v.allowed.status = 201; }, v => { v.allowed.code = 'ORIGIN_NOT_ALLOWED'; },
    v => { v.denied.status = 200; }, v => { v.denied.code = 'INVALID_REQUEST'; },
    v => { v.allowed.serverTiming = null; }, v => { v.denied.serverTiming = 'fake-edge-function;dur=0.1'; },
    v => { v.denied.cacheControl = 'public, max-age=60'; }, v => { v.denied.requestId = null; },
  ]) { const value = fixture(); mutate(value); assert.throws(() => verifyOwnedEdgeReadiness(value)); }
});
