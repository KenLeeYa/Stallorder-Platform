import { describe, expect, it } from 'vitest';
import { readCheckedFile } from './checked-file-read.mjs';
import { mkdtempSync, writeFileSync, openSync, fstatSync, closeSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const stat = { dev: 1, ino: 2, size: 4, mtimeMs: 10, ctimeMs: 10, isFile: () => true };
function filesystem({ before = stat, after = stat, bytes = Buffer.from('safe'), fail = false } = {}) {
 const calls = []; let checks = 0;
 return { calls, io: {
  openSync: (path, mode) => { calls.push(['open', path, mode]); return 7; },
  fstatSync: fd => { calls.push(['stat', fd]); return checks++ ? after : before; },
  readFileSync: fd => { calls.push(['read', fd]); if (fail) throw Error('READ_FAILED'); return bytes; },
  closeSync: fd => calls.push(['close', fd]),
 } };
}
describe('descriptor-bound evidence reads', () => {
 it('reads actual bytes and rejects a replaced file against its preimage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'checked-file-'));
  try {
   const file = join(directory, 'evidence'); writeFileSync(file, 'safe');
   const fd = openSync(file, 'r');
   let expected;
   try { expected = fstatSync(fd); } finally { closeSync(fd); }
   expect(readCheckedFile(file, { expected }).toString()).toBe('safe');
   rmSync(file); writeFileSync(file, 'replacement');
   expect(() => readCheckedFile(file, { expected })).toThrow('FILE_READ_IDENTITY_CHANGED');
  } finally { rmSync(directory, { recursive: true, force: true }); }
 });
 it('checks and reads the identical open descriptor', () => {
  const f = filesystem(); expect(readCheckedFile('candidate', {}, f.io).toString()).toBe('safe');
  expect(f.calls).toEqual([['open', 'candidate', 'r'], ['stat', 7], ['read', 7], ['stat', 7], ['close', 7]]);
 });
 it('rejects replacement after a prior path check before reading', () => {
  const f = filesystem({ before: { ...stat, ino: 3 } });
  expect(() => readCheckedFile('candidate', { expected: stat }, f.io)).toThrow('FILE_READ_IDENTITY_CHANGED');
  expect(f.calls.some(call => call[0] === 'read')).toBe(false); expect(f.calls.at(-1)).toEqual(['close', 7]);
 });
 it('rejects mutation during reading and closes the descriptor', () => {
  const f = filesystem({ after: { ...stat, mtimeMs: 11 } });
  expect(() => readCheckedFile('candidate', {}, f.io)).toThrow('FILE_READ_CHANGED');
  expect(f.calls.at(-1)).toEqual(['close', 7]);
 });
 it('rejects byte-size mismatch', () => {
  const f = filesystem({ bytes: Buffer.from('replacement') });
  expect(() => readCheckedFile('candidate', {}, f.io)).toThrow('FILE_READ_CHANGED');
 });
 it('does not read oversized or non-file objects', () => {
  for (const options of [{ maxBytes: 3 }, {}]) {
   const f = filesystem({ before: options.maxBytes ? stat : { ...stat, isFile: () => false } });
   expect(readCheckedFile('candidate', options, f.io)).toBeNull();
   expect(f.calls.some(call => call[0] === 'read')).toBe(false); expect(f.calls.at(-1)).toEqual(['close', 7]);
  }
 });
 it('closes when a read fails without replacing its error', () => {
  const f = filesystem({ fail: true }); expect(() => readCheckedFile('candidate', {}, f.io)).toThrow('READ_FAILED');
  expect(f.calls.at(-1)).toEqual(['close', 7]);
 });
});
