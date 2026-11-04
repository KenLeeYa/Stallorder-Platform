import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUnchangedExecution } from './delivery-admission.mjs';

const fixture = () => Object.fromEntries(['run', 'job', 'securityJob'].map((name, index) => [name, {
  id: index + 10, run_id: 10, head_sha: 'a'.repeat(40), run_attempt: 1,
  status: 'completed', conclusion: name === 'job' ? 'success' : 'failure',
  created_at: '2026-11-04T19:40:00Z', started_at: '2026-11-04T19:41:00Z', completed_at: '2026-11-04T20:00:00Z',
}]));
test('final readback retains the exact executions without requiring unrelated metadata equality', () => {
  const before = fixture(), after = structuredClone(before);
  after.run.display_title = 'unchanged execution metadata';
  assert.doesNotThrow(() => assertUnchangedExecution(before, after));
});
for (const name of ['run', 'job', 'securityJob']) {
  for (const key of ['id', 'run_id', 'head_sha', 'run_attempt', 'status', 'conclusion', 'created_at', 'started_at', 'completed_at']) {
    test(`rejects execution drift during log download: ${name}.${key}`, () => {
      const before = fixture(), after = structuredClone(before);
      after[name][key] = key === 'run_attempt' ? 2 : 'changed';
      assert.throws(() => assertUnchangedExecution(before, after));
    });
  }
}
