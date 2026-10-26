# PR389 alternative application release acceptance

Owner adoption: 2026-10-26. Preparation continued after midnight on 2026-10-27
(Asia/Taipei). Status: adopted policy; release qualification incomplete.

The owner requested publication using the proposed alternative: local regression,
isolated paired Preview, protected release and Production affected-flow QA.
Persistent Staging is no longer a prerequisite for this bounded PR389 application
release. DR conversion, PR366 integration and restoration qualification remain
separate unfinished work. No test is marked passed by this policy decision.

## Source and target boundaries

| Item | Bound identity |
| --- | --- |
| PR389 source | `eb1d925f6cb7d728c054dfdbe96f5c103dde6f96` |
| Original complete tree | `becf8f2a207562521f9f5f5abd82bc9938371ba0` |
| Paired tested merge | `e8962f43520a49f5cffe08da921944ccfa244455`, same complete tree |
| Existing paired deployment | `dpl_FaqbcfFyZ9gFMxPDwxE3rqVW8mTH` |
| Existing paired backend | `teunnvfakbfzmodajqjz`, branch `e232885a-7d2e-4254-91f9-3a1edf9625e2` |
| Production baseline source | `4e95d2ea5d53ae78c5af9c3db044481237674c44` |
| Production baseline deployment | `dpl_4v5acoGZU8tkbTAnb6uEwuN5AjJQ` |
| Production project / backend | `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP` / `eyuctbnlvnbnivwasvqr` |
| Production hostname | `app.qidaigo.com` |

The two-file policy successor was published as
`11b7b2a7cf9c79fd3d23bc9761f7aead6cef0d9b`, tree
`a4147b34af6cd5e8fffbeeecb6bbb5d92fa5bccc`. Only this file and ADR-006 differ from
the original source in that commit. Its subsequent release-control correction
has an eight-file allowlist: these two documents, the application release
workflow, `production-application-target.mjs`, `production-application-recovery-plan.mjs`,
and `production-application-{target,exact-recovery,recovery-plan}.test.mjs` under
`scripts/lib/`. No application, dependency, lockfile, schema or seed change belongs
to that successor. Record its actual commit/full tree and compare every other
entry before promotion. Git source equivalence is not identical deployment
binary or runtime configuration. Recheck head/base and provider identities.

The actual Production-to-candidate application delta includes Next.js and
eslint-config-next 16.3.8 -> 16.4.2, dependency fixes including undici 7.30.1 and
zod 4.6.6, protected origin/OAuth URL handling, closure notice refresh and the
READY order dialog. Prisma and Supabase source trees are unchanged. The smaller
main-to-PR diff cannot be used to omit these affected cases.

## Evidence and unresolved cases

| Gate | Evidence / current limit |
| --- | --- |
| Source review | Application diff inspected against deployed `4e95d2ea`; independent review separates policy authorization from technical proof. |
| Original source CI | `40262330685` / job `121377165077` succeeded. Its bounded log records zero audit vulnerabilities. This is not the locally installed dependency tree. |
| Original source security | `40262330701` succeeded; CodeQL reports no new alerts in changed code. This does not itself dismiss or classify an older annotation. |
| Original paired qualification | `40262330739` / job `121377165076` succeeded for the bound merge/deployment. Cleanup job was skipped; do not claim paired resources were removed. |
| Local regression | 2026-10-27: 35/35 focused tests passed (security 15, OAuth config 12, closure refresh 5, closure notice 3); all 15 extracted source/config files match original Git bytes before and after execution. Installed Next 16.4.0 / Vitest 4.1.11 differ from the candidate: this is bounded unit evidence, not a clean candidate build. Clean lockfile/lint/type/unit/build/audit and required integration checks must still run on the actual final source. |
| Ordinary IAB functional QA | 2026-10-26: normal fixture login; one unpaid synthetic QR order through Staff/KDS; automatic READY dialog; Staff cancellation automatically removes that dialog without manual close/reload. Reload retains cancellation. This is actual UI evidence on the original paired deployment. |
| Owned functional cleanup | Exact synthetic order `261026-003` and its unassigned, zero-attempt print job cancelled; UI active counts zero, cancelled history retained. No real payment, notification or physical printing. |
| Remaining required browser evidence | SW/fresh-document behavior, live API/SSE technical evidence and affected login/security/closure cases remain incomplete. KDS polling/connected UI text is not wire-level SSE proof; same-origin QR token testing is not a physical printed QR hostname test. |
| Policy successor checks | `11b7` security `40356391986` and paired `40356391736` succeeded. CI `40356391738` was cancelled at the 60-minute job limit after Playwright OS dependency installation occupied about 49 minutes. Eight WebPRNT cases and E2E shard 1's 35 cases passed; complete E2E, resilience and audit did not finish. Hosted Supabase cleanup succeeded. This is not full CI success. |
| New paired evidence | Merge `ddbe7097971add670044047a397d2d7f26cc7a97` has the complete `11b7` tree; deployment `dpl_CLpQcFZXvMcX4iEeNht9D4qQRvSZ` uses the same isolated backend. Original artifact `12667239755` is 325361 bytes, SHA256 `9750c110d69c3d7b533e87c07f1e54f50a1e0eab21c597303ce9376d32099ce0`; real QR session/order tracking and four viewport widths passed, with service workers explicitly blocked. |
| Recovery-control candidate | Negative regressions reproduced alias drift, unsafe recovery admission and configuration/source/build drift. Frozen v3 passed 178/178 focused Vitest cases, zero pending, plus focused lint and helper syntax checks. Its 16 selector metadata/absence bindings and 22 literal source scopes enter the immutable Plan verification. Provider inputs in these tests are stubs, not a successful hosted Plan/Apply; installed Vitest 4.1.11 differs from candidate ^4.1.12. Independent review is required before publication. |
| Final source checks | Every code successor needs its own required CI/security/paired results. Workflows have no docs-only skip. No old badge may be copied to its new SHA. |
| Recovery and protected publication | Verify compatible Primary-only recovery, current health and backend; then fresh application Plan/Apply with `retire_dr_runtime=false`, exact final main/staging tree and production environment protection. Not yet executed. |
| Completion | Actual deployed source/project/alias/backend readback, authenticated affected-flow QA, rollback if needed and exact owned cleanup. Not yet executed. |

The existing paired branch was read back during preparation: nondefault,
`with_data=false`, infrastructure `ACTIVE_HEALTHY`; Git integration metadata
remains `MIGRATIONS_FAILED`. Keep that metadata distinct from successful paired
CLI/SQL evidence. Reuse the verified branch; do not create a replacement or add
costs if it disappears. Its current existence is not a guarantee of future cost
or source identity; reread before triggering the paired workflow.

## Exact recovery provenance and configuration inheritance

The reviewed historical recovery is source
`4e95d2ea5d53ae78c5af9c3db044481237674c44`, deployment
`dpl_4v5acoGZU8tkbTAnb6uEwuN5AjJQ`. The original successful protected application
Apply is run `39652990080`, attempt 1, artifact `12369384806`. Its original ZIP is
1053 bytes with SHA256
`b5733866a393f483a2fc5fea36c78a861d932c87d98320232f33c23674c027b0`.
The two archived receipts bind application publication and removal of the five
Primary DR runtime bindings after smoke. A different recovery requires reviewed
source changes; a caller-supplied qualification flag is not accepted.

Current Production URL/credential settings are Vercel sensitive variables, whose
values are [write-only after saving](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
The candidate does not decrypt them or interpret an absent value as a match.
Instead it binds the qualified deployment's provider identity/environment names,
unique routing/credential metadata and optional-key absence, fixed-source
configuration inheritance, current build settings and fresh runtime readback.
Applicable configuration entries must predate the qualified deployment and have
no branch/custom/integration/shared scope. Compare the actual database, Edge,
Storage and Realtime selector sources, not only the public Supabase URL.

This is an explicit inference from trusted provider metadata and the reviewed
original deployment path, not cryptographic proof that private values are equal
or that every historical provider mutation was recorded. Deployment environment
names are not a complete runtime configuration dump. The original workflow's
three public-order CLI secret overrides are separate from that name list. Fields
absent from historical build settings are not claimed to match: constrain the
new build to the repository root and bind its current settings instead. These
limits do not replace fresh integration or authenticated affected-flow QA.

The [official project API schema](https://openapi.vercel.sh) confirms
`lastAliasRequest` includes the operation type, target, numeric request time and
pending/in-progress/succeeded/failed/skipped status. Current project readback has
that property with value `null`; no new promotion was made to test a terminal
state. The real operation must still be read back when the protected workflow
runs. Source or configuration drift, missing provenance, unknown operation state
and third-party alias changes all stop further release writes.

## Execution and stop conditions

1. Preserve all local dirty work. Prepare only the reviewed allowlisted files on
   the bound PR source without mixing the old preparation checkout into the release.
2. Complete permitted local and isolated Preview cases. Keep source/runtime
   limits explicit. The saved full_cdp denial is unresolved: no retry, alternate
   controller/origin, session injection or indirect denied-evidence capture.
3. Verify the existing paired resource and source before normal PR checks. The
   owner clarified on 2026-10-27 that necessary local Docker tests are allowed,
   with test-owned cleanup afterward. Existing hosted CI may retain its full
   Supabase/Docker coverage; never disable tests or post a manual success.
4. Merge only after required acceptance and checks pass. Refresh post-merge
   checks, promote the verified full tree to main, and verify actual equality.
   A source merge alone does not deploy Production.
5. Bind a fresh application Plan to the final source, complete prestate snapshot
   and exact qualified recovery artifact. The original normal path did not bind
   these inputs and could roll back to an unspecified previous deployment; the
   reviewed control correction must be installed before Apply. Reverify source,
   original artifact bytes, configuration, backend, epoch and aliases before
   writes. Unknown/pending provider jobs stop further writes. A failed promotion
   that left the baseline healthy makes no second write; otherwise require
   explicit recovery admission, one exact-target attempt and readback. Stop on
   third-party drift, missing evidence, an expired/consumed Plan or protection
   rejection. Neither a unit test nor a hand-written receipt satisfies this gate.
6. Apply only the application workflow, then verify Production affected flows
   and cleanup. Never invoke Production/DR schema/Edge/provider configuration
   workflows as part of this exception. The normal isolated paired workflow may
   apply reviewed migrations, provision Edge/test secrets and clean owned synthetic
   fixtures only in the named existing test branch. Do not create a replacement
   resource or add costs. Do not call the release complete before live QA.

The owner has already authorized the bounded release policy and routine execution;
do not request that authorization again. A saved platform denial requires a
supported resolution, not another release approval. Do not request secrets or
raw logs in chat. Support contact remains deferred.
