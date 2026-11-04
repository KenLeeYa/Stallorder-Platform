import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const maxBytes = 64 * 1024 * 1024;
const maxCompressedBytes = maxBytes + 1024 * 1024;
const maxEncodedBytes = Math.ceil(maxCompressedBytes / 3) * 4;
const maxChunks = Math.ceil(maxEncodedBytes / 32);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function encodeCapture(bytes, chunkSize = 12000) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxBytes);
  assert.ok(Number.isSafeInteger(chunkSize) && chunkSize >= 32 && chunkSize <= 12000 && chunkSize % 4 === 0);
  const compressed = gzipSync(bytes); const encoded = compressed.toString('base64');
  const count = Math.ceil(encoded.length / chunkSize);
  return [{ event: 'sarif-capture', encoding: 'gzip-base64', bytes: bytes.length,
    sha256: hash(bytes), compressedBytes: compressed.length, compressedSha256: hash(compressed), chunks: count },
  ...Array.from({ length: count }, (_, index) => ({ event: 'sarif-chunk', index,
    data: encoded.slice(index * chunkSize, (index + 1) * chunkSize) }))];
}
export function restoreCapture(records) {
  assert.ok(Array.isArray(records) && records.length > 1 && records.length <= maxChunks + 1);
  const header = records[0];
  assert.equal(header?.event, 'sarif-capture');
  assert.equal(header.encoding, 'gzip-base64');
  assert.ok(Number.isSafeInteger(header.bytes) && header.bytes > 0 && header.bytes <= maxBytes);
  assert.ok(Number.isSafeInteger(header.compressedBytes) && header.compressedBytes > 0
    && header.compressedBytes <= maxCompressedBytes);
  assert.match(header.sha256, /^[a-f0-9]{64}$/);
  assert.match(header.compressedSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(header.chunks) && header.chunks > 0 && header.chunks === records.length - 1);
  const expectedEncodedBytes = Math.ceil(header.compressedBytes / 3) * 4;
  let encodedBytes = 0;
  for (let index = 0; index < header.chunks; index++) {
    const chunk = records[index + 1];
    assert.equal(chunk.event, 'sarif-chunk'); assert.equal(chunk.index, index);
    assert.ok(typeof chunk.data === 'string' && chunk.data.length > 0 && chunk.data.length <= 12000);
    assert.match(chunk.data, /^[A-Za-z0-9+/]+={0,2}$/);
    encodedBytes += chunk.data.length;
    assert.ok(encodedBytes <= expectedEncodedBytes && encodedBytes <= maxEncodedBytes);
  }
  assert.equal(encodedBytes, expectedEncodedBytes);
  const encoded = records.slice(1).map(chunk => chunk.data).join('');
  const compressed = Buffer.from(encoded, 'base64');
  assert.equal(compressed.length, header.compressedBytes);
  assert.equal(compressed.toString('base64'), encoded);
  assert.equal(hash(compressed), header.compressedSha256);
  const bytes = gunzipSync(compressed, { maxOutputLength: header.bytes });
  assert.equal(bytes.length, header.bytes); assert.equal(hash(bytes), header.sha256);
  return bytes;
}
async function emitRecord(record) {
  await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(record) + '\n',
    error => error ? reject(error) : resolve()));
}
async function main() {
  const directory = process.argv[2]; assert.ok(directory);
  const files = readdirSync(directory).filter(path => path.endsWith('.sarif'));
  assert.equal(files.length, 1, 'one complete SARIF required');
  const raw = readFileSync(resolve(directory, files[0]));
  // Await pipe backpressure before the fail-closed exit. An uncaught assertion
  // previously terminated Linux before buffered SARIF chunks reached the runner.
  for (const record of encodeCapture(raw)) await emitRecord(record);
  const sarif = JSON.parse(raw);
  assert.equal(sarif.version, '2.1.0'); assert.equal(sarif.runs?.length, 1);
  const results = sarif.runs[0].results; assert.ok(Array.isArray(results));
  for (const result of results) await emitRecord({ ruleId: result.ruleId,
    message: result.message?.text, locations: result.locations });
  await emitRecord({ rawSarifSha256: hash(raw), findings: results.length, releaseAuthorized: false });
  assert.equal(results.length, 0, 'Raw source security gate remains blocked pending complete review');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
