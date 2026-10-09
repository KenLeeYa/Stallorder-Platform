import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GRACE_MS = 30_000;
const PHASES = ['prepare-cash-shift', 'hours-open', 'hours-closed', 'hours-overnight', 'hours-cutoff', 'hours-preorder'];

function linuxProcess(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid: Number(pid), state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), started: fields[19] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}

export function selectLinuxOwnedTree(rows, pid) {
  const owned = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
  }
  const tree = rows.filter(row => owned.has(row.pid));
  if (!tree.some(row => row.pid === pid) || tree.some(row => row.group !== pid && !owned.has(row.group))) {
    throw Error('PREVIEW_UI_TERMINATION_UNCONFIRMED');
  }
  return tree;
}

function captureLinuxTree(pid) {
  return selectLinuxOwnedTree(readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(linuxProcess).filter(Boolean), pid);
}

export function verifiedLinuxRoot(baseline, fresh) {
  return Boolean(baseline && fresh && baseline.started && baseline.pid === fresh.pid
    && baseline.started === fresh.started && baseline.group === baseline.pid && fresh.group === baseline.pid);
}

function rescanLinuxTree(tree) {
  const rows = readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(linuxProcess).filter(Boolean);
  const live = tree.filter(old => rows.some(row => row.pid === old.pid && row.started === old.started && row.state !== 'Z'));
  // An exited ancestor may have spawned an orphan detached group before exit; do not certify that gap.
  let confirmed = live.length === tree.length;
  const owned = new Set(live.map(row => row.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; }
  }
  const additions = rows.filter(row => owned.has(row.pid) && !tree.some(old => old.pid === row.pid && old.started === row.started));
  const combined = [...tree, ...additions];
  if (additions.some(row => !combined.some(member => member.pid === row.group))) confirmed = false;
  return { tree: combined, confirmed };
}

function signalLinuxTree(tree, signal) {
  let confirmed = true;
  for (const group of new Set(tree.map(row => row.group))) {
    if (!tree.some(row => row.pid === group)) { confirmed = false; continue; }
    const current = tree.filter(row => row.group === group).map(row => ({ old: row, fresh: linuxProcess(row.pid) }));
    const live = current.filter(({ old, fresh }) => fresh && fresh.started === old.started && fresh.state !== 'Z');
    if (!live.length) continue;
    if (live.some(({ fresh }) => fresh.group !== group)) { confirmed = false; continue; }
    try { process.kill(-group, signal); } catch (error) { if (error.code !== 'ESRCH') confirmed = false; }
  }
  return confirmed;
}

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
  let linuxRoot;
  if (platform === 'linux') { try { linuxRoot = linuxProcess(child.pid); } catch { /* timeout fails closed */ } }
  return await new Promise(resolveExit => {
    let expired = false;
    let finished = false;
    let escalation;
    let linuxTree;
    let rescan;
    const finish = (code, terminationUnconfirmed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearInterval(rescan);
      const exitCode = expired ? 124 : code;
      if (expired && platform === 'linux') child.unref(); // Unknown identities must not prevent bounded supervisor exit.
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
        let confirmed = true;
        if (platform === 'linux') {
          try {
            const candidate = captureLinuxTree(child.pid);
            if (!verifiedLinuxRoot(linuxRoot, candidate.find(row => row.pid === child.pid))) throw Error('PREVIEW_UI_TERMINATION_UNCONFIRMED');
            linuxTree = candidate;
            confirmed = signalLinuxTree(linuxTree, 'SIGTERM');
            rescan = setInterval(() => {
              try { const fresh = rescanLinuxTree(linuxTree); linuxTree = fresh.tree; confirmed = fresh.confirmed && confirmed; }
              catch { confirmed = false; }
            }, 100);
          }
          catch {
            linuxTree = undefined;
            confirmed = false;
            try { if (verifiedLinuxRoot(linuxRoot, linuxProcess(child.pid))) signalLinuxTree([linuxRoot], 'SIGTERM'); }
            catch { /* Unknown root identity: no signal. */ }
          }
        } else { killGroup('SIGTERM'); }
        escalation = setTimeout(() => {
          clearInterval(rescan);
          if (linuxTree) {
            try {
              // Freeze confirmed parents before the final census so their TERM handlers cannot create another group during KILL.
              let settled = false;
              for (let pass = 0; pass < 3; pass++) {
                confirmed = signalLinuxTree(linuxTree, 'SIGSTOP') && confirmed;
                const count = linuxTree.length;
                const fresh = rescanLinuxTree(linuxTree); linuxTree = fresh.tree; confirmed = fresh.confirmed && confirmed;
                if (linuxTree.length === count) { settled = true; break; }
              }
              const killed = signalLinuxTree(linuxTree, 'SIGKILL');
              confirmed = settled && killed && confirmed;
            }
            catch { confirmed = false; try { signalLinuxTree(linuxTree, 'SIGKILL'); } catch { /* unconfirmed receipt */ } }
          } else if (platform === 'linux') {
            try { if (verifiedLinuxRoot(linuxRoot, linuxProcess(child.pid))) signalLinuxTree([linuxRoot], 'SIGKILL'); }
            catch { /* Unknown root identity: no signal. */ }
          } else { killGroup('SIGKILL'); }
          // SIGKILL delivery is bounded; verify captured identities stop before claiming termination.
          setTimeout(() => {
            if (linuxTree) {
              try { confirmed = !linuxTree.some(row => { const fresh = linuxProcess(row.pid);
                return fresh && fresh.started === row.started && fresh.state !== 'Z'; }) && confirmed; }
              catch { confirmed = false; }
            }
            finish(124, !confirmed);
          }, 100);
        }, Math.max(0, graceMs - 100));
      }
    }, budgetMs);
    child.on('error', () => finish(1));
    child.on('exit', code => {
      if (expired && platform === 'win32') return; // Await tree termination, not only root exit.
      if (expired && platform === 'linux') return; // Detached browser groups must also finish termination.
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
