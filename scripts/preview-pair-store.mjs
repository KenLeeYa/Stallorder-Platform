import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = () => { throw Error('PREVIEW_STATE_INVALID'); };

export async function withSessionLock(directory, action) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw Error('PREVIEW_LOCK_PATH_INVALID');
  const root = await realpath(directory), signal = new AbortController();
  const windows = process.platform === 'win32';
  const child = spawn(windows ? 'powershell.exe' : 'python3',
    windows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        fileURLToPath(new URL('./preview-pair-lock.ps1', import.meta.url)), join(root, 'session.lock')]
      : [fileURLToPath(new URL('./preview-pair-lock.py', import.meta.url)), join(root, 'session.lock')],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
      env: Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'PATHEXT'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) });
  // The helper never receives inherited provider credentials.
  let held = false, released = false;
  child.stdin.on('error', () => {});
  const exited = new Promise(resolve => {
    child.once('error', () => { signal.abort(); resolve(1); });
    child.once('exit', code => { held = false; signal.abort(); resolve(code); });
  });
  let timer;
  const acquired = new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', data => { text += data; if (text === 'LOCKED\n' || text === 'LOCKED\r\n') { held = true; clearTimeout(timer); resolve(); } });
    exited.then(code => { clearTimeout(timer); reject(Error(code === 75 ? 'PREVIEW_LOCK_BUSY' : 'PREVIEW_LOCK_UNAVAILABLE')); });
    timer = setTimeout(() => { child.kill(); reject(Error('PREVIEW_LOCK_UNAVAILABLE')); }, 5000);
  });
  const guard = { root, signal: signal.signal, assertHeld() {
    if (!held || released || child.exitCode !== null || child.signalCode !== null || signal.signal.aborted) throw Error('PREVIEW_LOCK_LOST');
  } };
  try {
    await acquired;
    const value = await action(guard);
    guard.assertHeld(); return value;
  } finally {
    released = true; clearTimeout(timer); child.stdin.end();
    await exited;
  }
}
async function pathFor(directory, guard) {
  guard.assertHeld();
  if (await realpath(directory) !== guard.root) throw Error('PREVIEW_LOCK_PATH_INVALID');
  return join(guard.root, 'state.json');
}
function validate(state) {
  if (!state || state.schema !== 1 || state.mode !== 'SIMULATED' || !Number.isSafeInteger(state.revision) || state.revision < 0) invalid();
  const { checksum, ...body } = state;
  if (checksum !== hash(body)) invalid();
  const session = state.session;
  if (session?.mode !== 'SIMULATED' || !Array.isArray(session.attempts) || !session.lock
    || !['READY', 'RUNNING', 'RETRYABLE', 'COMPLETE', 'RECOVERY_REQUIRED', 'CLEANED'].includes(session.status)) invalid();
  let total = session.lock.initialReserveMicros + session.lock.cleanupReserveMicros;
  if (!Number.isSafeInteger(total) || total <= 0) invalid();
  session.attempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1 || !Number.isSafeInteger(attempt.reserveMicros) || attempt.reserveMicros <= 0
      || !Number.isFinite(attempt.startedAt) || !Number.isFinite(attempt.deadline) || attempt.startedAt >= attempt.deadline
      || !['RUNNING', 'PASS', 'UI_TIMEOUT', 'UI_ASSERTION', 'UNRECOVERABLE'].includes(attempt.outcome)
      || (attempt.outcome !== 'RUNNING' && !(Number.isFinite(attempt.finishedAt) && attempt.finishedAt >= attempt.startedAt))) invalid();
    total += attempt.reserveMicros;
  });
  if (session.reservedMicros !== total || !Number.isSafeInteger(total) || total > session.lock.budgetMicros) invalid();
  if (!state.inventory || !Array.isArray(state.cleanupEvidence)) invalid();
  return state;
}
export async function readState(directory, guard) {
  const path = await pathFor(directory, guard);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) invalid();
    const state = validate(JSON.parse(await readFile(path, 'utf8')));
    guard.assertHeld(); return state;
  } catch (error) {
    if (error.code === 'ENOENT') throw Error('PREVIEW_STATE_MISSING');
    if (error.message === 'PREVIEW_LOCK_LOST') throw error;
    invalid();
  }
}
export async function writeState(directory, state, expectedRevision, guard) {
  const path = await pathFor(directory, guard);
  let current;
  try { current = await readState(directory, guard); }
  catch (error) { if (error.message !== 'PREVIEW_STATE_MISSING') throw error; }
  if (expectedRevision === null ? current !== undefined : current?.revision !== expectedRevision)
    throw Error(expectedRevision === null ? 'PREVIEW_STATE_EXISTS' : 'PREVIEW_STATE_CONFLICT');
  if (current && (!isDeepStrictEqual(current.session.lock, state.session.lock)
    || state.session.reservedMicros < current.session.reservedMicros
    || state.session.attempts.length < current.session.attempts.length)) throw Error('PREVIEW_STATE_IDENTITY_CHANGED');
  if (current) {
    for (const [index, previous] of current.session.attempts.entries()) {
      const next = state.session.attempts[index];
      if (['number', 'startedAt', 'deadline', 'reserveMicros'].some(key => next[key] !== previous[key])
        || (previous.outcome !== 'RUNNING' && !isDeepStrictEqual(previous, next))) throw Error('PREVIEW_STATE_HISTORY_CHANGED');
    }
  }
  const body = { schema: 1, mode: 'SIMULATED', revision: expectedRevision === null ? 0 : expectedRevision + 1,
    session: structuredClone(state.session), inventory: structuredClone(state.inventory), cleanupEvidence: structuredClone(state.cleanupEvidence) };
  const next = validate({ ...body, checksum: hash(body) });
  const temporary = join(guard.root, `state-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(next, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    guard.assertHeld(); await rename(temporary, path);
    if (process.platform !== 'win32') {
      const directoryHandle = await open(guard.root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
    guard.assertHeld(); return next;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw Error(error.message === 'PREVIEW_LOCK_LOST' ? error.message : 'PREVIEW_STATE_WRITE_FAILED');
  }
}
