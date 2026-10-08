import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';
import { previewUiBudget, selectLinuxOwnedTree, supervisePreviewUi, verifiedLinuxRoot } from './qa-pr366-preview-ui-supervised.mjs';

test('fixed UI budgets reserve cleanup and termination time and reject unknown phases', () => {
  const now = Date.now();
  const receipt = { expiresAt: new Date(now + 60 * 60_000).toISOString() };
  expect(previewUiBudget(receipt, undefined, now)).toBe(12 * 60_000);
  expect(previewUiBudget(receipt, 'hours-open', now)).toBe(2 * 60_000);
  expect(previewUiBudget({ expiresAt: new Date(now + 11 * 60_000).toISOString() }, undefined, now)).toBe(30_000);
  expect(() => previewUiBudget(receipt, 'midnight-rollback', now)).toThrow('PREVIEW_UI_BUDGET_DENIED');
  expect(() => previewUiBudget({ expiresAt: 'invalid' }, undefined, now)).toThrow();
});

test.each([0, 7])('preserves normal child exit %s and existing evidence', async code => {
  const dir = mkdtempSync(join(tmpdir(), 'pr366-supervised-'));
  try {
    const child = join(dir, 'child.mjs');
    writeFileSync(child, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(dir, 'ui-results.json'))}, 'partial'); process.exit(${code});`);
    expect(await supervisePreviewUi({ script: child, args: [], outDir: dir, budgetMs: 5000, graceMs: 100 })).toBe(code);
    expect(readFileSync(join(dir, 'ui-results.json'), 'utf8')).toBe('partial');
    expect(JSON.parse(readFileSync(join(dir, 'ui-supervisor-main.json'), 'utf8')).status).toBe(code === 0 ? 'PASS' : 'FAIL');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function processRunning(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    }
    return true;
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return false;
    throw error;
  }
}

async function verifyStalledTree(detached = false, spawnOnTerm = false) {
  const dir = mkdtempSync(join(tmpdir(), 'pr366-supervised-'));
  let descendant;
  try {
    const child = join(dir, 'child.mjs');
    writeFileSync(child, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
      const create=()=>{const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'],{stdio:'ignore',detached:${detached}});
      writeFileSync(${JSON.stringify(join(dir, 'descendant.json'))},JSON.stringify(child.pid));};
      if(!${spawnOnTerm})create();
      writeFileSync(${JSON.stringify(join(dir, 'ui-results.json'))},'partial');
      process.on('SIGTERM',()=>{if(${spawnOnTerm})create();}); setInterval(()=>{},1000);`);
    const start = Date.now();
    expect(await supervisePreviewUi({ script: child, args: [], outDir: dir, budgetMs: 1500, graceMs: 2000 })).toBe(124);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(readFileSync(join(dir, 'ui-results.json'), 'utf8')).toBe('partial');
    descendant = JSON.parse(readFileSync(join(dir, 'descendant.json'), 'utf8'));
    await expect.poll(() => processRunning(descendant), { timeout: 3000 }).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'ui-supervisor-main.json'), 'utf8')).code).toBe('PREVIEW_UI_BUDGET_EXCEEDED');
  } finally {
    if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch { /* already stopped */ } }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('bounds a real stalled shutdown and kills its descendant without losing partial evidence', () => verifyStalledTree(), 10_000);
test.skipIf(process.platform !== 'linux')('Linux terminates an actual detached descendant group', () => verifyStalledTree(true), 10_000);
test.skipIf(process.platform !== 'linux')('Linux accumulates an actual detached group created by the TERM handler', () => verifyStalledTree(true, true), 10_000);

test('Linux ownership includes detached descendant groups and excludes unrelated or unowned groups', () => {
  const rows = [
    { pid: 100, parent: 1, group: 100, started: '10' },
    { pid: 101, parent: 100, group: 100, started: '11' },
    { pid: 102, parent: 101, group: 102, started: '12' },
    { pid: 200, parent: 1, group: 200, started: '20' },
  ];
  expect(selectLinuxOwnedTree(rows, 100).map(row => row.pid)).toEqual([100, 101, 102]);
  expect(() => selectLinuxOwnedTree(rows.map(row => row.pid === 102 ? { ...row, group: 200 } : row), 100)).toThrow('PREVIEW_UI_TERMINATION_UNCONFIRMED');
  expect(() => selectLinuxOwnedTree(rows, 999)).toThrow('PREVIEW_UI_TERMINATION_UNCONFIRMED');
});

test('Linux root fallback rejects replacement PID, changed group, missing and unknown starttime', () => {
  const original = { pid: 100, group: 100, started: '123' };
  expect(verifiedLinuxRoot(original, { ...original })).toBe(true);
  for (const fresh of [null, { ...original, pid: 101 }, { ...original, started: '124' }, { ...original, group: 200 }]) {
    expect(verifiedLinuxRoot(original, fresh)).toBe(false);
  }
  expect(verifiedLinuxRoot(null, original)).toBe(false);
  expect(verifiedLinuxRoot({ ...original, started: undefined }, { ...original, started: undefined })).toBe(false);
});

test.each(['nonzero', 'error', 'stalled'])('Windows tree termination %s cannot claim confirmed cleanup', async failure => {
  const dir = mkdtempSync(join(tmpdir(), 'pr366-supervised-'));
  try {
    const script = join(dir, 'child.mjs');
    writeFileSync(script, 'setInterval(()=>{},1000);');
    const spawnTreeKiller = () => failure === 'error'
      ? spawn('pr366-nonexistent-tree-killer', [], { stdio: 'ignore', shell: false })
      : spawn(process.execPath, ['-e', failure === 'stalled' ? 'setInterval(()=>{},1000)' : 'process.exit(1)'], { stdio: 'ignore' });
    expect(await supervisePreviewUi({ script, args: [], outDir: dir, budgetMs: 300, graceMs: 200,
      platform: 'win32', spawnTreeKiller })).toBe(124);
    expect(JSON.parse(readFileSync(join(dir, 'ui-supervisor-main.json'), 'utf8'))).toMatchObject({
      status: 'FAIL', code: 'PREVIEW_UI_TERMINATION_UNCONFIRMED', exitCode: 124,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
