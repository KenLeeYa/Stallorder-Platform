import { isDeepStrictEqual } from 'node:util';
import { resourceIdentity } from './preview-pair-reuse.mjs';

// Contract: read(kind, exactIdentity, signal) returns null only for confirmed
// absence; remove(kind, exactIdentity, signal) never proves absence by itself.
// No create/list/redeploy/credential method exists. Only this built-in mock is
// accepted; arbitrary callbacks labelled SIMULATED cannot become live adapters.
const mocks = new WeakSet();
export function createMockProvider(inventory, faults = {}) {
  const resources = structuredClone(inventory), journal = [];
  const check = signal => { if (signal.aborted) throw Error('PREVIEW_LOCK_LOST'); };
  const provider = Object.freeze({
    async read(kind, identity, signal) {
      check(signal);
      journal.push({ operation: 'GET', kind, id: kind === 'child' ? identity.childRef : identity.deploymentId });
      if (faults[kind] === 'read-fails') throw Error('private simulated provider error');
      return structuredClone(resources[kind]);
    },
    async remove(kind, identity, signal) {
      check(signal);
      if (!isDeepStrictEqual(resources[kind], identity)) throw Error('PREVIEW_ADAPTER_IDENTITY_DRIFT');
      journal.push({ operation: 'DELETE', kind, id: kind === 'child' ? identity.childRef : identity.deploymentId });
      if (faults[kind] === 'delete-fails') throw Error('private simulated provider error');
      if (faults[kind] !== 'delete-remains') resources[kind] = null;
    },
    snapshot: () => structuredClone(resources),
    events: () => structuredClone(journal),
  });
  mocks.add(provider); return provider;
}
function assertMock(provider) {
  if (!mocks.has(provider)) throw Error('PREVIEW_ADAPTER_DRY_RUN_ONLY');
}
export async function verifyPair(lock, provider, guard) {
  assertMock(provider);
  for (const kind of ['deployment', 'child']) {
    guard.assertHeld();
    let row;
    try { row = await provider.read(kind, resourceIdentity(lock, kind), guard.signal); }
    catch { throw Error('PREVIEW_ADAPTER_READ_FAILED'); }
    guard.assertHeld();
    if (!isDeepStrictEqual(row, resourceIdentity(lock, kind))) throw Error('PREVIEW_ADAPTER_IDENTITY_DRIFT');
  }
}
export async function cleanupPair(lock, provider, guard, now, saveEvidence) {
  assertMock(provider);
  const evidence = [];
  for (const kind of ['deployment', 'child']) {
    guard.assertHeld();
    const expected = resourceIdentity(lock, kind);
    const row = { mode: 'SIMULATED', kind, id: kind === 'child' ? lock.childRef : lock.deploymentId,
      checkedAt: now, absent: false, code: 'PROVIDER_OPERATION_FAILED' };
    try {
      const before = await provider.read(kind, expected, guard.signal);
      guard.assertHeld();
      if (before !== null && !isDeepStrictEqual(before, expected)) row.code = 'IDENTITY_DRIFT';
      else {
        if (before !== null) await provider.remove(kind, expected, guard.signal);
        guard.assertHeld();
        row.absent = await provider.read(kind, expected, guard.signal) === null;
        row.code = row.absent ? 'ABSENCE_VERIFIED' : 'CLEANUP_READBACK_FAILED';
      }
    } catch { /* Persist only the allowlisted code; continue independent cleanup. */ }
    guard.assertHeld(); evidence.push(row);
    // Durable receipt after EACH resource, including partial failure.
    await saveEvidence(structuredClone(evidence), provider.snapshot());
  }
  return evidence;
}
