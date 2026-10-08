import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ events: [], collision: false, writeFailure: false, spawnFailure: false, closeFailure: false }));
vi.mock('node:process', () => ({ loadEnvFile() {} }));
vi.mock('node:fs', () => ({
  existsSync: () => false,
  openSync: () => { state.events.push('reserve'); if (state.collision) throw Object.assign(Error('occupied'), { code: 'EEXIST' }); return 42; },
  writeFileSync: fd => { expect(fd).toBe(42); state.events.push('write'); if (state.writeFailure) throw Error('write failed'); },
  closeSync: fd => { expect(fd).toBe(42); state.events.push('close'); if (state.closeFailure) throw Error('close failed'); },
}));
vi.mock('node:child_process', () => ({ spawn: () => {
  state.events.push('spawn'); return { pid: state.spawnFailure ? undefined : 123,
    once(event, callback) {
      if (event === 'error' && state.spawnFailure) queueMicrotask(() => callback(Error('spawn failed')));
      if (event === 'spawn' && !state.spawnFailure) queueMicrotask(callback);
    }, kill: () => state.events.push('kill') };
} }));
vi.mock('node:net', () => ({ createServer: () => ({ once() {}, listen(_port, _host, callback) { callback(); }, close(callback) { callback(); } }) }));
vi.mock('../../docs/awesome-optimization/qa/live-fixture-guard.mjs', () => ({
  openGuardedDatabase: async () => ({ $disconnect: async () => {} }),
  verifyLiveFixture: async () => ({ receipt: { syntheticLocalOnly: true } }),
}));
vi.mock('../responsive-build-provenance.mjs', () => ({ readResponsiveBuildProvenance: () => ({ sourceAfter: { sourceSha256: 'synthetic' } }) }));

const originalArgs = [...process.argv];
const originalExpected = process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256;
const originalSignals = process.listeners('SIGINT');
const originalExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = originalExitCode;
  state.spawnFailure = false; state.closeFailure = false;
  process.argv = originalArgs;
  if (originalExpected === undefined) delete process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256;
  else process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256 = originalExpected;
  for (const listener of process.listeners('SIGINT')) if (!originalSignals.includes(listener)) process.removeListener('SIGINT', listener);
});

for (const batch of ['batch-3', 'batch-4a']) {
  const run = async () => {
    vi.resetModules(); process.argv = [process.execPath, 'runtime.mjs', 'reservation-test'];
    process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256 = 'synthetic';
    await import(`./${batch}/runtime.mjs`);
  };
  test(`${batch}: a concurrent receipt winner prevents service startup`, async () => {
    Object.assign(state, { events: [], collision: true, writeFailure: false });
    await expect(run()).rejects.toMatchObject({ code: 'EEXIST' });
    expect(state.events).toEqual(['reserve']);
  });
  test(`${batch}: startup occurs after reservation and failed evidence kills its child`, async () => {
    Object.assign(state, { events: [], collision: false, writeFailure: true });
    await expect(run()).rejects.toThrow('write failed');
    expect(state.events).toEqual(['reserve', 'spawn', 'write', 'close', 'kill']);
  });
  test(`${batch}: asynchronous startup errors never write a false ownership receipt`, async () => {
    Object.assign(state, { events: [], collision: false, writeFailure: false, spawnFailure: true });
    await expect(run()).rejects.toThrow('spawn failed');
    expect(state.events).toEqual(['reserve', 'spawn', 'close', 'kill']);
  });
  test(`${batch}: descriptor close failure also stops the owned child`, async () => {
    Object.assign(state, { events: [], collision: false, writeFailure: false, closeFailure: true });
    await expect(run()).rejects.toThrow('close failed');
    expect(state.events).toEqual(['reserve', 'spawn', 'write', 'close', 'kill']);
  });
  test(`${batch}: close failure preserves the original evidence failure`, async () => {
    Object.assign(state, { events: [], collision: false, writeFailure: true, closeFailure: true });
    await expect(run()).rejects.toMatchObject({ message: 'write failed', receiptCloseFailed: true });
    expect(state.events).toEqual(['reserve', 'spawn', 'write', 'close', 'kill']);
  });
  test(`${batch}: successful evidence uses and closes the reserved descriptor`, async () => {
    Object.assign(state, { events: [], collision: false, writeFailure: false });
    await run();
    expect(state.events).toEqual(['reserve', 'spawn', 'write', 'close']);
  });
}
