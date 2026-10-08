import { expect, test } from 'vitest';
import { approvedWatchExpiry, cleanupStartMs } from './manual-preview-deadline-watch.mjs';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const expected = { sourceRunId: '123', parent: 'parent', team: 'team', project: 'project',
  branch: 'codex/integrated-production-20261002', now: new Date('2026-10-08T06:15:00Z') };
const receipt = { resourceKey: 'manual-123', branchName: 'manual-123', gitBranch: expected.branch,
  parent: 'parent', team: 'team', project: 'project', createdAt: '2026-10-08T06:00:00.000Z', expiresAt: '2026-10-08T09:00:00.000Z' };

test('watcher binds exact source identity and three-hour deadline', () => {
  expect(approvedWatchExpiry(receipt, expected)).toBe(Date.parse(receipt.expiresAt));
  expect(cleanupStartMs(Date.parse(receipt.expiresAt))).toBe(Date.parse('2026-10-08T08:50:00Z'));
  expect(approvedWatchExpiry({ ...receipt, createdAt: '2026-10-08T07:00:00.000Z', expiresAt: '2026-10-08T09:00:00.000Z' }, expected))
    .toBe(Date.parse('2026-10-08T09:00:00Z'));
});
test('watcher rejects changed ownership, extended or expired receipts', () => {
  for (const changed of [{ ...receipt, resourceKey: 'manual-456' }, { ...receipt, parent: 'dr' },
    { ...receipt, createdAt: '2026-10-08T05:59:59Z', expiresAt: '2026-10-08T08:59:59Z' },
    { ...receipt, expiresAt: '2026-10-08T10:00:00Z' }]) expect(() => approvedWatchExpiry(changed, expected)).toThrow();
  expect(() => approvedWatchExpiry(receipt, { ...expected, now: new Date(receipt.expiresAt) })).toThrow('PREVIEW_WATCH_DEADLINE_INVALID');
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
