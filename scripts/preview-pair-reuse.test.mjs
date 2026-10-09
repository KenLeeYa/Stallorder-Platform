import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, beginAttempt, finishAttempt, forceCleanup, syntheticScenario } from './preview-pair-reuse.mjs';

const now = Date.parse('2026-10-04T00:00:00Z');
function setup() { return syntheticScenario(now); }
test('retry reuses exact pair and original deadline without resetting total reserved cost', () => {
  const { approval, receipt, binding, monitor } = setup();
  let session = createSession(approval, receipt, binding, monitor, now);
  session = beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now);
  session = finishAttempt(session, 'UI_TIMEOUT', now + 100);
  expect(session.status).toBe('RETRYABLE');
  session = beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now + 200);
  session = finishAttempt(session, 'PASS', now + 300);
  expect(session.attempts.map(a => a.number)).toEqual([1, 2]);
  expect(session.reservedMicros).toBe(approval.initialReserveMicros + approval.cleanupReserveMicros + 200);
  expect(session.lock.expiresAt).toBe(approval.expiresAt);
  expect(session.lock.deploymentId).toBe(binding.deploymentId);
  expect(session.status).toBe('COMPLETE');
});
test.each(['childRef', 'deploymentId', 'sha', 'tree', 'origin'])('reuse denies changed %s', key => {
  const { approval, receipt, binding, monitor } = setup();
  const session = createSession(approval, receipt, binding, monitor, now);
  expect(() => beginAttempt(session, approval, receipt, { ...binding, [key]: 'changed' }, monitor, { reserveMicros: 1, maxDurationMs: 1000 }, now)).toThrow();
});
test.each(['expiresAt', 'budgetMicros', 'approvalId'])('approval cannot extend or replace %s', key => {
  const { approval, receipt, binding, monitor } = setup();
  const session = createSession(approval, receipt, binding, monitor, now);
  expect(() => beginAttempt(session, { ...approval, [key]: key === 'budgetMicros' ? 999999 : 'changed' }, receipt, binding, monitor, { reserveMicros: 1, maxDurationMs: 1000 }, now)).toThrow();
});
test('missing budget, stale readback, stopped watchdog and expired session reject before attempting', () => {
  const { approval, receipt, binding, monitor } = setup();
  expect(() => createSession({ ...approval, budgetMicros: undefined }, receipt, binding, monitor, now)).toThrow();
  expect(() => createSession(approval, receipt, binding, { ...monitor, active: false }, now)).toThrow();
  const session = createSession(approval, receipt, binding, monitor, now);
  for (const instant of [now + 16 * 60000, Date.parse(approval.expiresAt)])
    expect(() => beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 1, maxDurationMs: 1000 }, instant)).toThrow();
});
test('total budget includes cleanup and failed attempts; cannot overlap or undercount unknown costs', () => {
  const { approval, receipt, binding, monitor } = setup();
  let session = createSession(approval, receipt, binding, monitor, now);
  for (const cost of [NaN, -1, 0, Infinity, 0.5, approval.budgetMicros])
    expect(() => beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: cost, maxDurationMs: 1000 }, now)).toThrow();
  session = beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now);
  expect(() => beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now)).toThrow();
  session = finishAttempt(session, 'UI_TIMEOUT', now + 100);
  expect(session.reservedMicros).toBe(approval.initialReserveMicros + approval.cleanupReserveMicros + 100);
});
test('unknown failure or attempt timeout requires cleanup and never serializes provider errors', () => {
  const { approval, receipt, binding, monitor } = setup();
  let session = createSession(approval, receipt, binding, monitor, now);
  session = beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now);
  const failed = finishAttempt(session, 'secret-bearing provider failure', now + 100);
  expect(failed.status).toBe('RECOVERY_REQUIRED'); expect(JSON.stringify(failed)).not.toContain('secret-bearing');
  expect(finishAttempt(session, 'PASS', now + 1001).status).toBe('RECOVERY_REQUIRED');
});
test('independent cleanup works after expiry and budget exhaustion and produces absence evidence', () => {
  const { approval, receipt, binding, monitor, inventory } = setup();
  const session = createSession(approval, receipt, binding, monitor, now);
  session.reservedMicros = approval.budgetMicros;
  const result = forceCleanup(session, inventory, {}, now + 86400000);
  expect(result.session.status).toBe('CLEANED');
  expect(result.evidence.resources.every(row => row.absent === true)).toBe(true);
  expect(result.evidence.mode).toBe('SIMULATED');
  expect(forceCleanup(result.session, result.inventory, {}, now + 86400001).session.status).toBe('CLEANED');
});
test('partial cleanup attempts both resources, records failure, and can retry exact IDs', () => {
  const { approval, receipt, binding, monitor, inventory } = setup();
  const session = createSession(approval, receipt, binding, monitor, now);
  const partial = forceCleanup(session, inventory, { deployment: 'delete-fails' }, now);
  expect(partial.session.status).toBe('RECOVERY_REQUIRED');
  expect(partial.evidence.resources).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'child', absent: true }), expect.objectContaining({ kind: 'deployment', absent: false }),
  ]));
  expect(forceCleanup(partial.session, partial.inventory, {}, now).session.status).toBe('CLEANED');
});
test('cleanup never deletes mismatched identities or treats an accepted delete as absence', () => {
  const { approval, receipt, binding, monitor, inventory } = setup();
  const session = createSession(approval, receipt, binding, monitor, now);
  const drift = forceCleanup(session, { ...inventory, child: { ...inventory.child, childRef: receipt.parent } }, {}, now);
  expect(drift.inventory.child).not.toBeNull();
  expect(drift.session.status).toBe('RECOVERY_REQUIRED');
  const remained = forceCleanup(session, inventory, { child: 'remains' }, now);
  expect(remained.session.status).toBe('RECOVERY_REQUIRED');
});
test('live cleanup remains always-on and simulator has no live operation switch', () => {
  const source = readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8');
  expect(source).not.toContain('preview-pair-reuse');
  expect(source.slice(source.indexOf('name: Clean exact manual Preview resources'), source.indexOf('\n  cleanup:'))).toContain('always()');
});
