import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// An opt-in compatibility experiment, not a replacement helper or a release gate.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const plugin = require('@next/eslint-plugin-next/package.json');
const helperPath = require.resolve('@next/eslint-plugin-next/dist/utils/get-root-dirs.js');
const helperSha256 = createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex');
if (process.version !== 'v24.18.0' || plugin.version !== '16.3.6'
  || helperSha256 !== '886677432990a735e5ebdfb345ff1cbd40e264f9947a8432eeeb254b3a926bde') {
  throw new Error('Probe requires the reviewed Node 24.18.0 / official plugin 16.3.6 baseline');
}
const { getRootDirs } = require(helperPath);
const base = fs.mkdtempSync(path.join(tmpdir(), 'stallorder-next-glob-'));
const original = process.cwd();
const results = [];
try {
  for (const directory of ['apps/alpha/pages', 'apps/beta/pages', 'apps/.hidden/pages', 'zeta', 'aaa', 'space dir']) {
    fs.mkdirSync(path.join(base, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(base, 'apps/file.txt'), 'fixture');
  fs.symlinkSync(path.join(base, 'apps/alpha'), path.join(base, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  process.chdir(base);
  const patterns = ['apps/*', 'apps/**', '*', '**', '.', 'apps', 'apps/', 'apps/{alpha,beta}', 'apps/@(alpha|beta)', 'apps/!(alpha)', '!apps/alpha', 'missing*', 'apps/.hidden', 'apps/.*', 'linked/**', 'apps/alpha/../beta', 'apps\\*', path.join(base, 'apps/*'), path.join(base, 'apps/alpha')];
  const redact = value => JSON.parse(JSON.stringify(value).replaceAll(JSON.stringify(base).slice(1, -1), '<fixture>').replaceAll(base.replace(/\\/g, '/'), '<fixture>'));
  for (const pattern of patterns) {
    const before = getRootDirs({ cwd: base, settings: { next: { rootDir: pattern } } });
    // Candidate is deliberately limited to the proposed native glob + directory filter.
    const after = fs.globSync(pattern.replace(/\\/g, '/'))
      .filter(entry => fs.statSync(entry).isDirectory())
      .map(entry => entry.replace(/\\/g, '/'));
    results.push(redact({ pattern, before, after, equal: JSON.stringify(before) === JSON.stringify(after) }));
  }
} finally {
  process.chdir(original);
  fs.rmSync(base, { recursive: true, force: true });
}
const compatible = results.every(result => result.equal);
const report = {
  schemaVersion: 1,
  status: compatible ? 'COMPATIBLE_FOR_MEASURED_CASES_ONLY' : 'INCOMPATIBLE_DO_NOT_APPLY',
  platform: process.platform, node: process.version, plugin: plugin.version, helperSha256,
  candidate: 'fs.globSync + statSync directory filter + slash normalization',
  total: results.length, matched: results.filter(result => result.equal).length,
  results,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  if (!process.argv[outputIndex + 1]) throw new Error('--output requires a filename');
  fs.writeFileSync(path.resolve(original, process.argv[outputIndex + 1]), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = compatible ? 0 : 1;
