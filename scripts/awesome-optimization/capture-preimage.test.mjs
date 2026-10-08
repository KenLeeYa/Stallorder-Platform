import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./batch-2/capture.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf(' const snapshot ='), source.indexOf('\n});'));
const missing = () => Object.assign(Error('missing'), { code: 'ENOENT' });
function capture(snapshotRead) {
 const reads = [];
 const run = () => runInNewContext(`(path=>{${body}})('source.ts')`, {
  directory: 'synthetic',
  readFileSync(path) { reads.push(path); if (path === 'source.ts') throw missing(); return snapshotRead(); },
  writeFileSync() { throw Error('absent source must not write'); },
 });
 return { reads, run };
}

test('partial capture rejects the old snapshot even when its source has disappeared', () => {
 const attempt = capture(() => Buffer.from('original preimage'));
 expect(attempt.run).toThrow('PREIMAGE_ALREADY_CAPTURED:source.ts');
 expect(attempt.reads).toEqual(['source.ts', 'synthetic/before/source.ts.before']);
});

test('absent source is accepted only when its snapshot is also absent', () => {
 const attempt = capture(() => { throw missing(); });
 expect(attempt.run()).toMatchObject({ path: 'source.ts', existed: false, snapshot: null, sha256: null });
 expect(attempt.reads).toEqual(['source.ts', 'synthetic/before/source.ts.before']);
});

test('a snapshot permission failure cannot be mistaken for absent preimage', () => {
 const attempt = capture(() => { throw Object.assign(Error('denied'), { code: 'EACCES' }); });
 expect(attempt.run).toThrow('denied');
});
