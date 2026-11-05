import assert from 'node:assert/strict';
import {createHash, randomBytes, hkdfSync, createCipheriv, createDecipheriv} from 'node:crypto';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {validateUsageFixturePair} from './delivery-edge-usage-fixture.mjs';

// A completed, source-authenticated snapshot job must publish these encrypted
// preimages before a separate job can mutate the existing isolated Preview.
// This codec grants no network, restoration or publication authority.
const schema = 'stallorder-paired-edge-preimage/v2';
const project = 'teunnvfakbfzmodajqjz';
const maximum = 16 * 1024 * 1024;
const envelopeMaximum = 160 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const aad = () => Buffer.from(JSON.stringify({schema, project}));
function instant(value) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const result = Date.parse(value);
  assert.ok(Number.isFinite(result) && new Date(result).toISOString() === value);
  return result;
}
export function validatePairedSnapshot(value, binding) {
  assert.equal(value.schema, schema); assert.equal(value.project, project);
  assert.equal(value.releaseAuthorized, false);
  assert.match(value.controlCommit ?? '', /^[a-f0-9]{40}$/);
  assert.match(value.runId ?? '', /^[1-9][0-9]*$/);
  assert.ok(Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0);
  assert.match(value.archiveSha256 ?? '', /^[a-f0-9]{64}$/);
  if (binding) for (const field of ['controlCommit', 'runId', 'runAttempt', 'archiveSha256']) assert.equal(value[field], binding[field]);
  const start = instant(value.startedAt), end = instant(value.finishedAt);
  assert.ok(start <= end && end - start <= 120000);
  assert.ok(Array.isArray(value.functions) && value.functions.length === 5);
  validateUsageFixturePair(value.usageFixtures,value.runId);
  assert.ok(Array.isArray(value.replayTargets)&&value.replayTargets.length===5);
  for (const slug of EDGE_SLUGS) {
    const targets=value.replayTargets.filter(target=>target.slug===slug);
    assert.equal(targets.length,1);
    const target=targets[0];
    assert.deepEqual(Object.keys(target).sort(),['slug','wireSha256','entrypoint_path','import_map_path','import_map'].sort());
    assert.match(target.wireSha256??'',/^[a-f0-9]{64}$/);
    for(const key of ['entrypoint_path','import_map_path'])assert.ok(typeof target[key]==='string'
      &&target[key].length>0&&target[key].length<4096&&!/[\x00-\x1f\x7f]/.test(target[key]));
    assert.ok(target.import_map===null||typeof target.import_map==='boolean');
    const records = value.functions.filter(record => record.slug === slug);
    assert.equal(records.length, 1);
    const record = records[0], metadata = record.metadata;
    assert.equal(metadata.slug, slug); assert.equal(metadata.status, 'ACTIVE');
    assert.equal(metadata.verify_jwt, false);
    assert.match(metadata.id ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    assert.ok(Number.isSafeInteger(metadata.version) && metadata.version > 0);
    assert.match(record.wireSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(metadata.sha256, record.wireSha256);
    if (metadata.ezbr_sha256 !== undefined) assert.equal(metadata.ezbr_sha256, record.wireSha256);
    for (const key of ['entrypoint_path', 'import_map_path']) assert.ok(typeof metadata[key] === 'string'
      && metadata[key].length > 0 && metadata[key].length < 4096 && !/[\x00-\x1f\x7f]/.test(metadata[key]));
    if (metadata.import_map !== undefined) assert.equal(typeof metadata.import_map, 'boolean');
    assert.equal(typeof record.wireBase64, 'string'); assert.ok(record.wireBase64.length <= maximum * 4 / 3 + 4);
    const wire = Buffer.from(record.wireBase64, 'base64');
    assert.equal(wire.toString('base64'), record.wireBase64);
    assert.ok(wire.length > 4 && wire.length <= maximum && wire.subarray(0, 4).equals(Buffer.from('EZBR')));
    assert.equal(hash(wire), record.wireSha256);
  }
}
function key(token, salt) {
  assert.ok(typeof token === 'string' && /^sbp_[a-f0-9]{40}$/.test(token));
  return Buffer.from(hkdfSync('sha256', token, salt, schema, 32));
}
function envelope(sealed) {
  assert.ok(sealed && Object.getPrototypeOf(sealed) === Object.prototype);
  const fields = ['schema', 'project', 'algorithm', 'salt', 'iv', 'tag', 'ciphertext'];
  assert.deepEqual(Reflect.ownKeys(sealed).sort(), [...fields].sort());
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(sealed, field);
    assert.ok(descriptor.enumerable && typeof descriptor.value === 'string');
  }
  assert.equal(sealed.schema, schema); assert.equal(sealed.project, project);
  assert.equal(sealed.algorithm, 'AES-256-GCM/HKDF-SHA256');
  assert.ok(Buffer.byteLength(JSON.stringify(sealed)) <= envelopeMaximum);
  const bytes = {};
  for (const field of ['salt', 'iv', 'tag', 'ciphertext']) {
    bytes[field] = Buffer.from(sealed[field], 'base64');
    assert.ok(bytes[field].length > 0);
    assert.equal(bytes[field].toString('base64'), sealed[field]);
  }
  assert.equal(bytes.salt.length, 32); assert.equal(bytes.iv.length, 12); assert.equal(bytes.tag.length, 16);
  return bytes;
}
export function sealPairedSnapshot(value, token) {
  validatePairedSnapshot(value);
  const salt = randomBytes(32), iv = randomBytes(12), derived = key(token, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', derived, iv); cipher.setAAD(aad());
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const sealed = {schema, project, algorithm: 'AES-256-GCM/HKDF-SHA256', salt: salt.toString('base64'),
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')};
    assert.ok(Buffer.byteLength(JSON.stringify(sealed)) <= envelopeMaximum);
    return sealed;
  } finally {derived.fill(0);}
}
export function openPairedSnapshot(sealed, token, binding) {
  assert.ok(binding && typeof binding === 'object');
  const bytes = envelope(sealed);
  const derived = key(token, bytes.salt);
  try {
    const cipher = createDecipheriv('aes-256-gcm', derived, bytes.iv); cipher.setAAD(aad()); cipher.setAuthTag(bytes.tag);
    const plaintext = Buffer.concat([cipher.update(bytes.ciphertext), cipher.final()]);
    const value = JSON.parse(plaintext.toString('utf8')); validatePairedSnapshot(value, binding); return value;
  } finally {derived.fill(0);}
}
export function formatPairedSnapshot(sealed, value) {
  validatePairedSnapshot(value); envelope(sealed);
  const bytes = Buffer.from(JSON.stringify(sealed)); assert.ok(bytes.length <= envelopeMaximum);
  const encoded = bytes.toString('base64'), sha256 = hash(bytes), chunks = Math.ceil(encoded.length / 12000);
  const header = {event: 'paired-preimage-capture', schema, project, controlCommit: value.controlCommit,
    runId: value.runId, runAttempt: value.runAttempt, archiveSha256: value.archiveSha256,
    startedAt: value.startedAt, finishedAt: value.finishedAt, sha256, bytes: bytes.length, chunks,
    functions: value.functions.map(record => ({slug: record.slug, id: record.metadata.id,
      version: record.metadata.version, sha256: record.wireSha256})), releaseAuthorized: false};
  const events = [header];
  for (let index = 0; index < chunks; index++) events.push({event: 'paired-preimage-chunk', sha256,
    index, data: encoded.slice(index * 12000, (index + 1) * 12000)});
  events.push({event: 'paired-preimage-complete', sha256, chunks}); return events;
}
export function decodePairedSnapshot(events, token, binding) {
  assert.ok(Array.isArray(events) && events.length >= 3 && events.length <= 20002);
  const header = events[0], complete = events.at(-1);
  assert.equal(header.event, 'paired-preimage-capture'); assert.equal(header.schema, schema);
  assert.equal(header.project, project); assert.equal(header.releaseAuthorized, false);
  assert.match(header.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(header.bytes) && header.bytes > 0 && header.bytes <= envelopeMaximum);
  assert.ok(Number.isSafeInteger(header.chunks) && header.chunks > 0 && header.chunks <= 20000);
  assert.equal(events.length, header.chunks + 2);
  assert.equal(complete.event, 'paired-preimage-complete'); assert.equal(complete.sha256, header.sha256);
  assert.equal(complete.chunks, header.chunks);
  const parts = [];
  for (let index = 0; index < header.chunks; index++) {
    const chunk = events[index + 1]; assert.equal(chunk.event, 'paired-preimage-chunk');
    assert.equal(chunk.index, index); assert.equal(chunk.sha256, header.sha256);
    assert.equal(typeof chunk.data, 'string'); assert.ok(chunk.data.length > 0 && chunk.data.length <= 12000);
    assert.match(chunk.data, /^[A-Za-z0-9+/]+={0,2}$/);
    if (index < header.chunks - 1) assert.equal(chunk.data.length, 12000);
    parts.push(chunk.data);
  }
  const encoded = parts.join(''), bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('base64'), encoded); assert.equal(bytes.length, header.bytes); assert.equal(hash(bytes), header.sha256);
  const value = openPairedSnapshot(JSON.parse(bytes.toString('utf8')), token, binding);
  for (const field of ['controlCommit', 'runId', 'runAttempt', 'archiveSha256', 'startedAt', 'finishedAt']) assert.equal(header[field], value[field]);
  assert.deepEqual(header.functions, value.functions.map(record => ({slug: record.slug, id: record.metadata.id,
    version: record.metadata.version, sha256: record.wireSha256})));
  return value;
}
