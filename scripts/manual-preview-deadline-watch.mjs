import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function approvedWatchExpiry(receipt, { sourceRunId, parent, team, project, branch, now = new Date() }) {
  const key = `manual-${sourceRunId}`;
  if (!/^[1-9][0-9]{0,19}$/.test(String(sourceRunId)) || receipt?.resourceKey !== key || receipt.branchName !== key
    || receipt.gitBranch !== branch || receipt.parent !== parent || receipt.team !== team || receipt.project !== project
    || branch !== 'codex/integrated-production-20261002') throw Error('PREVIEW_WATCH_IDENTITY_INVALID');
  const created = new Date(receipt.createdAt), expiry = new Date(receipt.expiresAt);
  const approvedCutoff = new Date('2026-10-08T05:00:00Z');
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(expiry.getTime()) || created < new Date('2026-10-08T02:00:00Z') || created >= expiry
    || expiry.getTime() !== Math.min(created.getTime() + 3 * 3600000, approvedCutoff.getTime())
    || expiry <= now) throw Error('PREVIEW_WATCH_DEADLINE_INVALID');
  return expiry.getTime();
}

export function cleanupStartMs(expiryMs) {
  if (!Number.isFinite(expiryMs)) throw Error('PREVIEW_WATCH_DEADLINE_INVALID');
  return expiryMs - 10 * 60000;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const receipt = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    console.log(cleanupStartMs(approvedWatchExpiry(receipt, {
      sourceRunId: process.env.CLEANUP_RUN_ID,
      parent: process.env.SUPABASE_PARENT_PROJECT_REF,
      team: process.env.VERCEL_ORG_ID,
      project: process.env.VERCEL_PROJECT_ID,
      branch: process.env.PREVIEW_GIT_BRANCH,
    })));
  } catch { console.error('PREVIEW_WATCH_RECEIPT_INVALID'); process.exitCode = 1; }
}
