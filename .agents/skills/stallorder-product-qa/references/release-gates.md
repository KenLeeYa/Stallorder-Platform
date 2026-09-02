# StallOrder protected release gates

This is a fail-closed sequence. A green earlier run cannot substitute for evidence on the exact released revision.

## Authorization boundary

- A current user request to release authorizes the normal release workflow for the specified change and environments.
- It does not authorize bypassing branch protection, security gates, database Plan/Apply binding, external-provider writes, destructive cleanup, or unrelated changes.
- Historical chat approvals, old Plan digests, and old run IDs are never reusable.
- If a workflow requires an exact confirmation tied to a fresh immutable Plan, obtain or use only authorization that unambiguously names that current operation according to the repository contract.

## Gate 0 — preflight

- Fetch/prune remote refs without altering user work.
- Record clean release worktree, branch, HEAD, tree, upstream, open PRs, and relevant worktrees.
- Reconcile other work by patch/tree equivalence; do not merge stale branches wholesale.
- Review the exact diff and migration set. Confirm no test artifacts, local secrets, generated caches, or unrelated files.
- Confirm `.codegraph` status and complete security/performance evidence for the exact revision.

## Gate 1 — local immutable revision

Run repository-declared commands for:

- lockfile install;
- formatting/diff check, lint, UI audit, typecheck;
- focused and full unit/component tests;
- fresh database rebuild, migration contract, pgTAP/RLS, DB lint;
- production guardrails, production build, dependency audit;
- affected Playwright/E2E roles and responsive matrix;
- performance measurement and security scan/remediation.

Commit only reviewed paths. Re-run any invalidated evidence after merge/rebase/dependency or migration changes.

## Gate 2 — PR and ephemeral Preview

- PR targets Staging first.
- Required CI and hosted Preview use the same head SHA.
- Preview provisions isolated data, applies reviewed migrations, deploys required Edge Functions/config, and runs read-only plus synthetic smoke without live provider writes.
- Temporary external outage can be retried only with documented evidence and bounded attempts; do not change product code to mask an outage.
- Merge only after all required checks pass and head/base have not drifted.

## Gate 3 — post-merge Staging

- Re-run post-merge CI/readiness on the Staging SHA.
- Run the role journeys and 320/390/768/1440 responsive checks on hosted Staging.
- Verify scheduled jobs, Edge Functions, SSE/KDS/printing, public QR/order, catalog publish, payment correction, reports, integrations-off behavior, and local-only facilities absent.
- Capture Staging commit/tree/deployment and smoke evidence.

## Gate 4 — promotion and DR schema

- Create a fresh promotion from the verified Staging tree. `main` and Staging content trees must match at release.
- Create a fresh DR schema Plan bound to the exact commit/tree and migration set.
- Verify additive-only/approved migration policy, migration history, remote lint, grants/RLS, and DR target identity.
- Apply only the current approved Plan. Download and verify immutable DR Apply evidence.

### Vercel DR project bootstrap (`REL-DR-VERCEL-01`)

This gate runs before any Git link, deployment, custom-domain/alias binding, or DNS mutation for a newly created DR operator project:

1. Call Vercel `Create Project` without an `ssoProtection` field, creating a Git-unlinked and domainless project.
2. Capture and verify the exact returned project ID under the intended account/team.
3. PATCH that exact ID through `Update Existing Project` with `ssoProtection.deploymentType=all`.
4. Read back the same project and require `ssoProtection.deploymentType` to equal `all` before continuing.
5. If PATCH or read-back fails, delete only that exact project ID, verify rollback completion, and stop the Apply. `all_except_custom_domains` is never an accepted fallback.

## Gate 5 — Production Plan and Apply

- Create a fresh Production read-only Plan bound to successful DR evidence and the exact main/staging tree.
- Re-run local gates and Production remote dry-run/lint before any write.
- Build an unbound deployment artifact first.
- Apply migrations, verify history/lint, deploy and verify Edge Functions, then promote the exact artifact.
- Production smoke covers public site/QR plus authenticated critical flows using approved non-destructive test strategy.
- On failure, stop before promotion where possible or execute the repository rollback contract. Never improvise destructive rollback.

## Gate 6 — DR replication reconciliation

- Create a fresh incremental replication Plan bound to successful Production evidence.
- Preserve existing-only/approved publication and subscription scope; no accidental table/column expansion.
- Apply the current Plan, wait for catch-up, and verify endpoint identity, relation/column contract, LSN/lag, blockers, storage manifest, and `ready=true`.

## Completion criteria

Release is complete only when all are reconciled:

- PR/branch/tree and deployed artifact;
- migration set/history and remote lint;
- Edge Functions/jobs/config flags;
- Production live smoke;
- immutable Plan/Apply receipts;
- DR readiness/lag/contract;
- no newly discovered high/critical security finding;
- no unresolved functional or responsive regression.

Report every `not evaluated` area. Workflow success alone is insufficient.
