import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeCapture, restoreCapture } from './delivery-security-capture.mjs';

const raw = Buffer.from(JSON.stringify({ version: '2.1.0', runs: [{ results: [],
  originalUriBaseIds: { '%SRCROOT%': { uri: 'file:///workspace/product/' } },
  tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.4', rules: [{ id: 'js/example' }] } },
  invocations: [{ executionSuccessful: true }], properties: { text: '完整來源證據' } }] }));
test('restore every byte of complete SARIF, including unprojected metadata', () => {
  assert.deepEqual(restoreCapture(encodeCapture(raw)), raw);
});
test('failing CLI flushes the entire large SARIF through a piped stdout before exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'delivery-sarif-flush-'));
  try {
    const bytes = Buffer.from(JSON.stringify({ version: '2.1.0', runs: [{
      results: [{ ruleId: 'js/example', message: { text: 'review required' }, locations: [] }],
      properties: { unprojectedEvidence: randomBytes(256 * 1024).toString('hex') },
    }] }));
    await writeFile(join(directory, 'complete.sarif'), bytes);
    const result = await new Promise(resolve => execFile(process.execPath,
      [fileURLToPath(new URL('./delivery-security-capture.mjs', import.meta.url)), directory],
      { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
    assert.equal(result.error?.code, 1, 'unresolved findings must still fail the process');
    const records = result.stdout.trim().split('\n').map(line => JSON.parse(line))
      .filter(record => ['sarif-capture', 'sarif-chunk'].includes(record.event));
    assert.deepEqual(restoreCapture(records), bytes);
    assert.match(result.stderr, /Raw source security gate remains blocked/);
  } finally { await rm(directory, { recursive: true, force: true }); }
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
