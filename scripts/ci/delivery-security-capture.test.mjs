import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCapture, restoreCapture } from './delivery-security-capture.mjs';

const raw = Buffer.from(JSON.stringify({ version: '2.1.0', runs: [{ results: [],
  originalUriBaseIds: { '%SRCROOT%': { uri: 'file:///workspace/product/' } },
  tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.4', rules: [{ id: 'js/example' }] } },
  invocations: [{ executionSuccessful: true }], properties: { text: '完整來源證據' } }] }));
test('restore every byte of complete SARIF, including unprojected metadata', () => {
  assert.deepEqual(restoreCapture(encodeCapture(raw)), raw);
});
test('reject missing, duplicate, reordered or altered evidence chunks', () => {
  const bytes = Buffer.alloc(50_000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + (i >> 3)) % 256;
  const records = encodeCapture(Buffer.from(JSON.stringify({ text: bytes.toString('hex') })), 32);
  assert.ok(records.length > 3);
  for (const change of [
    rows => rows.splice(1, 1),
    rows => rows.push(rows[1]),
    rows => { [rows[1], rows[2]] = [rows[2], rows[1]]; },
    rows => { rows[1].data = 'AAAA' + rows[1].data.slice(4); },
  ]) { const rows = structuredClone(records); change(rows); assert.throws(() => restoreCapture(rows)); }
});
test('reject false byte lengths, digests, encodings and oversized decompression claims', () => {
  for (const delta of [{ bytes: raw.length + 1 }, { sha256: '0'.repeat(64) },
    { encoding: 'raw' }, { bytes: 70 * 1024 * 1024 }, { chunks: 0 }, { compressedSha256: 'a'.repeat(64) },
    { compressedBytes: 70 * 1024 * 1024 }, { compressedBytes: 1 }]) {
    const records = encodeCapture(raw); Object.assign(records[0], delta);
    assert.throws(() => restoreCapture(records));
  }
});
