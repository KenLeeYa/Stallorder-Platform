import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const control = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const product = process.env.DELIVERY_SECURITY_PRODUCT
  ? resolve(control, process.env.DELIVERY_SECURITY_PRODUCT) : control;
const source = resolve(product, 'scripts/lib/production-json-file.mjs');
const expected = '7d2a4423398984006161d6bdb3ae1dc99c7e33393ef75faf876ed90f8fc4c6e9';
assert.equal(createHash('sha256').update(await fs.readFile(source)).digest('hex'), expected,
  'native tests must execute the independently reviewed reader');
const { readProductionJsonFile } = await import(pathToFileURL(source));
const base = resolve(control, 'artifacts/delivery-hours-20261029/approval-native-tests');
const owned = [];
async function fixture(contents = '{"id":"approved"}') {
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(resolve(base, 'case-'));
  owned.push(directory);
  const path = resolve(directory, 'receipt.json');
  await fs.writeFile(path, contents);
  return path;
}
afterEach(async () => {
  for (const directory of owned.splice(0)) {
    assert.ok(resolve(directory).startsWith(base + sep));
    await fs.rm(directory, { recursive: true });
  }
});
test('accept an exact 64 KiB JSON document', async () => {
  assert.deepEqual(await readProductionJsonFile(await fixture('{"id":"approved"}'.padEnd(65_536)), 'INVALID'),
    { id: 'approved' });
});
test('reject a 64 KiB plus one byte document', async () => {
  await assert.rejects(readProductionJsonFile(await fixture(' '.repeat(65_537)), 'INVALID'), /INVALID/);
});
test('read short descriptor chunks until EOF', async t => {
  const path = await fixture();
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args); const read = handle.read.bind(handle);
    handle.read = (buffer, offset, length, position) => read(buffer, offset, Math.min(length, 3), position);
    return handle;
  });
  assert.deepEqual(await readProductionJsonFile(path, 'INVALID'), { id: 'approved' });
});
test('reject a same-size write while reading and close the descriptor', async t => {
  const path = await fixture(); const open = fs.open.bind(fs); let closed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args); const read = handle.read.bind(handle); const close = handle.close.bind(handle);
    let changed = false;
    handle.read = async (...values) => {
      const result = await read(...values);
      if (!changed) {
        changed = true; await fs.writeFile(path, '{"id":"replaced"}');
        const later = new Date(Date.now() + 2000); await fs.utimes(path, later, later);
      }
      return result;
    };
    handle.close = async () => { closed = true; await close(); };
    return handle;
  });
  await assert.rejects(readProductionJsonFile(path, 'INVALID'), /INVALID/);
  assert.equal(closed, true);
});
test('reject native Linux symlinks', { skip: process.platform !== 'linux' }, async () => {
  const path = await fixture(); const link = path + '.link';
  await fs.symlink(path, link);
  await assert.rejects(readProductionJsonFile(link, 'INVALID'), /INVALID/);
});
test('reject a symlink swapped after lstat even when it targets the original inode', { skip: process.platform !== 'linux' }, async t => {
  const path = await fixture(); const lstat = fs.lstat.bind(fs); let swapped = false;
  t.mock.method(fs, 'lstat', async (...args) => {
    const metadata = await lstat(...args);
    if (!swapped && args[0] === path) {
      swapped = true; await fs.rename(path, path + '.original');
      await fs.symlink(path + '.original', path);
    }
    return metadata;
  });
  await assert.rejects(readProductionJsonFile(path, 'INVALID'), /INVALID/);
});
test('reject a native Linux FIFO without waiting for a writer', { skip: process.platform !== 'linux', timeout: 3000 }, async () => {
  const path = await fixture(); const fifo = path + '.fifo';
  execFileSync('mkfifo', [fifo], { timeout: 1000 });
  await assert.rejects(readProductionJsonFile(fifo, 'INVALID'), /INVALID/);
});
test('reject a FIFO swapped after lstat within a bounded subprocess', { skip: process.platform !== 'linux', timeout: 5000 }, async () => {
  const path = await fixture();
  const child = `
    import fs from 'node:fs/promises';
    import assert from 'node:assert/strict';
    import {execFileSync} from 'node:child_process';
    const [source, path] = process.argv.slice(1);
    const {readProductionJsonFile} = await import(source);
    const original = fs.lstat.bind(fs); let swapped = false;
    fs.lstat = async (...args) => {
      const metadata = await original(...args);
      if (!swapped && args[0] === path) {
        swapped = true; await fs.rename(path, path + '.original'); execFileSync('mkfifo', [path], {timeout: 1000});
      }
      return metadata;
    };
    await assert.rejects(readProductionJsonFile(path, 'INVALID'), /INVALID/);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', child, pathToFileURL(source).href, path],
    { timeout: 2500, maxBuffer: 4096 });
});
