# PR389 alternative application release acceptance

## 2026-10-27 backend-target session supersession correction

CI on c1d9200e exposed a real QR regression: the closure refresh pending guard prevented the second session start required when the backend target changed. Both the initial E2E attempt and its retry failed. The minimal correction invalidates the old attempt immediately when its identity rotates, clears only the obsolete session token/readiness on a target change, and allows only the current attempt to release its pending guard. A closure still defers session creation; reopening starts once, preserving the cart and draft.

The four-file source-bound candidate adds six regressions (RED: 17 passed / 6 failed; GREEN: 54 passed / 0 failed / 0 skipped). Focused lint and strict extracted-source TypeScript pass. This is local harness evidence with the disclosed installed dependency versions, not a claim that hosted E2E passed. Independent review and fresh successor CI/security/paired acceptance are required. No test is disabled or timeout relaxed.

Predecessor c1 CI 40463782852 passed 3822 unit tests (9 skipped), 1619 pgTAP checks and 8 WebPRNT tests, but its executed E2E shards had 182 passed / 11 skipped / 1 failed. Later shards, resilience smoke and audit did not run; hosted Supabase cleanup succeeded. Paired 40463782773 and security/CodeQL succeeded. Ordinary Codex in-app browser on the source-bound paired deployment passed retained-document closure create/update/remove with cart preservation; normal expired-session refresh also restored the draft. The exact owned closure and cart were cleared, with no order/payment/shift created. These receipts retain their original source and do not qualify changed v3 runtime bytes.

Release remains incomplete: fresh successor tests, required technical service-worker/live API/positive SSE proof, protected staging/main promotion, immutable Plan/Apply and Production affected-flow QA remain mandatory. Official support supplied read-only follow-up questions; no supported saved-denial reset has been confirmed and no denied operation was retried. Production remains on 4e95d2ea. No local Docker/carpool operation or new paid resource occurred.


## 2026-10-27 full-suite contract correction

The first hosted successor CI (40462715519, source 34817a6f) passed installation, lint, UI control audit and typecheck, then reported 3821 unit passes, one failure and nine skips. The sole failure was the existing special-hours UI source contract still locating MenuNoticeDialogs in the server view after its client-boundary extraction. The contract now follows PublicMenuView to PublicMenuLiveContent to MenuNoticeDialogs and retains the existing reminder, storage, localization and QR assertions; no test is skipped or disabled. The original contract reproduced locally with three passes and one failure; the corrected contract plus the prior 44 affected regressions passed 48/48 with zero skips. Runtime implementation bytes are unchanged from the reviewed v1. Fresh hosted checks and actual retained-document E2E remain required.

## 2026-10-27 reviewed closure-freshness correction

Scope limit: live closure refresh requires the canonical public store identifier. The reproduced special-closure flow retains that identifier even while closed. The pre-existing degraded path that loads with businessStatus CLOSED or orderingState PAUSED can return no initial menu; a later full Edge session omits stall.code, so that path is not covered by this refresh correction. It is not a regression introduced here, must not be counted as accepted, and must not use a guessed slug as a public code. Completing it requires a separately reviewed canonical-identity contract; this successor does not change Edge or the recovery compatibility scope.

The nine source/test postimages in closure-refresh freeze v1 received separate correctness/spec and standards reviews with no remaining required correction. The local focused suite passed 44 tests with zero failures or skips; all nine candidate files passed ESLint with zero errors or warnings, and strict TypeScript checking of the extracted source closure passed. Three original consumer regressions and two delayed recovery cases first reproduced the defect. The shared refresh preserves existing cart/session state, and recovery completes before an initially closed QR can start its first session.

The source-bound local harness used installed Next 16.4.0 and Vitest 4.1.11; it is not a clean build of the candidate Next 16.4.2 and Vitest 4.1.12 dependencies. The actual retained-document browser regression is added but has not run locally. Fresh hosted CI/security/paired Preview and normal kept-open Menu/QR acceptance remain mandatory on this successor. Previous green checks and the failed deployed UI observation belong only to the predecessor. This review does not authorize bypassing a denied operation or declare release qualification.

## 2026-10-27 existing-page closure acceptance

Ordinary Codex in-app browser checks on paired merge `0facbae4992ad0dbaf6ff9c98b582704d6b2dcde`
(deployment `dpl_FmztqPwqWRTrXUqx3S9Vofis7pVk`) passed synthetic owner login and
owner/session persistence in a fresh document. An owned one-day closure displayed
on Menu and disabled QR ordering after normal navigation. Exact fixture deletion
persisted, but both already-open pages retained the closure approximately 99
seconds later while visible. Normal reload then removed the notice and restored
QR controls. No order, payment or cash shift was created. Existing-page closure
freshness is FAILED on that deployed source, independently of the saved browser
capability denial. A successful reload does not qualify automatic refresh.

Source review identifies static Menu server props and QR's retained initial
closure. The existing 30-second/visibility refresh applies to the order tracker,
not Menu/QR. The previous E2E opened customer pages after closure creation and
closed them before deletion, so it could not detect this failure. Required
regression keeps pages open across add/update/remove and preserves cart/session.
The exact nine-file application/test scope and three documentation files are
listed in the ADR-006 closure-freshness impact assessment. Its earlier eight-file
allowance belongs to the historical release-control successor; it is not a
source-equivalence claim for this closure correction.

The exact cd6f64cd/tree abcd5760 predecessor completed CI 40423247875, security
40423247871, separate CodeQL analysis 121923526621 and paired 40423247885. Original
counts were 3810 unit passes / 9 skips, 146 migrations, 1619 pgTAP assertions,
216 E2E passes / 40 skips, 8 overlapping resilience passes and audit zero. The
full tested merge tree equaled the source tree. Those results do not qualify
changed successor code; fresh checks and current deployed UI acceptance are required.

The owner-approved sanitized official support continuation has been referred to
a support specialist. No supported single-origin reset has been supplied and no
denied operation has been retried. Ordinary UI work continues; deployed SW
upgrade, cache behavior and positive SSE technical proof remain separate gaps.
Release qualification remains false. Protected staging/main checks, immutable
Plan/Apply and Production affected-flow QA are required after pre-release acceptance.

## Latest bounded successor evidence (2026-10-27)

Source `4d50033d77671ff45f7cee4348511c9da39697f9`, tree
`4fd9b0b5f1781536c0a4189f2b603b1db60153ee`: CI `40369697084` and paired
`40369697018` succeeded. The test-merge `d140ca53dd9f30329227eff4999c4845928dcd92`
has that same tree. Paired deployment `dpl_BrmJi52YSb7164ki3jTmkyzvxnx2` targets
the existing `teunnvfakbfzmodajqjz` backend. Original artifact `12674076073`
is 325383 bytes, SHA256
`07e1eb6dbfaa5e9ef2d7325e3ced45da3f34d0a3929bba154ca11be7f587ee57`.
Four viewport sizes and real browser QR/order tracking passed; this artifact
explicitly blocks service workers. Fixture reset/cleanup passed; infrastructure
cleanup was skipped and the existing isolated station remains available for QA.

The exact CI used Node 24.21.0 / Next 16.4.2 / Vitest 4.1.12. Results: 3790 unit
passes / 9 skips; 146 migrations rebuilt; 1619 pgTAP tests across 72 files passed;
8 WebPRNT passes; 216 E2E passes / 40 skips; 8 production-mode resilience passes;
zero audit vulnerabilities. Lint had zero errors and five warnings. Resilience
and some browser cases overlap, so these counts are not unique-case totals.
Hosted Supabase stop succeeded. Unit skips are opt-in public-order DB replay;
E2E skips concern opt-in retained local readiness, toggles, catalog amendments,
printer indicators and push announcements. They are not counted as passes.

`offline-pwa-foundation.spec.ts` exercised actual SW activation/controller,
offline reload, a new document in the same context, IndexedDB persistence and
real local sync API/DB behavior. Local closure, login/security and API cache
regressions also passed. These results do not prove the deployed Preview's old
SW upgrade, real OAuth providers or positive SSE Content-Type/frames. Those
required affected-flow and deployed-environment cases remain incomplete.

Security workflow `40369697004` succeeded in running CodeQL, but its separate
analysis check `121737883699` failed (two high, four medium). Alerts 72/73 refer
to array membership; the prior code already used exact-element equality. The
successor makes equality explicit and rejects noncanonical/duplicate DNS aliases
at both provider and persisted-baseline boundaries. Twenty added tests produced
17 failures before the correction; all 198 focused tests pass afterward.
Independent review accepted this bounded correction. This is local evidence
against installed Vitest 4.1.11, not a new hosted security result.

Alerts 74–77 identify approved snapshot IDs sent in fixed-origin provider GETs
and provider metadata written to JSON receipts. Their exact sources, sinks and
trust checks require documented review; this update does not dismiss alerts,
suppress rules, post success or change protection. Every source successor still
requires fresh CI, CodeQL analysis and paired qualification. The saved raw-CDP
denial is not retried. Release qualification remains false.

## Earlier evidence and adopted policy

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
