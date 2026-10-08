# PR366 repository-owned deployment evidence gate

Status: implemented candidate; hosted verification and release pending.

The owner approved changing the source of the required `Vercel` check on 2026-10-08. Both protected branches retain `verify`, `validate`, and `Vercel`; automatic Vercel deployment stays disabled. This check is produced by GitHub Actions, not the Vercel App. No manually posted successful status, branch-protection bypass, additional deployment, credential, or spending is authorized by this gate.

## Operation and immutable ownership

Dispatch the existing `ephemeral-preview.yml` with `operation=verify-deployment-evidence`, `approve_external_preview=false`, and `cleanup_run_id` equal to the completed paid validation run. Preview environment review remains mandatory. Only this explicit operation names its job `Vercel`; other operations have a different skipped-job name. Invalid input fails inside the requested check. Read-only verification has separate concurrency and cannot cancel the validation writer.

The verifier requires the fixed repository, original candidate branch, exact validation SHA/tree, successful first attempt, latest classified validation, original artifact ownership, required successful workflow steps, and exact binding across all raw receipts. A newer empty-jobs run is unclassified and fails closed even if cancelled. Historical deployment binding records an actual provider `READY` observation. A deleted deployment is subsequently described as absent, never currently READY.

The UI collector's `complete:false` is not sufficient evidence. Fifteen required UI cases must pass; its two pending phase requirements must be resolved by all five hours phase receipts and the persisted inbox, real membership revocation, rejected-order, and 18-case midnight rollback DB receipts. The explicitly excluded live HTTP clock-transition case remains not run; DB clock proof does not claim that device/time transition. Missing or unknown skipped cases fail.

## Cleanup and Primary preservation

The original final receipt must be `CLEANED`, identify exactly one owned child and deployment, and agree with the historical binding. Fresh read-only provider queries must confirm deployment 404, child absence under the exact parent, and unchanged Primary project/team/deployment/source/aliases.

Before creating resources, Primary baseline capture fingerprints the unique Production `NEXT_PUBLIC_SUPABASE_URL` provider record using its identity, targets, type, update timestamp, and opaque value. The provider stores this public setting as `sensitive`, so its single-record API does not expose a decrypted value. Verification compares the same undecrypted record fingerprint after cleanup; it does not export or print the value. Ambiguous, missing, paginated, or changed metadata fails closed. This proves unchanged public project configuration and immutable deployment identity, **not a fresh server database binding**. Actual database target and affected Production usage remain mandatory in the formal release gates.

## Protected staging and main promotion

Original candidate verification requires exact SHA. A staging dispatch is allowed only for the exact merge commit returned by the merged PR366, with fixed source/head/base repository and branch, the paid source SHA equal to PR366 head SHA, and GitHub source/merge trees identical to the dispatch tree. Receipts distinguish `sourceValidationSHA` from `dispatchSHA` and record tree-equivalent provenance. Arbitrary same-tree branches or newer staging commits are rejected; direct main dispatch is rejected.

The staging-head check can support the staging-to-main promotion PR. Before merging it, independently read the exact promotion head/base/test merge SHA, required check targets, mergeability, and proposed tree. Require its head to be the verified PR366 staging merge and its proposed merge tree to equal the validated tree. If GitHub selects a different test-merge check target or the proposed tree differs, fail closed and resolve that exact gate. After merge, read back the actual main tree and complete fresh free CI, Production/DR Plans, target readbacks, and authorized live affected-flow QA. This gate never substitutes for those checks.

## Verification and authorization limits

Executable regressions: `scripts/verify-pr366-deployment-evidence.test.mjs`, `scripts/pr366-deployment-evidence-workflow.test.mjs`, and `scripts/qa-pr366-preview-binding.test.mjs`; independent specification and standards review precede push. The new paid validation must use the final reviewed SHA. Historical failed or cleaned runs cannot validate a changed tree.

The approved single afternoon pair remains US$2 management target, Taipei 2026-10-08 14:00–17:00, latest creation 15:45, cleanup no later 16:50, immediate cleanup on success/failure. This read-only check does not extend, rebuild, or authorize a second pair. CodeQL findings remain separately reported; this check does not dismiss them or turn their result green.

Related: [afternoon approval](PR366_PREVIEW_APPROVAL_20261008_AFTERNOON.md), [formal release](PR366_ISOLATED_STAGING_PLAN.md), [Primary outage](../incidents/2026-09-12-dr-production-outage.md).
