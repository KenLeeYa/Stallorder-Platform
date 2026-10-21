import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.each([false, true])('actual CLI fixture graph cycleRemoved=%s has the expected completion', cycleRemoved => {
  const dir = mkdtempSync(join(tmpdir(), 'pr366-fixture-cli-'));
  try {
    const source = readFileSync(new URL('./qa-pr366-preview-ui.mjs', import.meta.url), 'utf8');
    const targetModule = new URL('./lib/pr366-preview-target.mjs', import.meta.url);
    const targetSource = !cycleRemoved && existsSync(targetModule) ? readFileSync(targetModule, 'utf8')
      : source.match(/export function assertTarget[\s\S]*?\n}\r?\n/)?.[0]
        ?? "import { assertTarget } from './lib/pr366-preview-target.mjs'; export { assertTarget };";
    const dynamicImport = source.match(/const \{ createFixtureClient \} = await import\('\.\/qa-pr366-preview-fixtures\.mjs'\);/)[0];
    const footer = source.slice(source.lastIndexOf('\nif (process.argv[1]'));
    // Keep actual CLI dispatch/top-level await and fixture import graph; replace only browser/provider work.
    writeFileSync(join(dir, 'qa-pr366-preview-ui.mjs'), `import {readFileSync} from 'node:fs'; import {resolve} from 'node:path'; import {pathToFileURL} from 'node:url';
${targetSource}
async function run() { console.log('BEFORE_FIXTURE_IMPORT'); ${dynamicImport} if(typeof createFixtureClient !== 'function') throw Error('FIXTURE_NOT_LOADED'); console.log('AFTER_FIXTURE_IMPORT'); }
const runPreorderPhase=run,runCashShiftPhase=run,runHoursPhase=run;
${footer}`);
    const fixtureSource = readFileSync(new URL('./qa-pr366-preview-fixtures.mjs', import.meta.url), 'utf8');
    writeFileSync(join(dir, 'qa-pr366-preview-fixtures.mjs'), cycleRemoved ? fixtureSource
      : fixtureSource.replace("'./lib/pr366-preview-target.mjs'", "'./qa-pr366-preview-ui.mjs'"));
    if (existsSync(targetModule)) {
      // A pure helper has no provider/browser dependencies.
      mkdirSync(join(dir, 'lib'));
      writeFileSync(join(dir, 'lib/pr366-preview-target.mjs'), readFileSync(targetModule));
    }
    writeFileSync(join(dir, 'receipt.json'), '{}'); writeFileSync(join(dir, 'binding.json'), '{}');
    const result = spawnSync(process.execPath, [join(dir, 'qa-pr366-preview-ui.mjs'), join(dir, 'receipt.json'), join(dir, 'binding.json')], { encoding: 'utf8', timeout: 5000 });
    expect(result.stdout).toContain('BEFORE_FIXTURE_IMPORT');
    if (cycleRemoved) {
      expect(result.stdout).toContain('AFTER_FIXTURE_IMPORT'); expect(result.status).toBe(0);
    } else {
      expect(result.stdout).not.toContain('AFTER_FIXTURE_IMPORT');
      expect(result.status).toBe(13); // Node's unresolved top-level await, not a fixture/API timeout.
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

