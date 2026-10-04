import { pathToFileURL } from 'node:url';
import { createSession, beginAttempt, finishAttempt, syntheticScenario } from './preview-pair-reuse.mjs';
import { createMockProvider, verifyPair, cleanupPair } from './preview-pair-provider.mjs';
import { withSessionLock, readState, writeState } from './preview-pair-store.mjs';

export async function initialize(directory, scenario, now) {
  return withSessionLock(directory, async guard => {
    const session = createSession(scenario.approval, scenario.receipt, scenario.binding, scenario.monitor, now);
    const provider = createMockProvider(scenario.inventory);
    await verifyPair(session.lock, provider, guard);
    return writeState(directory, { session, inventory: provider.snapshot(), cleanupEvidence: [] }, null, guard);
  });
}
export async function attempt(directory, input, now) {
  return withSessionLock(directory, async guard => {
    let state = await readState(directory, guard);
    if (state.revision !== input.expectedRevision) throw Error('PREVIEW_STATE_CONFLICT');
    const session = beginAttempt(state.session, input.approval, input.receipt, input.binding, input.monitor, input.request, now);
    await verifyPair(session.lock, createMockProvider(state.inventory), guard);
    // Persist budget reservation and RUNNING before any attempt. Crash recovery
    // never replays uncertain work: RUNNING accepts independent cleanup only.
    state = await writeState(directory, { ...state, session }, state.revision, guard);
    state.session = finishAttempt(state.session, input.outcome, now);
    return writeState(directory, state, state.revision, guard);
  });
}
export async function cleanup(directory, { faults = {} } = {}, now) {
  return withSessionLock(directory, async guard => {
    let state = await readState(directory, guard);
    const provider = createMockProvider(state.inventory, faults);
    // No deadline, budget, or RUNNING gate: cleanup is independently available.
    state.session.status = 'RECOVERY_REQUIRED';
    state = await writeState(directory, state, state.revision, guard);
    await cleanupPair(state.session.lock, provider, guard, now, async (evidence, inventory) => {
      state.session.status = 'RECOVERY_REQUIRED';
      state = await writeState(directory, { ...state, inventory, cleanupEvidence: evidence }, state.revision, guard);
    });
    state.session.status = state.cleanupEvidence.every(row => row.absent) ? 'CLEANED' : 'RECOVERY_REQUIRED';
    state.session.lastAt = now;
    return writeState(directory, state, state.revision, guard);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] !== '--dry-run' || !['demo', 'cleanup'].includes(process.argv[3]) || process.argv.length !== 5)
      throw Error('PREVIEW_COORDINATOR_DRY_RUN_ONLY');
    const directory = process.argv[4], now = Date.parse('2026-10-04T00:00:00Z');
    let state;
    if (process.argv[3] === 'demo') {
      const scenario = syntheticScenario(now);
      state = await initialize(directory, scenario, now);
      for (const outcome of ['UI_TIMEOUT', 'PASS'])
        state = await attempt(directory, { ...scenario, request: { reserveMicros: 100, maxDurationMs: 1000 }, expectedRevision: state.revision, outcome }, now);
    }
    state = await cleanup(directory, {}, now + 86400000);
    console.log(JSON.stringify({ mode: 'SIMULATED', status: state.session.status, revision: state.revision,
      attempts: state.session.attempts.length, reservedMicros: state.session.reservedMicros, cleanup: state.cleanupEvidence }, null, 2));
  } catch (error) {
    const codes = ['PREVIEW_COORDINATOR_DRY_RUN_ONLY', 'PREVIEW_LOCK_BUSY', 'PREVIEW_LOCK_UNAVAILABLE', 'PREVIEW_LOCK_LOST',
      'PREVIEW_STATE_EXISTS', 'PREVIEW_STATE_MISSING', 'PREVIEW_STATE_INVALID', 'PREVIEW_STATE_CONFLICT'];
    console.error(codes.includes(error.message) ? error.message : 'PREVIEW_COORDINATOR_FAILED'); process.exitCode = 1;
  }
}
