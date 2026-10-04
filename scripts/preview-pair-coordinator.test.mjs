import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syntheticScenario } from './preview-pair-reuse.mjs';
import { createMockProvider, verifyPair, cleanupPair } from './preview-pair-provider.mjs';
import { withSessionLock, readState, writeState } from './preview-pair-store.mjs';
import { initialize, attempt, cleanup } from './preview-pair-coordinator.mjs';

const now = Date.parse('2026-10-04T00:00:00Z');
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'preview-pair-test-')); roots.push(root); return root; }
const guard = { assertHeld() {}, signal: new AbortController().signal };
const request = { reserveMicros: 100, maxDurationMs: 1000 };

test('provider contract verifies exact scoped identities before DELETE and checks both resources afterwards', async () => {
  const scenario = syntheticScenario(now), root = await directory();
  const state = await initialize(root, scenario, now);
  const provider = createMockProvider(scenario.inventory);
  await verifyPair(state.session.lock, provider, guard, now);
  const evidence = await cleanupPair(state.session.lock, provider, guard, now, async () => {});
  expect(evidence.every(row => row.absent)).toBe(true);
  expect(provider.events().filter(event => event.operation === 'DELETE').map(event => event.kind)).toEqual(['deployment', 'child']);
  expect(provider.snapshot()).toEqual({ deployment: null, child: null });
});
test('only built-in mock adapters can enter the coordinator; mode labels do not authorize live calls', async () => {
  const root = await directory(), scenario = syntheticScenario(now), state = await initialize(root, scenario, now);
  let touched = false;
  await expect(verifyPair(state.session.lock, { mode: 'SIMULATED', read() { touched = true; } }, guard, now)).rejects.toThrow('PREVIEW_ADAPTER_DRY_RUN_ONLY');
  expect(touched).toBe(false);
});
test('adapter mismatch, read failure and successful DELETE without absence cannot claim cleanup', async () => {
  const root = await directory(), scenario = syntheticScenario(now), state = await initialize(root, scenario, now);
  const wrong = createMockProvider({ ...scenario.inventory, child: { ...scenario.inventory.child, childRef: scenario.receipt.parent } });
  const rows = await cleanupPair(state.session.lock, wrong, guard, now, async () => {});
  expect(rows.find(row => row.kind === 'child').code).toBe('IDENTITY_DRIFT');
  expect(wrong.events().some(row => row.operation === 'DELETE' && row.kind === 'child')).toBe(false);
  const stuck = createMockProvider(scenario.inventory, { deployment: 'delete-remains', child: 'read-fails' });
  const failures = await cleanupPair(state.session.lock, stuck, guard, now, async () => {});
  expect(failures.every(row => !row.absent)).toBe(true);
  expect(JSON.stringify(failures)).not.toContain('private');
});
test('persisted retry preserves original identity, deadline, reservations and increasing revision', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  const initial = await initialize(root, scenario, now);
  const first = await attempt(root, { ...scenario, request, expectedRevision: initial.revision, outcome: 'UI_TIMEOUT' }, now);
  expect(first.session.status).toBe('RETRYABLE');
  expect(first.revision).toBe(2);
  const second = await attempt(root, { ...scenario, request, expectedRevision: first.revision, outcome: 'PASS' }, now + 100);
  expect(second.session.reservedMicros).toBe(500);
  expect(second.session.lock).toEqual(initial.session.lock);
  expect(second.revision).toBe(4);
  const saved = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
  expect(saved).toEqual(second);
});
test('stale CAS, duplicate initialization and budget tampering fail closed', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  await expect(initialize(root, scenario, now)).rejects.toThrow('PREVIEW_STATE_EXISTS');
  await expect(attempt(root, { ...scenario, request, expectedRevision: 99, outcome: 'PASS' }, now)).rejects.toThrow('PREVIEW_STATE_CONFLICT');
  const path = join(root, 'state.json'), saved = JSON.parse(await readFile(path, 'utf8'));
  saved.session.reservedMicros = 0;
  await writeFile(path, JSON.stringify(saved));
  await expect(attempt(root, { ...scenario, request, expectedRevision: 0, outcome: 'PASS' }, now)).rejects.toThrow('PREVIEW_STATE_INVALID');
});
test('partial cleanup persists each absence and independent retry works after expiry', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  const partial = await cleanup(root, { faults: { deployment: 'delete-fails' } }, now + 86400000);
  expect(partial.session.status).toBe('RECOVERY_REQUIRED');
  expect(partial.inventory.child).toBeNull();
  expect(partial.cleanupEvidence.find(row => row.kind === 'child').absent).toBe(true);
  const result = await cleanup(root, {}, now + 86400001);
  expect(result.session.status).toBe('CLEANED');
  expect(result.inventory).toEqual({ deployment: null, child: null });
  expect((await cleanup(root, {}, now + 86400002)).session.status).toBe('CLEANED');
});
test('corrupt state fails without logging content or replacing it', async () => {
  const root = await directory();
  await writeFile(join(root, 'state.json'), 'private invalid JSON');
  await expect(cleanup(root, {}, now)).rejects.toThrow('PREVIEW_STATE_INVALID');
  expect(await readFile(join(root, 'state.json'), 'utf8')).toBe('private invalid JSON');
});

function worker(root, body) {
  const script = `import { withSessionLock, readState, writeState } from ${JSON.stringify(new URL('./preview-pair-store.mjs', import.meta.url).href)};
    await withSessionLock(process.argv[1], async guard => { ${body}; console.log('LOCK_HELD'); await new Promise(resolve => process.stdin.once('data', resolve)); });`;
  return spawn(process.execPath, ['--input-type=module', '-e', script, root], { stdio: ['pipe', 'pipe', 'pipe'] });
}
async function ready(child) {
  let text = '';
  for await (const chunk of child.stdout) { text += chunk; if (text.includes('LOCK_HELD')) return; }
  throw Error('WORKER_EXITED_BEFORE_LOCK');
}
test('real processes contend for one stable OS lock; release does not unlink its inode', async () => {
  const root = await directory(), child = worker(root, '');
  try {
    await ready(child);
    const before = await stat(join(root, 'session.lock'));
    await expect(withSessionLock(root, async () => {})).rejects.toThrow('PREVIEW_LOCK_BUSY');
    const exited = once(child, 'exit'); child.stdin.end('release'); await exited;
    await withSessionLock(root, async lock => lock.assertHeld());
    expect((await stat(join(root, 'session.lock'))).ino).toBe(before.ino);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
test('SIGKILL releases OS lock, but durable RUNNING and budget survive; cleanup does not rerun UI', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  const policy = new URL('./preview-pair-reuse.mjs', import.meta.url).href;
  const body = `const { beginAttempt } = await import(${JSON.stringify(policy)});
    const state = await readState(process.argv[1], guard);
    state.session = beginAttempt(state.session, ${JSON.stringify(scenario.approval)}, ${JSON.stringify(scenario.receipt)}, ${JSON.stringify(scenario.binding)}, ${JSON.stringify(scenario.monitor)}, ${JSON.stringify(request)}, ${now});
    await writeState(process.argv[1], state, state.revision, guard);`;
  const child = worker(root, body);
  try {
    await ready(child);
    const died = once(child, 'exit'); child.kill('SIGKILL'); await died;
    // The OS closes the helper's stdin after its owner dies. Bound this handoff.
    let acquired = false;
    for (let i = 0; i < 50 && !acquired; i++) {
      try { await withSessionLock(root, async () => {}); acquired = true; }
      catch (error) { if (error.message !== 'PREVIEW_LOCK_BUSY') throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    expect(acquired).toBe(true);
    const stored = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
    expect(stored.session.status).toBe('RUNNING'); expect(stored.session.reservedMicros).toBe(400);
    await expect(attempt(root, { ...scenario, request, expectedRevision: stored.revision, outcome: 'PASS' }, now)).rejects.toThrow('PREVIEW_REUSE_DENIED');
    expect((await cleanup(root, {}, now + 86400000)).session.status).toBe('CLEANED');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('two real coordinators with the same revision cannot both reserve an attempt', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  const code = `import { attempt } from ${JSON.stringify(new URL('./preview-pair-coordinator.mjs', import.meta.url).href)};
    try { await attempt(process.argv[1], ${JSON.stringify({ ...scenario, request, expectedRevision: 0, outcome: 'UI_TIMEOUT' })}, ${now}); console.log('SUCCESS'); }
    catch (error) { console.log(error.message); }`;
  async function run() {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; for await (const chunk of child.stdout) output += chunk;
    return output.trim();
  }
  const results = await Promise.all([run(), run()]);
  expect(results.filter(row => row === 'SUCCESS')).toHaveLength(1);
  expect(results.find(row => row !== 'SUCCESS')).toMatch(/^PREVIEW_(?:LOCK_BUSY|STATE_CONFLICT)$/);
  const state = await withSessionLock(root, guard => readState(root, guard));
  expect(state.revision).toBe(2); expect(state.session.attempts).toHaveLength(1);
  expect(state.session.reservedMicros).toBe(400);
});
test('persistence cannot change the approval lock or roll back reservations', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  await withSessionLock(root, async guard => {
    const state = await readState(root, guard);
    state.session.lock.expiresAt = '2099-01-01T00:00:00Z';
    await expect(writeState(root, state, state.revision, guard)).rejects.toThrow('PREVIEW_STATE_IDENTITY_CHANGED');
  });
});
test('aborted lock authority prevents all provider operations', async () => {
  const root = await directory(), scenario = syntheticScenario(now), state = await initialize(root, scenario, now);
  const provider = createMockProvider(scenario.inventory), controller = new AbortController(); controller.abort();
  const lost = { signal: controller.signal, assertHeld() { throw Error('PREVIEW_LOCK_LOST'); } };
  await expect(cleanupPair(state.session.lock, provider, lost, now, async () => {})).rejects.toThrow('PREVIEW_LOCK_LOST');
  expect(provider.events()).toEqual([]);
});

test('completed attempt history cannot be relabelled or have its charged reserve rewritten', async () => {
  const root = await directory(), scenario = syntheticScenario(now);
  await initialize(root, scenario, now);
  await attempt(root, { ...scenario, request, expectedRevision: 0, outcome: 'UI_TIMEOUT' }, now);
  await withSessionLock(root, async guard => {
    const state = await readState(root, guard);
    state.session.attempts[0].outcome = 'PASS';
    await expect(writeState(root, state, state.revision, guard)).rejects.toThrow('PREVIEW_STATE_HISTORY_CHANGED');
  });
});
