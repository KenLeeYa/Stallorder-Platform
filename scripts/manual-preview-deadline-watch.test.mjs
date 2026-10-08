import { expect, test } from 'vitest';
import { approvedWatchExpiry, cleanupStartMs } from './manual-preview-deadline-watch.mjs';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const expected = { sourceRunId: '123', parent: 'parent', team: 'team', project: 'project',
  branch: 'codex/integrated-production-20261002', now: new Date('2026-10-08T23:15:00Z') };
const receipt = { resourceKey: 'manual-123', branchName: 'manual-123', gitBranch: expected.branch,
  parent: 'parent', team: 'team', project: 'project', createdAt: '2026-10-08T23:00:00.000Z', expiresAt: '2026-10-09T02:00:00.000Z' };

test('watcher binds exact source identity and three-hour deadline capped at the approved window', () => {
  expect(approvedWatchExpiry(receipt, expected)).toBe(Date.parse(receipt.expiresAt));
  expect(cleanupStartMs(Date.parse(receipt.expiresAt))).toBe(Date.parse('2026-10-09T01:50:00Z'));
  const last = { ...receipt, createdAt: '2026-10-09T00:45:00.000Z', expiresAt: '2026-10-09T02:00:00.000Z' };
  expect(approvedWatchExpiry(last, expected)).toBe(Date.parse('2026-10-09T02:00:00Z'));
  expect(cleanupStartMs(Date.parse(last.expiresAt))).toBe(Date.parse('2026-10-09T01:50:00Z'));
});
test('watcher rejects changed ownership, extended or expired receipts', () => {
  for (const changed of [{ ...receipt, resourceKey: 'manual-456' }, { ...receipt, parent: 'dr' },
    { ...receipt, createdAt: '2026-10-08T11:00:00Z', expiresAt: '2026-10-08T14:00:00Z' },
    { ...receipt, createdAt: '2026-10-08T22:59:59Z' },
    { ...receipt, createdAt: '2026-10-09T00:45:01Z', expiresAt: '2026-10-09T02:00:00Z' },
    { ...receipt, expiresAt: '2026-10-09T01:30:00Z' },
    { ...receipt, expiresAt: '2026-10-09T02:00:01Z' },
    { ...receipt, createdAt: '2026-10-09T02:00:00Z', expiresAt: '2026-10-09T02:00:01Z' }]) expect(() => approvedWatchExpiry(changed, expected)).toThrow();
  expect(() => approvedWatchExpiry(receipt, { ...expected, now: new Date(receipt.expiresAt) })).toThrow('PREVIEW_WATCH_DEADLINE_INVALID');
});

test('new watcher never reuses or extends an old-window owner receipt', () => {
  const previous = { ...receipt, createdAt: '2026-10-08T16:00:00Z', expiresAt: '2026-10-08T19:00:00Z' };
  expect(() => approvedWatchExpiry(previous, expected)).toThrow('PREVIEW_WATCH_DEADLINE_INVALID');
  expect(previous.expiresAt).toBe('2026-10-08T19:00:00Z');
});

test('deadline cleanup receives recovered owner through the next GitHub Actions step', () => {
  const steps = yaml.load(readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8')).jobs['deadline-cleanup-manual-run'].steps;
  const recoveryIndex = steps.findIndex(step => step.id === 'deadline-recovery');
  const cleanupIndex = steps.findIndex(step => step.name === 'Independently clean and read back only the original manual run resources');
  expect(recoveryIndex).toBeGreaterThanOrEqual(0);
  expect(cleanupIndex).toBe(recoveryIndex + 1);
  expect(steps[recoveryIndex].run).toContain('node scripts/manual-preview-recovery.mjs');
  expect(steps[recoveryIndex].run).not.toContain('node scripts/manual-preview-cleanup.mjs');
  expect(steps[cleanupIndex].if).toContain("steps.deadline-recovery.outcome == 'success'");
  expect(steps[cleanupIndex].run).toBe('node scripts/manual-preview-cleanup.mjs cleanup');
  const job = yaml.load(readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8')).jobs['deadline-cleanup-manual-run'];
  expect(job.env.PREVIEW_EXPECTED_HEAD_SHA).toBe('${{ github.sha }}');
  expect(job.env.PREVIEW_EXPECTED_GIT_BRANCH).toBe('${{ github.ref_name }}');
  const evidence = steps.find(step => step.name === 'Preserve independent deadline cleanup evidence');
  expect(evidence.if).toContain('always()');
  expect(evidence.with['if-no-files-found']).toBe('warn');
});
