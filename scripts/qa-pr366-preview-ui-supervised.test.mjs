import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { expect, test } from 'vitest';
import { previewUiBudget, supervisePreviewUi } from './qa-pr366-preview-ui-supervised.mjs';

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

test('bounds a real stalled shutdown and kills its descendant without losing partial evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr366-supervised-'));
  let descendant;
  try {
    const child = join(dir, 'child.mjs');
    writeFileSync(child, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs';
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      writeFileSync(${JSON.stringify(join(dir, 'descendant.json'))},JSON.stringify(child.pid));
      writeFileSync(${JSON.stringify(join(dir, 'ui-results.json'))},'partial');
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
    const start = Date.now();
    expect(await supervisePreviewUi({ script: child, args: [], outDir: dir, budgetMs: 1500, graceMs: 2000 })).toBe(124);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(readFileSync(join(dir, 'ui-results.json'), 'utf8')).toBe('partial');
    descendant = JSON.parse(readFileSync(join(dir, 'descendant.json'), 'utf8'));
    await expect.poll(() => { try { process.kill(descendant, 0); return true; } catch { return false; } }, { timeout: 3000 }).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'ui-supervisor-main.json'), 'utf8')).code).toBe('PREVIEW_UI_BUDGET_EXCEEDED');
  } finally {
    if (descendant) { try { process.kill(descendant, 'SIGKILL'); } catch { /* already stopped */ } }
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);

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
