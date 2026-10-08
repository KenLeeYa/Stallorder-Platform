import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GRACE_MS = 30_000;
const PHASES = ['prepare-cash-shift', 'hours-open', 'hours-closed', 'hours-overnight', 'hours-cutoff', 'hours-preorder'];

export function previewUiBudget(receipt, phase, now = Date.now()) {
  if (phase !== undefined && !PHASES.includes(phase)) throw Error('PREVIEW_UI_BUDGET_DENIED');
  const budget = Math.min(phase ? 2 * 60_000 : 12 * 60_000, Date.parse(receipt.expiresAt) - now - 10 * 60_000 - GRACE_MS);
  if (!Number.isFinite(budget) || budget <= 0) throw Error('PREVIEW_UI_BUDGET_DENIED');
  return budget;
}

// Runtime injection is only for local regression tests; the CLI has fixed budgets.
export async function supervisePreviewUi({ script, args, outDir, phase, budgetMs, graceMs = GRACE_MS,
  platform = process.platform, spawnTreeKiller = pid => spawn('taskkill', ['/PID', String(pid), '/T', '/F'],
    { stdio: 'ignore', shell: false, windowsHide: true }) }) {
  mkdirSync(outDir, { recursive: true });
  const receiptPath = resolve(outDir, `ui-supervisor-${phase ?? 'main'}.json`);
  const persist = (status, code, exitCode) => writeFileSync(receiptPath, JSON.stringify({
    phase: phase ?? 'main', status, code, exitCode, budgetMs,
  }, null, 2));
  persist('RUNNING', 'PREVIEW_UI_RUNNING', null);
  const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit', shell: false,
    windowsHide: true, detached: process.platform !== 'win32' });
  return await new Promise(resolveExit => {
    let expired = false;
    let finished = false;
    let escalation;
    const finish = (code, terminationUnconfirmed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      const exitCode = expired ? 124 : code;
      persist(exitCode === 0 ? 'PASS' : 'FAIL', terminationUnconfirmed ? 'PREVIEW_UI_TERMINATION_UNCONFIRMED'
        : expired ? 'PREVIEW_UI_BUDGET_EXCEEDED' : 'PREVIEW_UI_EXIT', exitCode);
      resolveExit(exitCode);
    };
    const killGroup = signal => { try { process.kill(-child.pid, signal); } catch { /* exited owned group */ } };
    const deadline = setTimeout(() => {
      expired = true;
      persist('FAIL', 'PREVIEW_UI_BUDGET_EXCEEDED', 124);
      if (platform === 'win32') {
        // Kill the exact owned tree while its root still exists; no shell or argument interpolation.
        const killer = spawnTreeKiller(child.pid);
        killer.on('error', () => { child.kill('SIGKILL'); finish(124, true); });
        killer.on('exit', code => {
          if (code !== 0) child.kill('SIGKILL');
          finish(124, code !== 0);
        });
        escalation = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); finish(124, true); }, graceMs);
      } else {
        killGroup('SIGTERM');
        escalation = setTimeout(() => { killGroup('SIGKILL'); finish(124); }, graceMs);
      }
    }, budgetMs);
    child.on('error', () => finish(1));
    child.on('exit', code => {
      if (expired && platform === 'win32') return; // Await tree termination, not only root exit.
      if (expired && platform !== 'win32') {
        // A root can exit on TERM before its browser descendants; still stop the owned group.
        killGroup('SIGKILL');
      }
      finish(Number.isInteger(code) ? code : 1);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 3 || args.length > 4) throw Error('PREVIEW_UI_BUDGET_DENIED');
    const phase = args[3];
    const budgetMs = previewUiBudget(JSON.parse(readFileSync(args[0], 'utf8')), phase);
    process.exitCode = await supervisePreviewUi({ script: fileURLToPath(new URL('./qa-pr366-preview-ui.mjs', import.meta.url)),
      args, outDir: args[2], phase, budgetMs });
  } catch { console.error('PREVIEW_UI_SUPERVISION_FAILED'); process.exitCode = 1; }
}
