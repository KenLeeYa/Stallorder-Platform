import { expect, test } from 'vitest';
import { approvedWatchExpiry, cleanupStartMs } from './manual-preview-deadline-watch.mjs';

const expected = { sourceRunId: '123', parent: 'parent', team: 'team', project: 'project',
  branch: 'codex/integrated-production-20261002', now: new Date('2026-10-04T12:15:00Z') };
const receipt = { resourceKey: 'manual-123', branchName: 'manual-123', gitBranch: expected.branch,
  parent: 'parent', team: 'team', project: 'project', createdAt: '2026-10-04T12:00:00.000Z', expiresAt: '2026-10-04T15:00:00.000Z' };

test('watcher binds exact source identity and three-hour deadline', () => {
  expect(approvedWatchExpiry(receipt, expected)).toBe(Date.parse(receipt.expiresAt));
  expect(cleanupStartMs(Date.parse(receipt.expiresAt))).toBe(Date.parse('2026-10-04T14:50:00Z'));
  expect(approvedWatchExpiry({ ...receipt, createdAt: '2026-10-04T13:00:00.000Z', expiresAt: '2026-10-04T15:30:00.000Z' }, expected))
    .toBe(Date.parse('2026-10-04T15:30:00Z'));
});
test('watcher rejects changed ownership, extended or expired receipts', () => {
  for (const changed of [{ ...receipt, resourceKey: 'manual-456' }, { ...receipt, parent: 'dr' },
    { ...receipt, expiresAt: '2026-10-04T15:30:00Z' }]) expect(() => approvedWatchExpiry(changed, expected)).toThrow();
  expect(() => approvedWatchExpiry(receipt, { ...expected, now: new Date(receipt.expiresAt) })).toThrow('PREVIEW_WATCH_DEADLINE_INVALID');
});
