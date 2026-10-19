# PR366 release contract — 2026-10-19

Status: local remediation; NOT release approval or hosted acceptance.

The [independent review and local follow-up](PR366_FOLLOWUP_REVIEW_20261019.md) supersedes the initial clean-install/build limitations below and preserves the original failed attempts. Full local build now passes; full-unit and release gates remain open. See its separate source-bound validation receipt.

## One candidate and evidence ledger

- Source PR: KenLeeYa/Stallorder-Platform#366, targeting staging. Read-only GitHub inspection on 2026-10-19 confirms Draft/BLOCKED, head `94d2ad3a426959a865fcd0abd89d3a0ac35a43e2`.
- Isolated branch: `codex/pr366-release-remediation-20261019`, based on that exact head. Review this branch's diff before moving its changes into PR366. The protected verifier deliberately still accepts only the original PR366 branch or its proven staging merge; this preparation branch is not a newly authorized release source.
- Existing CI `38006636583` and source scan `38006636698` succeeded on the old head. They do not qualify the modified candidate. `validate` was skipped and no exact required Vercel evidence check succeeded. A skipped job alone does not establish the reason branch protection is blocked.
- Last full hosted attempt `37933861011` failed session revocation after membership revocation. Later smoke did not run. Cleanup succeeded; no complete same-source hosted PASS exists.
- PR365 is already an ancestor. Do not merge it again. The native Nix/IFD synthetic candidate at `04194e01` is NOT this release gate; do not modify its security controls or make its tool build a release prerequisite.
- Freeze the final reviewed commit AND tree after local changes. Track CI, scan, database/Edge/build, hosted UI, hours/DB, smoke, cleanup, provider readback and verifier run against that identity. Any source/dependency/workflow change invalidates affected evidence. Never manufacture a status.

## Session revocation acceptance

The harness must open the exact bound notification fixture and show its private detail before logout. It records a real auth/me 200 precondition and private list/detail visibility, then exactly one logout 200 and one auth/me 401. It must observe denial and hidden list/detail on the mounted page, without reload or session/logout retry. An early background denial remains valid only after these preconditions and real server responses. Existing refresh race handling remains bounded by final assertions.

The evidence verifier now consumes `ui-session-revocation.json`, checks resource/SHA/tree binding and ordered unique stages, and rejects a summary PASS without the detailed proof. Older receipts without these preconditions are insufficient for the new candidate. Failed verification produces an exclusive sanitized FAIL receipt with an allowlisted category; it never overwrites a previous receipt or changes the failing exit status. Categories distinguish source, hosted validation, artifact, session, acceptance, target/provider, request and unclassified errors. No raw provider errors, URLs, tokens or private content belong in that receipt.

This strengthens reproducibility and proof. The previous hosted failure's actual substep remains unknown; local synthetic tests cannot establish a product root cause or hosted success.

## Dependency decision

Fresh `npm audit --workspaces=false --package-lock-only --json` on 2026-10-19 still reports five HIGH findings and no other severity in that scope. The chain is eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces 3.0.3. The official [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists affected versions <=3.0.3 and no patched release; npm reports latest braces 3.0.3.

The exception expired `2026-10-10T04:00:00Z` and remains unchanged. Audit is NON_PASS. Do not extend the exception, suppress the advisory, remove lint protection, hand-edit lockfile integrity or install an unreviewed fork to claim a patch. Before release, recheck for an upstream compatible fix; if still unavailable, an independently reviewed dependency replacement with equivalent lint coverage is required, or a separately explicit owner decision. This change grants neither. A full repository/native audit is a separate scope and is not claimed by this Web result.

The current audit's `fixAvailable` suggests the semver-major downgrade `eslint-config-next@14.2.35`. That is not a compatible patch for this Next 16.3.8 candidate. It has not been applied; using `npm audit fix --force` would silently change lint coverage and needs a separate compatibility review.

## Fixed isolated environment conversion (Proposed, no remote mutation)

Read-only provider inventory completed 2026-10-19 around 13:09 UTC:

- Primary `eyuctbnlvnbnivwasvqr` and DR `daeqwtpaxcebmtwxqdkj` are ACTIVE_HEALTHY. PostgreSQL versions differ: Primary 17.6.1.147, DR 17.6.1.141. This is provider state, not an application health or recovery proof.
- Primary publication `stallorder_primary_to_dr` contains 124 tables, with an active logical slot of the same name. DR subscription of that name is enabled; 124 subscription relations are ready and one subscription worker is active. **DR is still receiving real Primary replication. No conversion has occurred.** Single-point LSN observations do not prove continuous lag or completeness.
- Both migration histories have 146 entries, latest `20260912112200`. This does not qualify PR366's pending migration set.
- DR has 9 cron jobs, all inactive. Five Edge functions remain ACTIVE: create-order-session v36, create-public-order v34, get-public-order v35, manage-line-link v27, prepare-reorder v27. Inactive cron alone does not fence other dispatch paths.
- Exact Vercel team/project readback and deployment-alias readback confirm `app.qidaigo.com` and `stallorder-platform.vercel.app` still belong to READY production deployment `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`, main SHA `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`. The project's latest preview deployment is a different artifact and must not be confused with Production.
- The connected project metadata does not expose backup/PITR recovery points or restore-test evidence. Backup retention, recoverability, storage bytes, RPO/RTO, authenticated critical flows and runtime backend-value binding remain NOT VERIFIED. No restore, replication change or remote configuration write was performed.

The owner selected reuse of the existing DR project to reduce cost. Selection is not evidence of conversion. Existing scripts, bindings, scheduled jobs, replication and the Production DR gate still depend on its current role. Never pass the old DR project to the ephemeral harness: its data-less child and exact cleanup contract intentionally reject that substitution.

Before any approved conversion, collect a read-only, timestamped inventory with exact Primary and DR project IDs and resource owners:

1. App/server/Edge backend bindings, Vercel projects/deployments/aliases, DNS/Access, health and affected login/staff/QR flows. Parent-provided Primary baseline is `5cc15c6a` / `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`; re-read before remote work. This local task did not refresh authenticated Production or provider backup state.
2. Publications/subscriptions, enabled/disabled state, slots and LSN/lag, relation/column classification, migration history, RLS/grants, extensions, cron/webhooks/queues and all external dispatch paths. Do not print credentials or inspect decrypted secret values for inventory.
3. Backup/PITR entitlement, last completed recovery point, retention, encryption/key custody, storage object recovery, Auth/provider configuration, Edge source/version and configuration fingerprints. Record gaps independently; a snapshot timestamp alone is not restore proof.
4. Restore rehearsal into an independently isolated authorized target: schema/data consistency, migration history, critical counts/financial invariants, deletion tombstones and post-snapshot revocations, fresh-session requirement, storage bytes, cron disabled and provider dispatch disabled. Record measured RPO/RTO and exact source/target. The existing `verify-isolated-restore.mjs` is hardcoded to a different local compliance database and mutates it; do not execute it against DR or label its historical synthetic result full recoverability.

Stop conversion until the owner reviews a concrete inventory, backup/rehearsal evidence, remaining DR coverage, cost and rollback plan. No reset, replication detachment, credential/permission change, connection replacement or external resource creation is authorized here.

The eventual immutable conversion Plan must bind source commit/tree, exact resource IDs, inventory digests, preimages, backup/recovery proof, writer ownership and each mutation's compensation/readback. Separate test deployment and synthetic fixtures from retained business data; fence all outbound payment/LINE/mail/push/print/cron and inbound replication before any test write. Test cleanup may delete only journaled synthetic fixtures, never the project or retained data. Require exclusive test leases, clean fixture readback and a fresh application+Edge+schema identity for every run. Implement and test this distinct persistent-environment workflow before enabling it; do not weaken the existing ephemeral verifier to make it fit.

Production readiness currently requires a successful DR schema Apply. Reusing DR as test does not satisfy that invariant. Choose and implement a reviewed replacement recovery topology and matching executable readiness checks before release; do not repurpose a test receipt as DR evidence. Until then the original gate remains OPEN and the conversion remains Proposed.

## Correct Plan/Apply route and recovery

1. Review local changes and dependency resolution, freeze candidate, then request approval before push/PR updates. No workflow dispatch is part of this task. Full same-source CI/scan and all declared local gates must pass.
2. Complete the approved isolated environment workflow. For the existing ephemeral route, a new resource/cost window and cleanup owner are required; expired dates and prior cost approvals are not reusable. Run migrations, DB tests/lint, Edge deployment, build, all UI/hours/DB cases, smoke and exact cleanup/readback on the frozen source.
3. Explicitly run `ephemeral-preview.yml` operation `verify-deployment-evidence` with `approve_external_preview=false` and the successful original validation run ID in `cleanup_run_id`. This still uses Actions and requires approval here. Only its real verifier produces the required Vercel context. Retain FAIL artifacts and fix the classified cause; no blank green status.
4. Merge into staging only after protections pass; rerun staging qualification and bind a promotion to the identical tree. PR366 includes database and Edge changes: **do not use production-application-release.yml**. Use the reviewed DR schema Plan/Apply via production-dr-operations, then production-readiness with the successful immutable `dr_schema_run_id`, fresh Production Plan and approved Apply. Verify the actual workflow's current input/confirmation contract at execution time. No command here authorizes a mutation.
5. Preserve the existing ordering: verified artifact, reviewed migrations/history/lint, reviewed Edge/runtime readback, then exact artifact promotion and live authenticated affected-flow verification. Reconcile DR replication only through a fresh approved plan; keep DR operator publication paused until independently authorized.

Before step 4, build a recovery matrix bound to the candidate's full migration and Edge diff:

| Failure point | Safe action and required proof |
| --- | --- |
| Before DB/Edge write | Stop; retain evidence; remove only owned temporary resources with readback. |
| Migration partial/failure | Do not promote. Preserve migration history; diagnose committed statements; reviewed additive forward-fix with new Plan. Never reset, blindly repair history or run destructive down migrations. |
| Edge updated, app not promoted | Stop. Select exact verified compatible Edge source/config and restore only through approved operation, or forward-fix. Prove secrets/digests, session, public order, replay/idempotency and CORS compatibility. |
| Alias promotion regresses app | Restore an explicitly verified compatible immutable app artifact; alias rollback does **not** revert DB/Edge. Verify old app against current schema/Edge before choosing it; otherwise fence affected writes and forward-fix. |
| Actual data corruption | Incident owner approval, independently verified backup/PITR, explicit RPO/lost-write reconciliation, rehearsal and writer fencing. Restore is not an automatic release rollback. |
| DR/test conversion failure | Restore only exact Plan preimages with approved writer coordination. Never blindly re-enable subscriptions: compare slots/LSN/schema and prevent test data flowing into business systems. |

Require signed-off compatibility evidence for every old-app/new-schema/new-Edge combination used for recovery, exact function versions and immutable deployment, backup reference, responsible operator and abort conditions. No such matrix/rehearsal is yet complete. See `docs/PRODUCTION_ROLLBACK.md` and `docs/PRODUCTION_DR_AUTOMATION.md` for existing obligations.

## Remaining gates

Dependency NON_PASS; full final-source local/CI/security gates; real hosted session and all subsequent acceptance; persistent environment conversion/backup/recovery evidence; exact Vercel verifier; staging promotion/provenance; preserved DR capability and schema Apply; Production Plan/Apply and live affected-flow verification. All remain open until actual evidence exists. No paid resources, Docker restart, merge, deployment, alias switch, replication or Production connection change occurred in this local preparation.

## Local verification

- Final targeted Vitest 4.1.11 run: **136 PASS / 2 platform-conditional SKIP / 0 FAIL**, five suites. Includes session preconditions (9), deployment verifier (66), workflow contract (3), Preview UI helper/real Chromium tests (49), and supervisor lifecycle (11 including the two skips). Raw JSON: task-level `local-qa-results-final.json`.
- Reproduced the evidence gap against the actual base verifier: it accepted missing `ui-session-revocation.json`; the corrected verifier rejects it. This reproduces an evidence defect, not the unknown historical hosted substep.
- Four changed JavaScript modules/tests pass `node --check`; `git diff --check` passes. No product TypeScript, migration, Edge source, workflow permission, dependency graph or exception-expiry change.
- Complete lockfile installation did not pass: initial network install ended ECONNRESET; offline retry ended ENOTCACHED for Next 16.3.8. Initial sandbox Vitest attempt ended EPERM before executing tests. A separate task-level runner installed only fixed Vitest 4.1.11, js-yaml 4.1.1 and Playwright 1.61.1, then ran the original tests with explicit dependency aliases outside the sandbox temp-file restriction. The application's package.json/package-lock.json were preserved.
- Full application lint/typecheck/build, database rebuild/tests and same-source hosted validation were not executed. The targeted runner is local regression evidence only; it does not replace clean install or release gates. No Docker service was started.

The [local validation receipt](PR366_LOCAL_VALIDATION_20261019.json) records source byte hashes, the raw test-report digest, audit scope and read-only provider facts. It is not a deployment gate receipt.
