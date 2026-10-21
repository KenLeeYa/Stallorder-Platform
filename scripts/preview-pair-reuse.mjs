// Offline state-machine prototype. No provider clients, credentials, deployment,
// migration, network, or live retention switch. Receipts are SIMULATED evidence.
import { pathToFileURL } from 'node:url';
import { assertTarget } from './qa-pr366-preview-ui.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const positive = value => Number.isSafeInteger(value) && value > 0;
const deny = () => { throw Error('PREVIEW_REUSE_DENIED'); };
function lockFor(approval, receipt, binding, monitor, now) {
  assertTarget(receipt, binding, now);
  if (approval?.mode !== 'DRY_RUN' || !/^[a-z0-9-]+$/.test(approval.approvalId ?? '')
    || !positive(approval.budgetMicros) || approval.currency !== 'USD'
    || !positive(approval.initialReserveMicros) || !positive(approval.cleanupReserveMicros)
    || approval.costBasis !== 'UPPER_BOUND_THROUGH_EXPIRY'
    || receipt.branches.length !== 1 || receipt.deployments.length !== 1
    || approval.resourceKey !== receipt.resourceKey || approval.childRef !== binding.childRef
    || approval.deploymentId !== binding.deploymentId || approval.sha !== binding.sha || approval.tree !== binding.tree
    || approval.expiresAt !== receipt.expiresAt || !(Date.parse(approval.approvedAt) <= now)
    || !(Date.parse(approval.expiresAt) > now) || !(Date.parse(approval.approvedAt) < Date.parse(approval.expiresAt))
    || !monitor?.active || monitor.resourceKey !== receipt.resourceKey
    || !/^[a-z0-9-]+$/.test(monitor.id ?? '') || monitor.expiresAt !== approval.expiresAt
    || !(monitor.verifiedAt <= now && monitor.verifiedAt > now - 5 * 60000)) deny();
  return { approvalId: approval.approvalId, approvedAt: approval.approvedAt, expiresAt: approval.expiresAt,
    budgetMicros: approval.budgetMicros, initialReserveMicros: approval.initialReserveMicros,
    cleanupReserveMicros: approval.cleanupReserveMicros, currency: approval.currency, costBasis: approval.costBasis,
    resourceKey: receipt.resourceKey, parent: receipt.parent, team: receipt.team, project: receipt.project,
    gitBranch: receipt.gitBranch, childRef: binding.childRef, deploymentId: binding.deploymentId,
    origin: binding.origin, sha: binding.sha, tree: binding.tree, monitorId: monitor.id };
}

export function createSession(approval, receipt, binding, monitor, now) {
  const lock = lockFor(approval, receipt, binding, monitor, now);
  const reservedMicros = lock.initialReserveMicros + lock.cleanupReserveMicros;
  if (!Number.isSafeInteger(reservedMicros) || reservedMicros >= lock.budgetMicros) deny();
  return { mode: 'SIMULATED', lock, reservedMicros, status: 'READY', attempts: [], lastAt: now };
}

export function beginAttempt(session, approval, receipt, binding, monitor, request, now) {
  if (session.mode !== 'SIMULATED' || !['READY', 'RETRYABLE'].includes(session.status)
    || !same(session.lock, lockFor(approval, receipt, binding, monitor, now)) || now < session.lastAt
    || !positive(request.reserveMicros) || !positive(request.maxDurationMs)
    || now + request.maxDurationMs >= Date.parse(session.lock.expiresAt)
    || !Number.isSafeInteger(session.reservedMicros) || session.reservedMicros < session.lock.initialReserveMicros + session.lock.cleanupReserveMicros
    || !Number.isSafeInteger(session.reservedMicros + request.reserveMicros)
    || session.reservedMicros + request.reserveMicros > session.lock.budgetMicros) deny();
  const next = structuredClone(session);
  next.reservedMicros += request.reserveMicros; // Never refund a failed/unknown attempt.
  next.attempts.push({ number: next.attempts.length + 1, startedAt: now,
    deadline: now + request.maxDurationMs, reserveMicros: request.reserveMicros, outcome: 'RUNNING' });
  next.status = 'RUNNING'; next.lastAt = now;
  return next;
}

export function finishAttempt(session, outcome, now) {
  if (session.mode !== 'SIMULATED' || session.status !== 'RUNNING' || now < session.lastAt) deny();
  const next = structuredClone(session), attempt = next.attempts.at(-1);
  const withinWindow = now < attempt.deadline && now < Date.parse(next.lock.expiresAt);
  const safe = ['PASS', 'UI_TIMEOUT', 'UI_ASSERTION'].includes(outcome) && withinWindow ? outcome : 'UNRECOVERABLE';
  attempt.outcome = safe; attempt.finishedAt = now; next.lastAt = now;
  next.status = safe === 'PASS' ? 'COMPLETE' : safe === 'UNRECOVERABLE' ? 'RECOVERY_REQUIRED' : 'RETRYABLE';
  return next;
}

// Independently callable after expiry, exhausted budget, failed test or partial
// cleanup. An in-memory inventory models provider GET / DELETE / GET, not live I/O.
export function forceCleanup(session, inventory, faults = {}, now) {
  if (session.mode !== 'SIMULATED') deny();
  const next = structuredClone(session), remaining = structuredClone(inventory), resources = [];
  for (const kind of ['deployment', 'child']) {
    const expectedId = kind === 'child' ? session.lock.childRef : session.lock.deploymentId;
    const current = remaining[kind];
    const verified = current === null || same(current, resourceIdentity(session.lock, kind));
    if (verified && current !== null && !faults[kind]) remaining[kind] = null;
    const absent = verified && remaining[kind] === null;
    resources.push({ kind, id: expectedId, identityVerified: verified, absent,
      code: absent ? 'ABSENCE_VERIFIED' : verified ? 'CLEANUP_READBACK_FAILED' : 'IDENTITY_DRIFT' });
  }
  next.status = resources.every(row => row.absent) ? 'CLEANED' : 'RECOVERY_REQUIRED'; next.lastAt = now;
  return { session: next, inventory: remaining,
    evidence: { mode: 'SIMULATED', status: next.status, checkedAt: now, resources } };
}
export function resourceIdentity(lock, kind) {
  return kind === 'child'
    ? { childRef: lock.childRef, parent: lock.parent, resourceKey: lock.resourceKey, gitBranch: lock.gitBranch, dataLess: true }
    : { deploymentId: lock.deploymentId, team: lock.team, project: lock.project, resourceKey: lock.resourceKey,
      gitBranch: lock.gitBranch, sha: lock.sha, tree: lock.tree, origin: lock.origin, target: 'preview', productionAlias: false };
}

export function syntheticScenario(now) {
  const receipt = { resourceKey: 'manual-123', parent: 'eyuctbnlvnbnivwasvqr', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',
    team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', gitBranch: 'codex/integrated-production-20261002',
    expiresAt: new Date(now + 3600000).toISOString(), status: 'CAPTURED',
    branches: [{ id: 'synthetic-child' }], deployments: [{ id: 'dpl_synthetic', target: 'preview' }] };
  const binding = { origin: 'https://synthetic.vercel.app', resourceKey: receipt.resourceKey, providerReadback: 'VERIFIED',
    sha: 'a'.repeat(40), tree: 'b'.repeat(40), childRef: 'synthetic-child', deploymentId: 'dpl_synthetic', productionAlias: false, dataLess: true };
  binding.readback = { verifiedAt: new Date(now).toISOString(),
    child: { project_ref: binding.childRef, name: receipt.resourceKey, parent_project_ref: receipt.parent, with_data: false, git_branch: receipt.gitBranch },
    childScope: { provider: 'supabase-cli', operation: 'branches list', parentProjectRef: receipt.parent },
    deployment: { id: binding.deploymentId, projectId: receipt.project, teamId: receipt.team, target: 'preview', origin: binding.origin,
      meta: { stallorderPreviewResource: receipt.resourceKey, githubCommitRef: receipt.gitBranch, githubCommitSha: binding.sha } },
    source: { sha: binding.sha, tree: binding.tree } };
  const approval = { mode: 'DRY_RUN', approvalId: 'synthetic-approval', resourceKey: receipt.resourceKey,
    childRef: binding.childRef, deploymentId: binding.deploymentId, sha: binding.sha, tree: binding.tree,
    approvedAt: new Date(now).toISOString(), expiresAt: receipt.expiresAt, currency: 'USD', budgetMicros: 1000,
    initialReserveMicros: 200, cleanupReserveMicros: 100, costBasis: 'UPPER_BOUND_THROUGH_EXPIRY' };
  const monitor = { id: 'synthetic-monitor', resourceKey: receipt.resourceKey, active: true, expiresAt: receipt.expiresAt, verifiedAt: now };
  const session = createSession(approval, receipt, binding, monitor, now);
  return { approval, receipt, binding, monitor,
    inventory: { child: resourceIdentity(session.lock, 'child'), deployment: resourceIdentity(session.lock, 'deployment') } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') {
    console.error('PREVIEW_REUSE_DRY_RUN_ONLY'); process.exitCode = 1;
  } else {
    const now = Date.parse('2026-10-04T00:00:00Z');
    const { approval, receipt, binding, monitor, inventory } = syntheticScenario(now);
    let session = createSession(approval, receipt, binding, monitor, now);
    for (const [offset, outcome] of [[0, 'UI_TIMEOUT'], [200, 'PASS']]) {
      session = beginAttempt(session, approval, receipt, binding, monitor, { reserveMicros: 100, maxDurationMs: 1000 }, now + offset);
      session = finishAttempt(session, outcome, now + offset + 100);
    }
    const cleanup = forceCleanup(session, inventory, {}, now + 86400000);
    console.log(JSON.stringify({ mode: 'SIMULATED', attempts: session.attempts, reservedMicros: session.reservedMicros,
      budgetMicros: approval.budgetMicros, expiresAt: session.lock.expiresAt, cleanup: cleanup.evidence,
      limitation: 'Synthetic cost units and absence evidence; no provider billing, live resources, or approval.' }, null, 2));
  }
}
