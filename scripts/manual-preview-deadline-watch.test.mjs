import { expect, test } from 'vitest';
import { approvedWatchExpiry, cleanupStartMs } from './manual-preview-deadline-watch.mjs';

const expected = { sourceRunId: '123', parent: 'parent', team: 'team', project: 'project',
  branch: 'codex/integrated-production-20261002', now: new Date('2026-10-06T01:15:00Z') };
const receipt = { resourceKey: 'manual-123', branchName: 'manual-123', gitBranch: expected.branch,
  parent: 'parent', team: 'team', project: 'project', createdAt: '2026-10-06T01:00:00.000Z', expiresAt: '2026-10-06T04:00:00.000Z' };

test('watcher binds exact source identity and three-hour deadline', () => {
  expect(approvedWatchExpiry(receipt, expected)).toBe(Date.parse(receipt.expiresAt));
  expect(cleanupStartMs(Date.parse(receipt.expiresAt))).toBe(Date.parse('2026-10-06T03:50:00Z'));
  expect(approvedWatchExpiry({ ...receipt, createdAt: '2026-10-06T02:00:00.000Z', expiresAt: '2026-10-06T04:00:00.000Z' }, expected))
    .toBe(Date.parse('2026-10-06T04:00:00Z'));
});
test('watcher rejects changed ownership, extended or expired receipts', () => {
  for (const changed of [{ ...receipt, resourceKey: 'manual-456' }, { ...receipt, parent: 'dr' },
    { ...receipt, createdAt: '2026-10-06T00:59:59Z', expiresAt: '2026-10-06T03:59:59Z' },
    { ...receipt, expiresAt: '2026-10-06T05:00:00Z' }]) expect(() => approvedWatchExpiry(changed, expected)).toThrow();
  expect(() => approvedWatchExpiry(receipt, { ...expected, now: new Date(receipt.expiresAt) })).toThrow('PREVIEW_WATCH_DEADLINE_INVALID');
});
