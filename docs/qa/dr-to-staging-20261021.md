# DR retirement into independent Staging — in progress

## User scope

The user authorized retiring the existing DR as Staging, and explicitly chose:
prove backup restoration first, remove only DR's old replicas, then use synthetic
test data. Preserve Primary, its business data, and other workspaces. No new paid
resources. Staging must not send real payments, LINE notifications, invoices, or
printer jobs. No data deletion is authorized by a failed backup run.

## Verified baseline and completed operations

- Primary Supabase: `eyuctbnlvnbnivwasvqr`, ACTIVE_WRITER, epoch 3.
- DR Supabase: `daeqwtpaxcebmtwxqdkj`, READ_ONLY_STANDBY, writes disabled.
- Primary Vercel: `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`;
  `dpl_CUDFLirEEGzfc633vnBPpXNeWWKW`, source
  `b651daba7014d540d7105a642ff0d7d5f3e2ded2`, `app.qidaigo.com`.
- DR Vercel: `prj_GOSwYN5rKhSuD3d4gPJEVtmKt7b3`, still the older DR deployment;
  no domain, environment, or deployment change made in this phase.
- 2026-10-21 21:35 Asia/Taipei: real Google owner login reached admin billing and
  health. App/current DB/DR connection checks passed; stale replication evidence,
  seven unverified checks and payment maintenance were existing gaps, not passes.
- DR-only migration `20261021133744` removed the already disabled, slot-detached
  `stallorder_primary_to_dr` subscription after confirming all 124 relations
  were ready and the standby writer fence remained enabled.
- Exact inactive/lost Primary slot of the same name removed with epoch 3 and
  writer-state guards. No publication or business data removed.
- Readback: no subscription/slot, DR still has 827 orders and 42 Storage objects;
  all nine DR scheduled jobs inactive. Primary availability remains NORMAL_PRIMARY.

## Separate Storage dependency

Database detachment does not stop `/api/cron/storage-replication`.
`storage-replication-service.ts` also deletes expired files from Primary. Do not
disable the entire cron or remove credentials without preserving Primary-only
cleanup. Before DR data removal, retire Primary-to-DR file replication and remove
DR eligibility from failover/routing. Current 48 MIRRORED jobs are historical,
not proof that future mirroring is disabled.

## Earlier backup attempts (superseded by the successful restore below)

The owner-only branch workflow uses existing GitHub Production secrets and the
same `production-dr-operations` concurrency group. It only reads the exact DR
session-pooler endpoint; all restore writes use a disposable runner loopback DB.
It captures public/auth/storage/app_private/internal/vault tables and actual
Storage bytes, encrypts with AES-256-GCM and the existing backup key, decrypts and
restores the data, compares every source-column table digest, verifies every file
byte digest, and fails on source drift. Artifacts must contain encrypted payloads
only, plus a non-sensitive verification receipt. An archive listing or successful
upload alone is not restore proof. Full provider/configuration/credential recovery
is not claimed by this data-restore check.

Run `39612421419` captured and encrypted 239 tables and all 42 files. Artifact
`12350673658` (9,432,858 bytes) was retained; archive SHA-256
`fda9a0020826d94c06b502b22a1573225c63b304e65efe2cdf7ca5f32715cb0d`.
The data-restore step failed with a missing database object before validation;
this is NOT a passing backup gate and permits no DR deletion. A corrected runner
schema setup is under verification.

Local regression: 26 tests across seven Storage/catalog/asset consumer files and
four encryption/target tests pass. Full unit suite: 555 files and 3,372 tests
passed, two files/nine tests skipped. Typecheck, Production build and the
335-file UI audit passed. ESLint has zero errors and five existing navigation
warnings. Dependency audit reports zero vulnerabilities. These checks do not
establish deployed Primary cleanup or Staging readiness.

## Provider access blocker and latest restore attempt

Read-only Cloudflare inventory run `39616131097` failed with HTTP 403. The local
token separately returned code 9109 (invalid access token). No DNS, Access or
Vercel environment mutation was attempted. The owner has been asked to update
the existing GitHub `production` environment `CLOUDFLARE_API_TOKEN` securely,
without posting its value or expanding its resource scope.

The older read-only operator Plan `39615795041` failed before provider access:
the workflow did not generate Prisma after install scripts were disabled. That
failure is not evidence of a Cloudflare provider read or a successful Plan.

Restore run `39615232670` captured the encrypted backup but failed with
`PSQL_FAILED_1_MUST_BE_OWNER`: provider-owned schemas cannot be replaced by the
ordinary local `postgres` role. Revision `5dc7090c` confines restore operations
to the exact disposable runner container's Unix socket and its local
`supabase_admin` role; it cannot target either hosted database. Run `39616803086`
completed with pre-data and data restoration passing, but post-data constraint
validation failed. A read-only check of every source foreign key identified
exactly one inconsistent relationship: 552 `print_jobs` reference three absent
`print_rules`. Every other checked foreign key has zero orphaned rows. A bounded
Primary read confirmed the three parent rule IDs still exist there; no parent
rows were copied, no constraints disabled, and no print jobs replayed or changed.
This source inconsistency means the full restore gate remains failed and DR
deletion remains prohibited.

The owner updated the GitHub environment secret at `2026-10-21T14:38:43Z`.
Fresh audit `39619054558` still received Cloudflare HTTP 403 / code 9109 at the
zone read (optional user-token verification returned HTTP 401 / code 1000).
Thus the updated value is not yet accepted; this is not a successful credential
repair. Chrome pages for the Cloudflare API Token manager and the exact GitHub
Production environment were opened for secure user entry. Browser page control
was unavailable; no credentials were read, entered or submitted by automation.

Pending: pass actual backup restoration; separately retire file replication;
prove effective permissions and synthetic seed isolation; convert Preview runtime,
domain and Access; real Staging user flows; final Primary identity and flow checks.
No Staging readiness or release completion is claimed.

## Latest credential retry (2026-10-21 22:55 Asia/Taipei)

The owner replaced `CLOUDFLARE_API_TOKEN` again at `2026-10-21T14:49:30Z`.
Run `39619054558` still reports attempt 1 as in progress although its only job
`119287272309` completed with failure before this update. GitHub refuses rerun
as already running, while cancellation reports the run is completed. That stale
attempt is not evidence about the new secret. Start a new GET-only inventory run
using a dedicated read-only concurrency group; keep the mutation workflow's
remote-writer lock unchanged. No DNS, Access, data or deployment write is part of
this credential check. Backup restoration remains a separate failed gate.

Fresh run `39621513322` on `7cdbccc313a5888662fcb4474fd82fa3f86570a2`
passed at `2026-10-21T14:58:17Z`: the exact zone/account, all three hostname DNS
queries and the existing DR Access application/policies were read successfully.
The optional user-token verification still returns 401/1000; it does not disprove
the successful account-scoped resource authorization. Staging DNS is absent.
No provider mutations were performed.

The restore correction now preserves the original dump and adds a separately
encrypted, recovery-only closure of exactly three missing print-rule references.
Their printer/tenant tuple already exists in DR. Primary access is a bounded
read-only Management API query, not a new database credential or JIT grant.
The original constraints, row fingerprints and file checks remain mandatory;
supplemental rows are checked separately and cannot overwrite original DR rows.
Seven encryption/target/recovery-scope tests pass, including rejection of extra
Production rows, columns and new parent dependencies. Actual hosted-runner restore
verification is pending; no cleanup or Staging readiness is claimed.

## Backup restoration passed (2026-10-21 23:10 Asia/Taipei)

Run `39622637596`, revision `f723fa03508faef492bbdd7b2d19ebb7927ff622`,
passed pre-data, data and post-data restoration with all original foreign keys
validated. All 239 original table fingerprints and 42 actual file byte hashes
match. The three separately encrypted recovery-only reference rows were verified
independently; no original rows were replaced and no constraints were disabled.
The receipt records `remoteWrites=false`, `primaryWrites=false`,
`recoveryOnlyReferenceRows=3`, `originalReplicaSelfContained=false` and
`fullProviderRecovery=false`. This qualifies the supplemented data archive,
not a self-contained original DR or full provider failover recovery.

Encrypted artifact `12356096664`, `dr-retirement-encrypted-39622637596`, has
archive SHA-256 `6ae89c2d763218cb051f8016af194049b486018f75450e3539a794e91a14b8b1`.
The artifact expires on `2026-11-20T15:10:54Z`; a durable encrypted local copy
(46 files) was also retained under this task's output directory. Its existing
key remains in the protected GitHub environment, never in the artifact or logs.
The disposable restore database was stopped. No hosted data was repaired,
deleted or seeded.

Draft PR #369 starts exact-revision CI and isolated Preview validation. Its first
CI run `39623361381` correctly rejected ambiguous literal test passwords in
the new target-guard test. They are now explicit non-secret placeholders; the
credential scanner and all target rejection checks remain unchanged.
Storage synchronization and Primary DR runtime bindings still exist. Cleanup,
synthetic Staging, domain publication and final live QA remain incomplete.

The paired Preview now includes `scripts/qa-primary-only-storage.ts`: actual
Storage upload/read, a real database-backed retired replica cancellation, and
Primary-only deletion with an empty API listing. It rejects both live projects,
the parent project and mismatched API/database targets before fetching a key or
writing. Only the current isolated branch's service key is used, in process;
no shared Preview secret is changed. Exact synthetic object/job/manifest cleanup
runs on success or failure. The CLI rejects a local invocation; target guard
tests, typecheck and lint pass. Its hosted execution remains pending.

## Isolation prerequisite follow-up (2026-10-21 23:56 Asia/Taipei)

Preview `39627518399` passed its migrations, database tests, lint and Edge setup,
then stopped before Storage access because the new CLI's explicit Preview runtime
guard was not wired into the workflow. A red regression reproduces the missing
`VERCEL_ENV`; the step now supplies `preview` without weakening any target check.
Service-key selection also follows the existing modern/legacy key contract and
requests explicit reveal only in this isolated process. Hosted Storage QA must rerun.

The application release's optional DR retirement mode now binds a sanitized
Primary prestate snapshot into its existing immutable approval parameters. Only
the exact Production-only DR bindings may be removed, after the reviewed
Primary-only deployment and live smoke; unrelated bindings are checked before
each deletion and afterwards. A mismatched project, revision, artifact, shared
environment binding or changed snapshot fails closed. Recovery uses the exact
healthy prestate artifact, not an arbitrary previous deployment. This code has
focused guard/workflow tests, but no hosted Plan/Apply has executed it yet.

At 23:55, Primary remains revision `b651daba7014d540d7105a642ff0d7d5f3e2ded2`,
`NORMAL_PRIMARY`, epoch 3, with QR and Staff availability unchanged. No DR data,
runtime binding, domain or provider policy has been removed in this phase.

CI `39627518344` also caught a real dependent-flow regression: the offline permit
journey requires a Storage manifest even when DR is absent. The initial early
return suppressed that Primary metadata along with replication. Preserve the
manifest/checksum/content type and cancel only replication jobs; under the existing
schema, its replication status stays `FAILED` with `DR_REPLICATION_DISABLED`, never
claims `MIRRORED`, and clears stale DR checksums. Primary asset reads/deletions keep
their existing contract. The original offline E2E assertion is unchanged; a focused
red regression now passes. Hosted Storage QA also requires the retained manifest.
Local full units passed 3383 before this correction; 15 affected tests/typecheck
are rerun after it, and current full CI/Preview remain required.

After the manifest correction, full local verification passed again: 557 test
files / 3383 tests (2 files / 9 pre-existing skips), typecheck, targeted lint,
Production guardrails (2310 tracked files / 146 migrations), both workflow YAML
parses, and the Production build. These are local checks, not hosted-flow or
release completion evidence.

## Original Storage path recovery (2026-10-22)

The v2 archive retained all file bytes and the database's Storage paths, but its
file manifest reused `name` for the encrypted filename. Version 3 explicitly
retains `objectPath` separately, checks an exact bijection against the restored
`storage.objects`, restores bytes under their bucket/original path in the private
runner directory, and reads each file back. These plaintext files are not
published as artifacts. Existing encrypted archives remain unchanged.

The object-path regression failed before implementation, then all eight backup
tests and lint passed. A fresh hosted backup/restore run is still required before
claiming this added recovery proof. Both permitted task-owned branches retain the
same repository-owner, exact DR target and read-only source guards. No hosted
cleanup is part of the backup workflow.

The isolated rehearsal additionally runs the pinned Supabase CLI's remote-reset
SQL path against only the restored runner database, then replays the unchanged
migrations and synthetic seed. The CLI preserves Vault, so old Vault rows are
removed from this disposable copy before scheduling functions are recreated;
all recreated cron jobs are then left inactive. The temporary CLI configuration
uses a different local port so it cannot select Docker-volume reset. This uses
the local administrator and simulates already-confirmed Storage API deletion;
neither hosted permissions nor actual hosted cleanup are claimed by the rehearsal.

Run `39634669875` passed the v3 restore checks for 239 tables and 42 files,
including original-path readback. Its encrypted artifact `12361565729` is also
retained locally; GitHub retention ends 2026-11-20T16:31:03Z. The later rehearsal
run `39636020159` passed capture/restore/verification but failed the reset step.
Its generic sanitized error does not identify a cause. Stage-specific safe error
codes and a no-secret regression test were added; no hosted reset or seed is
authorized by this unsuccessful rehearsal result.

Run `39637555240` isolated that failure to the CLI remote-reset connection, before
reset SQL. Pinned CLI `internal/utils/connect.go` rebuilds URLs without `sslmode`
and refuses a TLS-to-plaintext fallback. The loopback-only child environment now
explicitly sets `PGSSLMODE=disable` after removing hosted credentials. Hosted
connections retain required TLS. This does not bypass any migration or assertion;
the actual rehearsal must pass before using its result.

Run `39638904977` progressed past connection and failed with `MUST_BE_OWNER`
(`42501`). CLI remote reset steps `supabase_admin` down to `postgres`, while
`pg_restore --no-owner` had made all restored application objects administrator-
owned. A read-only hosted inventory confirmed 208 public relations owned by
`postgres`, 28 auth relations by `supabase_auth_admin`, and eight storage relations
by `supabase_storage_admin`. The restore now retains archive object ownership and
the three known application schema owners. ACL/provider recovery is still not
claimed, and the normal CLI role/migration checks are not bypassed.

Run `39640190911` retained owners and passed restore/data verification, then
failed reset with `PERMISSION_DENIED_42501`. The restore had still discarded
archive ACLs. It now restores those original grants as well, with a regression
test that disallows stripping owners or ACLs. No extra superuser grant or hosted
permission change is introduced. Hosted cleanup remains blocked on rehearsal.

Run `39641543978` passed the ACL-preserving restore, then advanced to a duplicate
relation error (`42P07`) during remote reset. Diagnostics now expose only an
identifier already present in the disposable database catalog and the migration
filename, never SQL/data/credentials, to identify the remaining conflict precisely.

Run `39643629498` isolates the actual error to `invoice_number_seq`, in migration
`20260718224537_commercial_billing_phase1_core`. Supabase CLI 2.109.1's
`apps/cli-go/pkg/migration/queries/drop.sql` filters sequences using lowercase
`relkind='s'`; PostgreSQL stores sequence kind as uppercase `S`. Consequently the
standalone invoice counter survives the CLI reset. The retirement preparation
now explicitly drops only non-extension public sequences on the offline copy
before replaying the unchanged migrations. The eventual hosted action must use
this same preparation only after the backup/Primary-isolation/target guards.
No historical migration was edited and no Primary sequence was touched.

Run `39644728498` exposed a preparation boundary: identity sequences cannot be
dropped separately from their owning columns. Preparation now excludes extension,
owned and identity dependencies (`e`, `a`, `i`); the CLI removes owned sequences
with their tables. A transactional SQL regression on the disposable restore
creates both an identity-backed table and a standalone sequence, proves only the
latter is removed, then rolls back before the actual reset rehearsal.

## Qualified restore and Primary isolation (2026-10-22 02:32–02:54 Asia/Taipei)

Backup run `39647447270`, source `291c3c56f1dc6ed743f9c7fe67a117f2dac554ff`,
passed all 239 table and 42 original-path file-byte checks, original constraints,
and an actual pinned-CLI remote-reset SQL rehearsal under the ordinary `postgres`
role. It replayed 146 unchanged migrations and synthetic seed: two organizations,
ten test orders, zero real orders/Auth users/files/Vault/subscriptions/active cron,
and no enabled printer or non-cash payment. Only the disposable bootstrap/restore
uses the local administrator; no hosted grant elevation is introduced.

Artifact `12368487539` expires `2026-11-20T17:56:32Z`, with SHA-256
`fbab2a1c9b481c60ad4e8d67442c1842055ec72ba0f12d09c18f34ee324f5cd9`.
An encrypted local copy and its receipts are retained in the task's output folder.
The archive still needs the separately checked three-row recovery supplement;
it is not a full provider/configuration recovery claim.

PRs #369/#370 and source/Staging/main CI, Preview, security, remote DB readiness,
and application Plan `39647622492` passed. Application Apply `39652990080` passed:
Primary is now `4e95d2ea5d53ae78c5af9c3db044481237674c44`, deployment
`dpl_4v5acoGZU8tkbTAnb6uEwuN5AjJQ`. The exact five Production DR bindings were
removed after live smoke; unrelated variables, Primary backend and epoch 3 stayed
unchanged. Actual authenticated health, dedicated Staff/SSE and print-center
pages loaded, without changing customer orders/cash/printing. The workflow's
valid Production QA QR page/session passed. Use this Primary-only artifact as
the recovery baseline after cleanup, never the earlier DR-capable deployment.

Phase B implementation is not hosted conversion evidence. It includes strict
provider scopes, source/backup drift guards, independent Auth/Edge/Preview runtime,
actual Storage deletion readback, reset/seed/DB tests, origin TLS/JWT checks and
real password/catalog/QR/Staff/KDS browser acceptance. The old public default
alias `stallorder-dr.vercel.app` currently responds 200 and must be detached before
unfencing synthetic data; the generated old deployment responds with Vercel SSO.
Legacy DR publishing/replication workflows now fail before their approval or
mutation jobs, and direct target reconfiguration is refused.

No hosted DR files/data/Auth/Edge/DNS/Access changes have occurred at this checkpoint.
Pending: candidate CI/Preview and promotion; fresh conversion Plan/Apply; human
Access login and ordinary browser/SW QA; persistent independent Staging release
and schema predecessor; final Primary invariance. Do not report complete Staging.

## Conversion execution and CI race regressions (2026-10-22 03:35 Asia/Taipei)

Paired Preview `39657700424` passed. CI `39657700365` failed on the existing
schedule-concurrency test at a minute boundary; its successful retry is not a
passed release gate. An actual local third transaction running the cron function
reproduced `OPEN` instead of `COMPLETED` deterministically: targeted entry points
use `SKIP LOCKED`, so they can finish while cron still owns the closing commit.
The test now retains its lock/deadlock assertions and all three terminal states,
adds this real cron interleaving, and waits for committed observable state under
the unchanged expectation deadline. Both scenarios passed 100 runs with no retry.
No application code, migration, or cron schedule was changed for this test fix.

The full hosted SQL suite was observed taking 12–13 minutes, longer than the
conversion subprocess's ten-minute bound. Conversion now passes every recursively
discovered SQL file to the pinned CLI in ordered batches of at most 20. The bound,
workflow budget, SQL assertions and failure handling are unchanged. A red process
boundary regression reproduced the unbatched timeout; coverage and fail-closed
tests passed. Actual CLI batches on owned local DB 57042 passed all 72 files and
1,619 assertions. Focused unit tests 12/12, typecheck, targeted lint and production
guardrails passed. The temporary DB is stopped after this verification; unrelated
LINE DB 56863 is retained. No hosted DR data/files have been removed.

Fresh public Production readback remained revision `4e95d2e`, NORMAL_PRIMARY,
PRIMARY epoch 3, QR/Staff AVAILABLE and login 200. New candidate cloud gates remain
required; none of these local checks qualifies a completed hosted conversion.

## Post-merge hosted QR gate (2026-10-22 04:22 Asia/Taipei)

PR371 merged normally as `179a26ba5e361596eff1bf5b0cb2934c13646312` after exact
candidate CI `39663146479`, Preview `39663146402` and security `39663146544`
passed. Its tree equals candidate `6329bd3` and paired Preview merge `27e5074`:
`034a2990fa2b84a36bc69651f13a8a7f29b8b9a5`. Actual Chrome password login,
workspace, Staff/SSE, Print Center and KDS succeeded on paired Preview
`dpl_7YNmafP7SZHQezvUs6YC4Dvvfu1c`.

Actual QR entry then failed with HTTP500. The isolated branch's Edge logs identify
`Missing required secret: ABUSE_HASH_SECRET`; this was not a Production failure.
The workflow deployed Edge functions without their independent order secrets;
its OAuth/delivery-only smoke did not exercise QR. Promotion is paused for this
real failure, despite the preceding green workflow. No hosted DR data/files or
provider settings have been removed or changed.

The scoped follow-up supplies random Preview-only abuse/token secrets to both
Edge and application, digest-verifies provider readback, keeps official Turnstile
test keys restricted to explicit test runtimes, and adds hosted browser QR
session → four responsive widths → mobile order → tracker validation. The same
target guard rejects both live projects and mismatched DB/API bindings. Browser
QA uses only the seeded merchant, disables its printers, marks its new order as
test-only and removes exactly that order. No real credentials or external effects.
Provisioning/workflow regressions failed before the fix and focused tests pass;
new hosted execution remains required and is not yet recorded as passed.

### Preview session contract correction (2026-10-22 04:56 Asia/Taipei)

PR372 run `39670467150` passed actual Edge configuration digest readback,
database/Storage checks and deployment, but the new browser assertion rejected a
valid idempotent session HTTP200. Vercel logs show the same operation first
returned201 at20:50:55Z, then200 at20:51:03Z after the browser retry. The public
session contract explicitly permits this replay. The assertion now requires
200/201 plus a valid session-token shape, unexpired timestamp and DEFAULT mode;
error, expired and order-resume bodies remain failures. Regression reproduced
the incorrect rejection before the fix. No application retry or timeout changed.
Normal Chrome on paired `dpl_sqXhmbfLwxfuMMr6uBd91tCGyn6D` completed a synthetic
QR order, displayed its tracker, confirmed it through Staff and observed the
same order in KDS with SSE ready. Only that exact test-marked order was deleted;
readback found zero matching orders/print jobs. No payment or printing occurred.
CI `39670467211` passed. The full automated mobile/responsive rerun remains pending.

### Current Preview and dependency gate (2026-10-22)

Preview `39674978026` passed on candidate `501c540`, paired merge `fadf342` and
deployment `dpl_Gfuh4RgkACDY9ZUNmGceVGiKoT2B` with isolated backend
`yorwbxvcflxygmrvtuys`. Artifact `12381668301` confirms actual QR session,
320/390/768/1440 layouts, mobile checkout and tracker; downloaded screenshots were
visually checked. Normal Chrome password login, workspace, Staff/SSE, disabled
Print Center and KDS/SSE passed without injected protection headers.

CI `39674977886` passed unit and Chromium/WebKit E2E tests, then failed the native
dependency audit on newly indexed `@vitest/mocker` advisories
`GHSA-qxg6-89mg-rqv8` and `GHSA-xp26-3454-mjgp`. Local `npm audit --json`
reproduced two moderate findings. Upstream's 4.1.12 release fixes both; update
only Vitest and its seven version-coupled packages, preserving every other lock
entry and the default-deny install-script policy. Clean `npm ci --ignore-scripts`,
native audit (zero findings), 517 registry signatures / 155 attestations,
typecheck, production guardrails, build, UI audit and 3,424 unit tests passed
(nine existing skips). Lint has zero errors and five existing navigation warnings.
This is test tooling remediation,
not evidence of a Production exploit. The patched candidate still requires new
cloud gates; the earlier green Preview does not override the failed audit.

Cloudflare readback `39621513322` attempt 2 passed at 21:09:33Z using the currently
stored Token. Exact Primary DNS and old DR Access identities remain unchanged;
Staging DNS is absent. Actual edit capability remains a protected-entry step
before deletion. No hosted DR data/files/provider mutation has occurred.

## Conversion preflight correction (2026-10-22 08:10 Asia/Taipei)

PR372/Staging and PR373/main gates passed with equal tree
`378ec32fa2a6e0952ba70f31edb643494a292a0f`. Main `f9823db6` CI39693537032,
readiness39693537025 (including read-only Primary remote checks), and
security39693537024 passed. Both paired Preview environments were cleaned and
independently read back absent. Production remains the qualified Primary-only
`4e95d2ea` artifact; no new application promotion is part of this conversion.

Read-only Plan39696458946 stopped before any provider/data mutation. Bounded
diagnostic39697214006 located authenticated decryption failure. The backup writer
uses the original password bytes, whereas the conversion reader trimmed them.
An actual AES-GCM regression reproduced the same failure before the fix. Keeping
the original bytes (without rotating the password or weakening authentication)
resolved it: read-only diagnostic39697720424 passed qualified backup verification,
Primary preservation, all original DR data fingerprints and Cloudflare/provider
prestate at2026-10-22T00:07:39Z. The temporary diagnostic workflow was then removed;
its immutable Actions records remain. No credential value entered its logs.

Vercel's current documented Standard scope protects Preview custom domains too.
The old runtime path had no exact-alias exception and a provider-contract fixture
reproduced `STAGING_ORIGIN_TLS_NOT_VERIFIED`. The correction transfers only the
verified Staging alias to Cloudflare Access plus the existing origin JWT guard;
project-wide Standard protection is unchanged. Tests cover the actual request
boundary, source/project/host/target negatives, required exception readback and
revoke/proxy restoration on anonymous exposure. This is fixture evidence, not a
completed hosted handoff. New candidate cloud gates, a fresh Plan/Apply, actual
Access login and persistent Staging acceptance remain required. DR still has its
827 old orders and42 files; none has been deleted.

## Pre-data entry failure and bounded recovery (2026-10-22)

PR374/Staging and PR375/main passed their complete gates and paired browser QA;
main `5efed50aa9519bfd65a81ce2280fe1ad28452b92` and Staging `d5682978` share
tree `cb3343bbd7e386af58008ead64eb9382001351c2`. Main CI39704626454,
readiness39704626509 (including remote checks), and security39704626621 passed.
Both paired Preview resources were independently confirmed removed.

Plan39707497864 passed. Apply39707738186 stopped with `STAGING_VERCEL_HTTP_404`
after immutable-Plan and original-data validation, before any provider isolation,
Storage deletion or database reset. Its saved entry was ready, but both old
aliases remained. Finally removed the temporary service-token policy/token.
Read-only diagnosis39709279580 revalidated the qualified backup, all239 original
table fingerprints, Primary, all prepared-entry GET routes, both alias name/UID
reads and temporary-token removal. Thus this is not a remaining Cloudflare Token
read/edit-permission failure. The original generic error did not expose its path;
the alias deletion by hostname is the remaining suspected failure point.

The correction deletes the immutable alias UID and rechecks its actual host,
project and UID at the write boundary. A provider-boundary fixture reproduces the
hostname404 and verifies the canonical path; hostile Primary/host/UID cases must
make zero deletion requests. Failed requests now log only safe method/path/status
metadata. Focused51/51 and full3440 tests pass (nine existing skips), but these
fixtures do not yet prove a successful hosted delete.

The failed run's new Staging domain, DNS and Access app were identified by source,
immutable Plan and exact resource IDs, then removed in that order using existing
authenticated provider UI. No new rollback workflow or credential was needed.
The old DR aliases, DNS/Access and data were preserved. Independent read-only
run39711025735 passed at02:27:56Z: qualified backup, all239 fingerprints, full
original Primary snapshot and provider prestate equal immutable Plan39707497864;
the temporary QA token is absent. ESLint, typecheck and Production guardrails
pass; dependency audit passed with zero findings after one network retry.
Subsequent source gates, fresh Plan/Apply and real persistent Staging acceptance
remain required. Production stays on `4e95d2ea`.

## Auth isolation contract and second pre-data recovery (2026-10-22)

PR376/377 and their source/paired Preview/browser gates passed; main `e03e41a6`
and Staging `da5a8963` share tree `cf7ffe15fcc79f3ba5b222073152fed2b0dae355`.
Main CI39721290882 passed3440 unit tests (nine existing skips),72 SQL files with
1619 assertions, eight WebPRNT browser tests,204 E2E cases (40 environment skips),
eight resilience cases and the dependency audit. Readiness39721290917 and source
security39721290895 passed. Both paired Preview resources were removed and their
absence independently verified; none of this redeployed the Production app.

Fresh Plan39724497044 passed against backup39647447270. Apply39724729839 completed
Plan/data verification, prepared the protected Staging entry and successfully
detached both old aliases by UID, then failed at Supabase Auth PATCH400. No provider
isolation completion, Storage cleanup or database reset occurred. Full readback
39725900699 verified unchanged original239 table/file fingerprints, Auth/Edge
digests, Primary snapshot and removal of the temporary QA token.

Bounded API reproduction39726312396 returned the exact validation errors: empty
Hook URI strings are invalid, and empty Hook secrets are not Standard Webhooks
secrets. The provider's documented nullable fields correct that contract. A
subsequent no-op probe39726852632 exposed a separate402: configuring even disabled
MFA/password-verification Hooks requires an unavailable paid capability. No
billing was enabled. The correction omits already-disabled/empty Hooks, clears
configured Hook fields with `null`, and verifies both changed and omitted Hooks.
Real API39727195797 accepted the already-empty email-Hook nullable contract200;
all Auth/Edge/data/Primary fingerprints remained unchanged. This is provider
contract evidence, not complete Staging acceptance.

Regression tests exercise the real isolation request/serialization/readback seam:
the original implementation reproduces400, the partial null-only fix reproduces
402, and the final correction accepts null/empty normalized readback while
rejecting reactivation of an omitted Hook before any Edge mutation. Focused
isolation tests8/8 and the four conversion suites23/23 pass; lint passes.
The final local suite passes3443 tests with nine existing skips; typecheck,
Production guardrails and the native dependency audit (zero findings) pass.
New cloud gates and persistent Staging acceptance remain required.

The two old domain mappings were recreated with their original no-redirect,
no-branch settings. Both aliases read back their original UID, project and
deployment; the generated old deployment remains Standard-SSO-protected.
Creation timestamps/order differ, so the old Plan cannot be reused. The failed
run's new Staging Vercel domain was removed, then bounded recovery39727943086
removed only its new DNS/Access at05:26:15Z. Its receipt verifies all original
table/file fingerprints, Auth, Edge, Primary and provider prestate, except the
explicitly recreated domain metadata. Artifact12403223556 SHA256
`ab465e8808c5998a370c7ca5b760edbc6df91c92eb235964ec61d7866211c996`
records old/new domain digests and requires a fresh Plan. All temporary diagnostic
workflows were removed before promotion. Original827 orders/42 files remain
intact. Production stays on `4e95d2ea`, with an actual authenticated QA
Print Center reload passing at13:15; no printer/job mutation was performed.

Official contract:
[Supabase Auth configuration API](https://supabase.com/docs/reference/api/v1-update-auth-service-config),
with schema inspected at upstream commit `b8483fc454ed2d6fb2b3637fc5da928bc9b1ff6b`.

## Nullable provider credentials and third pre-data failure (2026-10-22)

PR378/379 were normally merged; main `16a991fff` and staging `205836e5` share
tree `81ce08f2269c0c8da7ec2c87ecac0b092e8a14b8`. Their six push gates passed and
both paired Previews were independently confirmed absent. Main CI39735278262
attempt1 stopped at a native Supabase Edge Runtime1.74.2 SIGBUS/exit135, without
an observed assertion failure. One bounded full-job repeat passed; its cause
remains unknown and is not claimed fixed. These gates qualify that source only.

After the user completed ordinary Chrome login, the actual authorized Staff,
Merchant dashboard, Print Center and reload, and public menu were verified.
The merchant's KDS was configured OFF and was not changed. The old dedicated QA
stall returned404 and was not recreated or counted as passed. No real order,
payment, notification, setting change or hardware output was performed. User-tab
discovery/claim, not an empty automation-owned tab list, found the logged-in page.

Fresh Plan39743118579 bound backup39647447270, original data/files and provider/
Primary prestate. Apply39752454954 failed at09:04:54Z with
`STAGING_AUTH_ISOLATION_FAILED`: the Auth PATCH had succeeded, but readback failed.
Its only completed checkpoints were immutable Plan, original data matches backup,
and protected entry/token permissions. Old aliases were detached and the new
protected entry existed; no Edge rotation, Storage deletion, Vault cleanup or DB
reset was reached. This failed Plan is consumed, even before its expiry.

Source-bound diagnostic39754926641 verified all239 original table/file
fingerprints, unchanged Edge and complete Primary snapshot, and absence of the
temporary QA token/policy. Twenty-seven OAuth/SMS secret fields returned the same
nonempty64-character hex value after empty-string clearing, including previously
null fields. It was not any tested empty-string/null placeholder digest; no
particular hash or redaction algorithm is asserted. All external providers and
Hooks remained disabled. The pinned official update schema marks all48 selected
credential/client-ID/URI fields nullable.

The regression first failed at the real isolation request/readback seam, then
passed after replacing non-Hook empty-string clears with JSON null. It also
rejects retained secrets and reactivation of omitted Hooks before Edge writes.
Four focused suites pass22 tests; full local Vitest passes3444 with nine existing
skips, and typecheck, ESLint (zero errors/five existing navigation warnings),
335-file UI audit, Production guardrails/build and dependency audit (zero findings)
pass. New cloud/source and
persistent Staging acceptance remain pending; local tests do not replace them.

Single-field live probe39755641345 cleared only the originally-unused, disabled
Apple secret with null; actual readback was empty and every unrelated Auth field,
original data/file fingerprint, Edge and Primary remained unchanged. Artifact
12414744132 SHA256 `9a7c6e5f3eef5e42a1816232320be96274cbbb7997c7843810c09e282956ec6d`
is provider-contract evidence, not Staging acceptance. Recovery39756449992 then
stopped before provider writes because the archived Google credential could not
be verified as plaintext. It must not be reused as a password or reactivated.
Bounded recovery39757480156 passed: it retained Auth isolation, cleared only the26
remaining opaque fields, and proved every unrelated Auth field unchanged. Each
checkpoint read back the complete original Primary snapshot. Both old aliases
again match their exact original UID/project/deployment; generated-origin SSO and
old Cloudflare owner/IdP restrictions remained in place. Only the failed run's
new Staging domain, DNS and Access app were removed. Original239 table/file
fingerprints and Edge metadata still match; no hosted data cleanup occurred.

Recovery artifact12415734782 SHA256
`c9df5d728075f513adc85ec6423e05526f29af6af889483339f5384449b9e25b`
records retained-isolation Auth digest
`38836d3faa0e6080183332f0a109f472815c77457e5cdbae31ef648772d44773`
and changed domain recreation metadata, not full original Auth restoration.
Independent Supabase/Vercel readback confirmed that Auth/Edge digest, both old
aliases, absence of the new domain, and unchanged Primary deployment. Primary
version/connectivity/login returned200 and the authenticated Staff page remained
usable. Local Cloudflare credentials were rejected; no retry or credential
change was performed. Cloudflare deletion/isolation evidence is the protected
recovery run's actual final readback, and the next fresh Plan must verify it again.
The one-off diagnostic/probe/recovery workflow was removed before PR promotion.
No local test servers or Docker resources were started for this correction.

## PR381 Storage lookup diagnostics (2026-10-22)

PR380 was normally merged to staging `e5fee2a9`; its CI, security, paired
Preview and ordinary Chrome acceptance passed, and its exact Preview resources
were independently confirmed absent. Staging Readiness passed `verify-local`;
`verify-remote` was skipped by the workflow's main-only condition, not passed.
PR381 promotes that tree to main. Its CI39766797888 and security39766797885
passed, but paired Preview39766797866 failed twice and promotion remains blocked.

Attempt1 reported `STORAGE_QA_KEY_LOOKUP_FAILED` at11:14:12Z. A single bounded
same-source full-job repeat reported the identical failure at11:38:50Z. Both
failed on the non-2xx Management API key lookup for isolated branch
`ynpvrihsukkhjojyeovr`, before selecting a key, importing Prisma, uploading a QA
object or writing a manifest. Reviewed migrations, complete SQL tests, DB lint,
Edge configuration/deployment and always-run synthetic fixture cleanup passed;
matching Vercel build/deploy/browser checks were skipped. There is no third retry.
Original HTTP statuses were not recorded, so neither an authorization failure,
rate limit nor provider outage is established. A workstation GET returning200
does not explain a different runner's failure. No credentials were rotated or
permissions widened, and the original DR data remains untouched.

The narrow diagnostic correction retains the same fixed failure code, exact
target/invocation guards, single request, redirect rejection and20-second timeout.
It logs only the numeric HTTP status, content-type category (`json`, `html`,
`other`, `none`), and a decimal Retry-After bounded to0–86400 seconds or null.
It never logs response bodies, status text, URLs, cookies, arbitrary headers,
connection strings or credentials. It does not retry or treat any error as pass.

Tests invoke the real CLI entry function through Node fetch and disposable
loopback HTTP responses401/403/429/503. The old implementation failed all four
diagnostic assertions; the correction passes all seven focused tests, including
the three existing target/workflow guards. Malicious body/header placeholders
remain absent from logs and each case makes exactly one request before stopping.
Each loopback server is closed, with no Docker or application service started.
Full local qualification passed3448 tests with9 existing skips, typecheck,
focused/full lint (0 errors,5 pre-existing warnings), build,335-file UI audit,
2335-file/146-migration guardrails and dependency audit (0 vulnerabilities).
This fixes missing diagnostic evidence only;
the hosted failure cause, fresh paired QA and persistent Staging acceptance remain
unresolved. New source-bound cloud gates are mandatory before promotion.

Primary provider/revision/connectivity and the user's actual authenticated Staff
page remained unchanged after the second failure. No real orders, payment,
notification, printing, DR cleanup, conversion Plan or Apply were performed.

## PR382 database readiness and closure refresh (2026-10-22)

PR382 head `7e0d1a9b` did not qualify: security39773689383 passed,
CI39773689372 failed its fail-on-flaky policy, and paired Preview39773689379
exhausted database readiness at12:06:44Z. The always-run fixture cleanup also
failed with a connection timeout, so cleanup is not counted as passed. Reviewed
migrations/seed/Storage QA and matching Vercel deployment were not reached.
The exact data-less Preview branch is `6f83e16e-b536-4ba4-89d6-7bafcf7e58c2`,
ref `gosaisubfevcvekewdye`; no reset, restart or blind retry was performed.

The provider reports ACTIVE_HEALTHY separately from automatic Git migration
MIGRATIONS_FAILED. A bounded management `select 1` and a workstation session-pooler
`select 1` succeeded; the latter used the CLI-returned exact branch configuration
and completed in956ms. These do not explain the earlier runner timeout. Log
aggregates for11:50–12:10Z contain7 PostgreSQL timeout matches, but detailed log
queries returned backend errors and no specific cause is established. Do not
rotate credentials, increase deadlines or weaken checks based on this evidence.
The next source-reviewed gate preserves60 probes, five-second spacing and two
consecutive successes; only its final captured CLI failure is classified into a
fixed enum. Raw output, DSNs, credentials and hostnames never enter that diagnostic.
The real diagnostic entry-point test verifies redaction with secret placeholders.

CI's existing `local-order-experience.spec.ts:115` preorder test failed at its
final withdrawn-notice assertion (expected0, received1). Its built-in retry
passed, but the required workflow still failed; no run artifacts were uploaded.
The actual component effect reproduces the failure deterministically when a
visibility refresh arrives while a pre-withdrawal snapshot is in flight: the
refresh was dropped and the old notice remained until the30-second poll.
`npx vitest run src/components/public-order-closure-notice.test.tsx` first failed
that exact stale-notice assertion. The minimal correction remembers one pending
refresh and executes it after the active request settles, without overlapping
requests or running after unmount/while hidden. Five component cases now pass;
the three closure-domain and one tracker-abort cases also pass. No order state,
localization, layout, authentication, billing or hardware path was changed.

The original browser case now holds one real API snapshot, withdraws the closure
in its synthetic database, requests refresh while the response is held, then
releases it. All existing order-preservation, popup, focus, viewport and notice
removal assertions remain, with no increased deadline, retries or skipped check.
Its fresh full browser execution is still required; unit evidence is not a
substitute. Primary provider/version/connectivity remained unchanged. No local
Docker or application services were started; the unrelated pre-existing
`line-booking-test-20261004` container was left untouched.

Final local qualification for this follow-up passed3463 tests with9 existing
skips (571 passing test files,2 skipped), full lint with0 errors and5 pre-existing
navigation warnings, typecheck, build,336-file UI audit,2338-file/146-migration
production guardrails, and dependency audit with0 vulnerabilities. This includes
the real diagnostic CLI redaction test. It does not establish hosted database
recovery or browser success. The final diagnostic retains the last failed probe
even if the60th probe succeeds once; a lone success must not meet the two-success
gate. Primary provider/version/connectivity were freshly rechecked unchanged
at12:37Z, and both other work threads remained idle. Fresh hosted CI, paired
Preview and ordinary Chrome acceptance are still mandatory on the new source.

## Printed QR warning locator (2026-10-22)

PR382 subsequently qualified on head0a4456ea, tree04d0924e: CI39779783265,
security39779783281 and paired39779783308 passed. The delayed-response closure
E2E passed at12:59:25Z without a flaky retry. Ordinary Chrome login, Staff SSE,
Print Center reload with zero jobs/printing disabled, and KDS mode/reload passed.
PR382 merged normally at13:13:14Z into staging5ac6456f, with the same tree.
Cleanup39784933768 succeeded; independent Vercel404 and Supabase branch absence
were verified at13:16:10Z. Prior provider failure causes remain unknown.

Post-merge CI39784933379 nevertheless failed its unchanged fail-on-flaky gate.
At13:23:05Z the existing `catalog-operations-local.spec.ts:149` assertion selected
two alerts: the correct disabled-dine-in warning and Next.js's empty
`__next-route-announcer__`. This is a strict-locator violation, not evidence that
the warning was missing. The built-in retry passed, but the workflow failed;
its artifact list is empty. Staging Readiness39784933388 and security39784933392
passed; the main-only remote Readiness job was skipped, not passed. Main
promotion and conversion remain blocked. No CI rerun or DR cleanup was started.

The local artifact `node artifacts/dr-staging-qr-print-alert-probe.mjs` extracts and executes the actual E2E
assertion in a disposable local Chromium page. The original assertion fails
deterministically with the framework announcer before or after the correct
warning, matching the hosted strict-mode error. Narrowing only that locator by
its existing business text makes both cases pass. The correct-warning-only case
also passes; missing warning, wrong text and duplicate business warnings remain
rejected. All six probe verdicts now pass. The probe is local fixture evidence,
not an application/hosted acceptance result; the original real API/database QR
enable/rotation/pause-close-open test remains mandatory on the new source.

The change preserves the original warning assertion, all QR/session/RBAC and
cleanup checks, timeouts, retries and fail-on-flaky policy. No application,
workflow policy, schema, credentials, provider, customer data or hardware was
changed. The probe browser closes in `finally`; no Docker/application server
was started and other workspaces' services remain untouched. Fresh CI/security,
paired Preview and ordinary Chrome checks are still required before promotion.

Local validation for this narrow candidate passed: 3463 unit tests with nine
existing skips, typecheck, full lint (zero errors/five existing warnings),
production build, 336-file UI audit and dependency audit (zero vulnerabilities).
These results do not replace the new hosted printed-QR E2E or release gates.

## Protected conversion source-gate diagnosis (2026-10-23)

PR381 merged normally to main `b68df370` with the same tree as staging
`846df25a`. The six source workflows succeeded, but conversion Plans
`39811974789` and `39817316089` failed with
`STAGING_SOURCE_CHECKS_NOT_PASSED`. Both are consumed: never rerun or reuse them.
The latter job `119959100340` passed authenticated encrypted backup/restore and
unchanged-reset-input verification at16:50:39Z on October22, then failed the
source gate at16:50:40Z. It produced no artifact and never reached Provider
capture, Apply or DR data reset. The six direct run successes and workstation
PASS results do not qualify the protected caller.

The original source gate queries each distinct main/staging SHA using exactly
`actions/runs?head_sha=<sha>&event=push&per_page=100`. It requires `total_count`
below100, then selects the first exact workflow-path match for `ci.yml`,
`codeql.yml` and `production-readiness.yml`. Its final assertion can fail for:

| Predicate | Rejected condition |
| --- | --- |
| found | No exact workflow-path match in this response |
| shaMatches | Selected run's head SHA differs from the queried SHA |
| completed | Selected run's status is not completed |
| successful | Selected run's conclusion is not success |

The historical error is after the successful API response and count assertion.
Existing hosted logs/annotations do not retain the response or false predicate;
they cannot establish which SHA/workflow failed, or token/cache/pagination/server
root cause. Do not retrospectively label any one hypothesis confirmed.

New local mechanism evidence: four actual-fetch-boundary fixtures against the
unchanged function each produced the same error, one request and zero diagnostic
records. The new regression initially reported5 failures/2 passes. The local
candidate now emits only fixed event/workflow names, SHA, numeric counts/run IDs
and predicate booleans. It preserves the original query, first-match selection,
assertions, fail-fast behavior and errors; it adds no pagination, fallback,
successful-run allowlist, retry or weaker gate.

The candidate adds `operation=diagnose-sources` to the original protected
workflow, retaining its owner/main guard, production environment, read-only
GitHub permissions, job and serialized concurrency. Two explicit40-hex recorded
SHAs must resolve to equal trees. This operation executes only source reads,
with no backup/provider credentials, artifact/Plan receipt, Apply or reset. Its
output explicitly says `diagnosticOnly=true` and `planQualified=false`. The
original Plan/Apply validation and tests remain required for those operations.
This is a new token instance in the same protected caller configuration, not a
reconstruction of the expired historical token or response. It must first pass
normal review and release gates; no hosted diagnostic has been dispatched.

Local candidate checks passed24 focused tests, focused ESLint, typecheck,
2340-file/146-migration production guardrails and3478 full unit tests with9
existing skips (572 passing files,2 skipped). The real CLI entry was exercised
with an allowlisted GitHub fetch fixture and no backup/provider secrets. These
are local diagnostic-contract results, not protected-caller evidence or Staging
acceptance. Fresh build, full release QA, PR review and hosted diagnosis remain
incomplete. No commit, push, PR, Plan/Apply, provider mutation or service lifecycle
change occurred during this investigation.

### Newly blocking dependency audit

The current audit exited1: one critical package (`next`16.3.8), containing
GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r and GHSA-673q-mjm6-r5xr. These advisory
ranges were independently confirmed from the official Next.js advisories via
AnySearch; they list16.4.1 as fixed, while npm proposes16.4.2. This supersedes
historical audit0 as current release evidence. No forced audit fix, dependency
upgrade, security exception or remote release was performed. The owner was
asked once whether to include the framework security upgrade and regression QA
in this isolated worktree before normal PR review, without deploying Primary.

The existing sharp0.35.5 pin matches the image advisory's stated mitigation;
no `use server`/`use cache` directives were found in the searched application
source. This limited source triage neither clears the native audit gate nor
proves deployed exploitability or absence of compromise. See the official
[image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
[Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
and [cache advisory](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr).

At02:52Z and03:09:39–42Z Primary alias still bound project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`
to deployment `dpl_4v5acoGZU8tkbTAnb6uEwuN5AjJQ`; public version remained
`4e95d2ea5d53ae78c5af9c3db044481237674c44`, connectivity/login returned200.
This does not replace authenticated Staff/SSE proof: the last actual browser
verification remains18:18:48Z on October22, and the existing Chrome runtime was
unavailable at02:19Z. No runtime reset, session injection or repeated login was
attempted. Old DR827 orders/42 files remain unreset; persistent Staging and real
device acceptance remain incomplete.

### Approved minimal framework security upgrade (2026-10-23)

At06:59Z the owner explicitly authorized the minimal Next.js/eslint-config-next
security upgrade, full regression and a normal PR in this isolated worktree.
This supersedes the pending-scope state above; it does not authorize direct
Primary deployment. Both packages are pinned to16.4.2, with only their related
Next.js lockfile entries updated by npm. React19.2.4, sharp0.35.5, existing
overrides and the ignore-scripts policy remain unchanged. The official
[16.4.2 release](https://github.com/vercel/next.js/releases/tag/v16.4.2) and
advisories were checked before installation. Native npm audit now exits0 with
zero vulnerabilities; no force-fix or security exception was used.

Local evidence for this candidate:

- Standard unmodified unit discovery:3480 passed/9 existing skips
  (572 passing files/2 skipped). Four focused source/workflow/security suites:
  48 passed. The security contract pins the framework, config and ESLint plugin.
- A deliberate inversion of the new returned-SHA redaction condition caused
  three regression failures, including sentinel disclosure; restoring it
  restored48 focused passes and the exact original source SHA-256
  `4d0e6dcd495954121a680673b39df8a494c608ce864aeb12b6070b11123feaec`.
- Typecheck,336-file UI audit and production guardrails passed. Full lint has
  zero errors and five Next.js navigation warnings in existing tracker, reorder
  and keep-alive code; no unrelated navigation rewrite was included.
- Fresh isolated database initialization applied146 migrations and seed;
  72 SQL files/1619 assertions and warning-level DB lint passed. Production-mode
  Next.js16.4.2 build generated101 pages. Independent status Worker dry-run
  passed without deployment. Chromium/WebKit WebPRNT fixtures passed8 tests;
  this is not physical printer proof.

The disposable lab is project `dr-staging-next-security-20261023`, API54321,
DB54322 and test SMTP54324. It uses synthetic data and no provider credentials.
Initial lab copies exposed CRLF-sensitive migration anchors; an explicit
`git -c core.autocrlf=false archive` produced296 exact Git-blob files and fresh
initialization passed. A copy under artifacts was mistakenly discovered by
Vitest; moving the lab under node_modules removed that duplicate test discovery
without changing Vitest/TypeScript configuration or excluding production tests.
The final standard unit command above has no extra exclusions.

The first E2E shard then reported26 passes/2 failures/3 not run because all three
ordering Edge workers failed to resolve bare `zod` before application execution.
Explicit import-map selection alone did not fix it. A controlled comparison
used the same Edge Runtime v1.74.2 image, environment and unchanged function
bytes, but mounted them at `/workspace/supabase/functions` instead of a path
containing node_modules: all three workers booted and returned the expected
origin-rejection response. The test container now uses that clean mount path;
the host lab remains excluded through node_modules. The original failed test
containers/logs remain retained, not relabeled as passes. No application source,
assertions, deadlines, retries, rate counters or real provider configuration
were changed for this harness correction. The complete eight-shard suite and
resilience checks must still finish before local QA is considered complete.

At07:37:52–53Z Primary alias/project/deployment and revision4e95 remained unchanged;
version/connectivity/login returned200. This is not fresh authenticated proof.
No new protected-caller evidence or historical source-gate root cause has been
obtained; diagnostics still cannot qualify a Plan. Normal review/hosted QA,
persistent Staging acceptance and real-device checks remain incomplete.

### Independent review follow-up (2026-10-23)

Standards and Spec reviewers independently examined the candidate from
`846df25a` to local commit `e29b38ee`. Each found the same P2: although stderr
metadata was sanitized, an all-success source-only diagnostic printed raw API
run IDs and attempts in its final stdout summary. An actual mocked-fetch CLI
reproduction exited0 and disclosed a sentinel. This was a diagnostic-output
defect, not evidence of the historical hosted source-gate failure.

A new successful-path regression first failed1/passed14. The correction only
projects diagnostic summary run IDs/attempts to safe integers or null; original
query, first-match selection, count/SHA/status/conclusion assertions and returned
Plan evidence are unchanged. The actual CLI regression now exercises both
normal and malformed metadata and checks stdout plus stderr. Four focused
suites pass50 tests, focused ESLint and diff checks pass. Both reviewers then
independently verified sentinel removal and `planQualified:false`, with no
remaining Standards or Spec findings. This is local independent review, not a
GitHub approval or hosted diagnostic receipt.

### Final local security-regression receipt (2026-10-23)

- After the review fix, the unmodified standard unit command passed3482 tests
  with9 existing skips (572 passing files/2 skipped); typecheck, focused lint,
  production guardrails and diff checks passed. A fresh native audit exited0
  with all vulnerability counts0. The five full-lint warnings recorded above
  remain warnings, not errors.
- The complete eight-shard production-mode browser run exited0:204 passed,
  40 environment-specific skips, zero failures/flaky. Per-shard passes were
  31/31/23/30/28/32/24/5; skips were0/0/11/0/0/0/14/15. The six-minute idle
  tracker case executed its full wait and passed. No skipped case is counted as
  passed. The first failed Edge-harness run remains in the appended E2E log.
- The separate resilience suite passed8/8 in39.4 seconds. Its first launcher
  attempt failed before tests because direct CLI execution lacked npm's local
  executable PATH; adding node_modules/.bin to the ignored local launcher
  restored normal startup. No product/test/config gate was changed.
- Build/SQL/DB-lint/WebPRNT/Worker evidence above remains applicable: the later
  fix changed only diagnostic script output/tests/docs, not application or
  dependency bytes. Hosted CI, paired Preview, ordinary-browser provider checks
  and real hardware remain separate pending evidence.

Local logs, archives and generated payment/surge fixture receipts are retained
under ignored `artifacts/dr-staging-next-security-20261023/`. At08:01Z all eight
active containers with the exact lab project label were stopped; the four
earlier stopped Edge probes were retained. All12 now read back exited, and
ports3000/55431/54321/54322/54324/55439/8183 have no listeners. Docker volumes,
images and data were not deleted. `line-booking-test-20261004` remains running
on56863, so Docker Desktop was not stopped. To resume only this lab, recheck
labels, bind sources and free ports, start its existing DB and wait for health,
then start only its seven canonical companion containers (not old Edge probes)
and the owned local runner. No default-workspace start/reset is appropriate.

At07:56:31Z the exact Primary alias still bound the same project and deployment;
revision4e95/version/connectivity/login200 were unchanged. No fresh authenticated
Staff/SSE claim is made. No protected diagnosis, Plan, Apply, DR reset or Primary
deployment has occurred. The source-bound normal PR is the next release gate;
the historical protected-caller predicate and persistent Staging acceptance
are still unresolved.

## Failed conversion subprocess diagnosis (2026-10-23)

This section supersedes the earlier pre-PR execution status, not its historical
test results. PR384 and PR385 each completed their own fresh CI, paired Preview,
ordinary Chrome acceptance, normal merge and independently verified exact cleanup.
Reviewed main32e9de2c and staging93da3209 have the same treef585a481. Main's remote
Readiness actually passed; staging's main-only remote step was skipped. The
source-only diagnostic39942852818 returned all six predicates true for the old
sources but remained `planQualified=false`; historical failed predicates remain
unknown. These results did not constitute persistent Staging acceptance.

The independently qualified new Plan39944190461 was consumed by
Apply39944614570, which failed at11:16:42Z. Its authenticated artifact12497707244
was20984 bytes with SHA256
`6e453c336b9437d2e74bb9e14cc2c38029ebf2364617eb8dbacc3406c367e304`.
Six completed checkpoints end at `old-vault-and-private-schemas-retired`;
reset/migrations/seed/tests and runtime deployment were not completed. The42
original DR files were already byte-checked against the verified backup, deleted
and read back missing. They are recoverable from the encrypted backup, but were
not restored. Read-only11:21-26Z observations found827 orders,0 Storage objects,
0 Auth users,0 Vault secrets and no app_private/internal schemas. This is partial
retirement, not unchanged DR and not accepted synthetic Staging.

The failed hosted SQL matches pinned Supabase CLI2.109.1 drop.sql exactly:
5052 bytes, SHA256
`f1695821f5d4ad181e72a490e7d2787e859dc2440c59d5ee8e8a425034ee3c9f`.
Provider logs localize SQLSTATE53200 to **DROP TABLE**. Schema-drop text elsewhere
in the same query does not prove a DROP SCHEMA failure. An unpressured local
fixture matching64 locks/60 connections/0 prepared transactions and aggregate
catalog counts reset successfully; retain this counterexample. A separate pure
synthetic5000-advisory-lock fixture reproduced53200 twice with unchanged counts
after rollback. The existing reviewed bounded-drop helper then completed8 phases
and1334 separately committed statements under that pressure; the original reset
passed afterward and the provider-owned Storage canary survived. This proves a
mechanism, not historical hosted occupancy, capacity equivalence or recovery.
Both isolated network-none containers were independently confirmed stopped with
their data retained. No hosted helper, parameter change or reset retry occurred.

The separate diagnostic defect is reproducible through the actual
`resetAndSeedStaging` subprocess boundary. Node24 `assert.equal` appends its
actual/expected comparison to the supplied message; the unchanged Apply
allowlist therefore turned this into generic `STAGING_CONVERSION_FAILED`.
The local one-line correction throws the fixed
`STAGING_SUPABASE_COMMAND_FAILED` code for a subprocess error or nonzero/null
status. It never emits stdout/stderr, SQL, connection strings or provider bodies.
Target, arguments, environment isolation, timeout, buffer limit, command ordering
and all original gates remain unchanged. It does not activate bounded drops or
implement partial-state continuation.

Verification on owned HEAD3965f1dc plus this uncommitted correction:

- Permanent subprocess regression: five failures before the correction; all five
  pass afterward (exit1, ENOENT, timeout, signal, and inconsistent status0/error).
  Every failure stops before a second subprocess or network request, with an exact
  error message despite secret-like captured-output fixtures.
- Five focused files:30 passed. Native Node24 probe using the actual Apply catch
  expression:3 passed,3 mocked subprocess calls,0 network calls; invalid reset
  output keeps its distinct error. This is not historical CLI-stderr recovery.
- Full unit suite:3487 passed,9 skipped. Focused ESLint and typecheck passed.
- First production-guardrail run rejected the new test's literal synthetic
  credential-bearing URL. Removed that unnecessary password component from the
  fixture; no scanner/allowlist changes. Focused30 rerun, guardrails2339 tracked
  files/146 migrations and native full dependency audit0 then passed.
- No new build, full application E2E, hosted DB reset/migration/seed or deployed
  acceptance is claimed for this diagnostic-only patch. Existing release gates
  still apply before push/promotion. Primary was not modified; fresh12:11Z
  provider/public identity and NORMAL_PRIMARY/PRIMARY epoch3 remain unchanged.
  Separate authenticated Staff/SSE was immediate after one bounded reread of a
  transient connecting indicator; no reload, login or recovery write occurred.

Evidence is retained in the existing ignored promotion receipt and
`artifacts/dr-staging-apply-39944614570/` probes. The candidate is local only;
consumed Plan39944190461 and Apply39944614570 must never be reused or rerun.

### Partial-state continuation design — not implemented or qualified

Source review confirms three separate blockers to a blind replay:
`verifyOriginalReplica` requires the original complete fingerprints,
`readStagingProviderPrestate` requires an absent new entry and existing old aliases,
and `readStagingAccess` binds runner-private state to the old source/Plan and two
policies. The actual state has retired files/private credentials, an existing
protected entry and removed temporary QA access. Runner-only Edge plaintext is
not available in the artifact. Do not weaken any of those existing contracts.

A separately reviewed continuation must require all of the following before any
new hosted write; this list is design work, not an executable resume authority:

1. Authenticate the exact failed run/attempt/source/workflow, consumed Plan,
   backup, artifact bytes and exact ordered six-checkpoint prefix. Reject later,
   missing, reordered, forged or mismatched checkpoints; retain the original
   immutable success/expiry/source/target checks rather than accepting a loose
   current-state snapshot.
2. Prove the expected partial-data state from the verified original backup and
   the exact completed retirement operations. Prefer an offline replay against
   its restored copy to derive the expected remaining schema/data fingerprints;
   do not authorize deletion merely because a newly captured live snapshot is
   self-consistent. Require all remaining data to match, removed files to be
   absent, retired private/Vault scope empty, and no subscription, active cron or
   outgoing request. Missing proof, unexpected tables/rows or drift fail closed.
3. Independently read the exact existing Access app, human-owner policy/IdP,
   proxied DNS, DR-project domain/protection, retired-alias absence, current
   isolated Auth/Edge and unchanged Primary. Verify old QA token/policy absence
   explicitly. Do not treat the finally log as independent Cloudflare proof,
   recreate an existing entry, or restore unverifiable original credentials.
4. Bind that proven partial state, current provider/entry/Primary digests, fresh
   reviewed equal-tree source gates and verified backup to a new immutable,
   single-use continuation Plan. Its Apply must recheck every binding before
   mutation, and re-establish independent protected Edge credentials plus a new
   short-lived QA policy/token with exact cleanup. No old plaintext/digest reuse.
5. If approved through that reviewed path, use bounded drops only after the
   original-data proof and current-target/drift guards, preserving provider-owned
   objects and the unchanged pinned reset, full migrations, full SQL suite, lint,
   synthetic safety checks and Primary readback. Prove pressure, partial failure,
   no-replay and target-rejection cases offline first. Do not enable legacy DR
   workflows, raise limits/timeouts, restart services or buy capacity.

Independent Cloudflare absence, offline partial-state equivalence, reviewed
continuation implementation and hosted recovery remain incomplete. Final
persistent Staging acceptance still requires human IdP, ordinary Chrome/SW,
printed QR, synthetic order-to-Staff/KDS, Storage, tenant isolation and unchanged
Primary; real payment/notifications/invoices/hardware printing stay disabled.

### Partial-state proof feasibility (2026-10-23, 12:30Z)

The actual encrypted backup cannot currently be replayed in this local process:
`DR_BACKUP_ENCRYPTION_KEY` is absent. Earlier credential inventory located that
secret in the protected GitHub production environment, not this worktree. This
is not permission to extract it, search unrelated workspaces, spoof Actions
environment variables or run the old protected backup command locally. No
decryption, actual restore or partial-state equivalence pass occurred here.

Source inspection identifies the next safe implementation as a separately
reviewed **read-only evidence operation**, before any continuation Plan/Apply.
It must authenticate the original backup and failed-Apply provenance, restore
only into an isolated disposable database, replay the already completed
retirement, and compare its derived state with read-only exact-DR observations.
The existing protected secret can remain on that runner; no new credential or
human login is needed merely to develop this path. This operation is not yet
implemented or dispatched and must emit `planQualified=false`.

Replay constraints established during this investigation:

- Keep the original migrations, seed, reset rehearsal and reset-preparation
  inputs unchanged. `readConversionBackup` deliberately rejects their drift;
  refactoring those inputs merely to share replay code would invalidate the
  existing authenticated rehearsal binding. Do not remove this check.
- Restore all sections and original constraints. The existing three encrypted
  recovery-only `print_rules` parents remain an explicitly checked offline
  exception, excluded only from the matching original-table projection. Do not
  fetch additional Primary rows or turn the supplement into Staging seed.
- Do not substitute the old rehearsal's `TRUNCATE storage.objects CASCADE` for
  the actual Storage API retirement. At 12:24Z, read-only DR catalog evidence
  showed no foreign key referencing `storage.objects`, no `storage.prefixes`
  table, and only a BEFORE DELETE statement guard plus BEFORE UPDATE timestamp
  trigger on objects. The guard checks `storage.allow_delete_query`. These are
  current catalog facts, not proof of the restored backup's trigger graph or
  other API effects. An eventual replay must inspect that original graph and
  preserve triggers/constraints; never disable them to manufacture equivalence.
  Any local SQL simulation of Storage deletion must remain confined to the
  disposable database, with actual deleted-path/byte receipts verified separately.
- Replay the successful Vault/private-schema/standalone-sequence retirement,
  not the failed reset or later seed. Compare every remaining original table
  using the same ordered source-column projection, and separately reject
  unexpected/missing schema objects. Table counts alone, a new live baseline,
  or treating missing tables as empty cannot establish original-data integrity.
- Bind the exact failed run/attempt/source, consumed Plan, backup and artifact
  bytes to the ordered six-checkpoint prefix before using any receipt. The
  inherited snapshot does not grant replay authority. Current provider/entry,
  old QA-token absence and fresh isolated credentials are still separate gates.

Only existing owned source and sanitized receipts plus read-only DR catalog were
inspected. No new application code, workflow, hosted write, service lifecycle
operation, Plan/Apply or reset was performed in this feasibility step. At 12:30Z
Primary's actual hostname still resolved to the original project/deployment and
revision, public checks returned NORMAL_PRIMARY/PRIMARY epoch3, and the separate
already-authenticated Staff page showed network normal/SSE immediate after one
bounded reread without reload or recovery. This is not Staging acceptance.

### Partial-state proof provenance candidate (2026-10-23, 12:49Z)

The first implementation slice is now local in
`scripts/staging-partial-retirement-proof.mjs` and its regression test. This is
**not the complete protected proof operation**: there is no workflow integration,
backup decryption, isolated restore, completed-retirement replay or live-data
comparison yet. No continuation/Plan/Apply/reset is enabled by this module.

- Bind failed Apply39944614570 and consumed Plan39944190461 to attempt1, the
  original owner/repository/workflow/event/source, and their distinct terminal
  failure/success states. Retain the existing immutable approval digest, tree,
  parameters and expiry validator without changing it or unconsuming the Plan.
- Authenticate both original ZIPs against their pinned artifact IDs, byte lengths
  and SHA256 values, plus live GitHub artifact/run metadata and expiry. Read only
  four bounded JSON members directly from those authenticated bytes; ignore
  caller-supplied extracted receipts and the unrelated old July summary.
- JSON extraction uses Python's standard-library ZIP reader in isolated mode,
  with only PATH/SystemRoot inherited, stdin bytes, bounded output/time and no
  filesystem extraction. No provider credential or backup key enters that child.
  Parser output/errors are never logged; only fixed errors escape the boundary.
- Require the exact ordered six-checkpoint prefix, original backup identity,
  precise DR target and all 42-file byte/path/authenticated-missing assertions.
  Return only fixed provenance fields with `diagnosticOnly=true`,
  `planQualified=false`, `remainingDataProven=false` and `remoteWrites=false`.
- Regression progression retained: initial missing-module RED, then one happy
  case GREEN; archive-boundary addition RED1/11PASS, then12PASS. Negative cases
  cover both run identities/attempts, missing/reordered/duplicate/later
  checkpoints, changed backup/target/Plan/expiry and incomplete Storage evidence.
  Related focused suite49PASS; lint/typecheck/production guardrails2341files and
  146migrations pass. Full unit regression3499PASS/9SKIP,573files passed/2skipped
  in109.19s. No backup-bound input was edited. New build/application E2E and hosted
  restore/equivalence are NOT_RUN, not implied by these unit results.
- Native Node/Python probe read the actual two retained ZIPs and fresh four
  GitHub GET responses: provenance validation passed, and one-byte tampering in
  either archive failed closed. This verified actual parser/provenance behavior,
  not original-backup decryption or remaining-data equivalence. The probe is in
  the existing ignored failed-Apply evidence directory.

Next implement the isolated original-constraint restore/replay and exhaustive
remaining-data/schema comparison, preserving the Storage modeling restrictions
above. Only after the full read-only operation is tested and normally reviewed
may a protected workflow use the existing runner-only key. Independent current
provider/Cloudflare QA-token absence and any new continuation remain separate.
At12:48:57-58Z Primary hostname/provider/version/availability/connectivity/login
were unchanged; separate existing authenticated Staff showed normal network and
SSE immediate after one bounded reread, no pending orders, no reload or write.

### Isolated restore adapter candidate (2026-10-23, 13:14Z)

The next local slice is `scripts/staging-partial-retirement-restore.mjs` and
its permanent process-boundary regression tests. This is an offline adapter,
not the authenticated protected entrypoint: its future caller must authenticate
the original encrypted backup and failed-Apply artifacts before supplying any
plaintext. No workflow integration, original-backup decryption, completed
retirement replay or live remaining-data/schema comparison has run.

- Accept only an exact64hex Docker container ID with this task's name/labels,
  the pinned locally inspected Supabase PostgreSQL image digest, network none,
  zero mounts and host port bindings, no host namespaces, added capabilities or
  devices, and no privileged mode. Explicit local Docker socket overrides any
  ambient Docker host. Children inherit only PATH/SystemRoot, never provider or
  database credentials. SQL uses the in-container Unix socket and fixed local
  database name, never a supplied connection URL.
- Create a new template0 database; an existing copy fails rather than being
  overwritten. Transfer archive bytes over stdin into a private container-only
  directory. Restore original pre-data/data/post-data sections and preserve ACLs,
  owners, constraints and triggers. The only suppressed TOC records are schema
  declarations for the namespaces explicitly bootstrapped in the new database.
- Between data and post-data, validate and INSERT only the existing three
  offline recovery IDs, original column set and existing printer/tenant tuples.
  Do not fetch Primary rows. Every original table's ordered-column fingerprint
  must match; exclude only those three exception rows, then independently read
  them back exactly. This does not prove current partially retired DR data.
- Eleven permanent cases pass, including host escape/port/image refusal,
  sanitized malformed JSON, subprocess failure without retry/later stages,
  tenant-reference rejection and original/exception data drift. Retained REDs:
  missing module, unimplemented restore, host-namespace omission, raw JSON error
  leakage and unpinned-image acceptance. Related seven-file suite69PASS;
  lint/typecheck/guardrails2343files146migrations/diff and unchanged backup-bound
  inputs pass. A mistyped nonexistent guardrail filename failed first; the
  repository's actual `npm run production:check` then passed without exemptions.
  Full unit regression finished3510PASS/9SKIP,574files passed/2skipped in106.98s.
  New build/application E2E and protected original-backup execution remain NOT_RUN.
- Native synthetic probe used a fresh network-none/no-mount/no-port container
  with the pinned image. Actual pg_dump and all three pg_restore sections passed;
  three orphan-reference fixture jobs survived, the three offline parents were
  restored, both original FKs were validated, the original grant remained, and
  an invalid new FK insert returned23503. Reusing the same restore copy failed
  closed. Fixture construction alone temporarily modeled historical replicated
  orphans; the restore adapter never disables triggers or constraints.
- First synthetic run failed because pg_isready accepted the entrypoint's
  temporary socket-only initialization server before its shutdown. The harness
  was corrected to wait for the final server on container loopback (no published
  host port), then a new isolated container passed. Both exact containers
  `dr-staging-partial-proof-20261023-restore` and `...-restore-v2` were stopped in
  finally and independently confirmed exited; their data/images remain. The
  unrelated LINE container remains running on127.0.0.1:56863. No other service
  was started or stopped. The final image/port guards and private-directory mode
  were covered by focused regression after this native run.

Results remain `diagnosticOnly=true`, `planQualified=false` and
`remainingDataProven=false`. The native fixture is not the original encrypted
backup, not a hosted restore and not continuation qualification. Next connect
authenticated backup decryption to this adapter, inspect the restored original
Storage graph, replay only completed retirement, and prove all remaining
fingerprints/schema against read-only exact DR before normal review. Keep the
original backup-bound migrations/seed/rehearsal/preparation untouched.

At13:10Z the real Primary hostname still resolved to the original project,
deployment and revision; public version/availability/connectivity/login returned
200 with NORMAL_PRIMARY/PRIMARY epoch3. Separate existing authenticated Staff
showed network normal/SSE immediate/no pending orders after one bounded reread.
No reload/login or Primary/DR/provider write occurred. Nine local candidate
paths remain uncommitted; no Plan/Apply/reset/helper/dispatch/PR was performed.

### Authenticated original-backup adapter (2026-10-23, 13:32Z)

The candidate now has a pinned original-backup reader and a composition seam
connecting it to the failed-Apply/Plan provenance verifier and isolated restore
adapter. This is still a library candidate, not a protected workflow or a
continuation entry point. Eleven local paths remain uncommitted at HEAD3965f1dc.

- Live backup metadata was reread: run39647447270 attempt1, original source291c3c56,
  original backup workflow/push branch/owner and success; artifact12368487539,
  9441387 bytes, SHAfbab2a1c and expiry2026-11-20T17:56:32Z. All are pinned before
  parsing. An isolated Python standard-library decoder accepts exactly47 named,
  bounded members from the actual ZIP, with no extraction, key or inherited
  provider environment. No local backup-key lookup or decryption attempt occurs
  in the native archive probe.
- Node-only decryption preserves raw key bytes and authenticates manifest,
  database dump, all42 exact-path files and the separate three-parent supplement.
  It checks encrypted size/SHA, plaintext file SHA,239 unique table/ordered-column
  scopes and matching fingerprints, original restore/rehearsal evidence and the
  limited offline recovery identity. Private JSON/crypto failures are replaced
  by a fixed error; decrypted buffers are never diagnostic output or artifacts.
  The composition authenticates all three archive inputs before any Docker
  transfer. Restored parent tenancy remains independently checked by the adapter.
- Permanent missing-module RED is retained. Eight new cases passed, including
  synthetic decrypt success, key whitespace, wrong/missing keys, private JSON
  errors, member/hash/path/table/fingerprint/reference tampering and no restore
  after unauthenticated input. Related8files77PASS; lint/typecheck/guardrails
  2345files146migrations/diff and unchanged backup-bound inputs passed. Full unit
  regression was started for this new code; its terminal result is recorded below.
- Native actual-ZIP probe decoded47 bounded members after two readonly GitHub
  GETs; six altered byte/metadata cases were rejected before parsing again. It
  stopped at the missing-key boundary by design. This proves archive transport
  and rejection, not original decryption, original restore or live equivalence.
- At13:30Z actual Primary hostname/provider remained projectprj_uoG4FNJIgnF1LdKRiXnfRaieXnUP,
  dpl4v5 and revision4e95; version/connectivity/login200. An initial health probe
  incorrectly requested `/api/availability` and returned404; its stale-variable
  status projection is discarded, not a Primary regression. Source-verified
  `/api/availability/config` returned200 NORMAL_PRIMARY/PRIMARY epoch3 at13:30:48Z.
  Separate existing authenticated Chrome Staff showed network normal/SSE immediate
  and no pending orders after one bounded read; no reload/login/write. No service
  was started or stopped.

Original backup decryption/restore, restored Storage topology, retirement replay,
remaining-data/schema equivalence and the complete protected workflow are still
NOT_RUN or unimplemented. No new build/application E2E or remote write occurred.
Next implement original-restored Storage graph validation and exact completed
retirement replay, then exhaustive remaining fingerprints/schema comparison with
read-only exact DR. Do not treat synthetic fixtures, archive parsing or a current
snapshot alone as equivalence. No consumed Plan/Apply can be reused.

Full unit regression completed exit0:3518PASS/9SKIP,575filesPASS/2SKIP,
109.53s. No further product-source change followed this run; evidence-only
documentation updates do not turn the pending protected execution into a pass.

### Restored Storage graph and offline metadata replay (2026-10-23, 13:54Z)

- Extended the isolated restore boundary, not a hosted recovery entry. All
  original fingerprints and three offline-only reference readbacks must pass
  before the ORIGINAL restored Storage graph is inspected. Reject inheritance,
  partitioning, incoming foreign keys, rules, extra DELETE triggers, disabled or
  conditional guards, trigger arguments/columns, security-definer/config drift,
  and any difference from the exact read-only-observed provider guard definition.
  A current hosted catalog alone never supplies the original-backup proof.
- Exact42 original bucket/path pairs must match restored metadata. Only then
  model completed metadata retirement in the network-none copy: exact-path
  DELETE with the original guard enabled and its transaction-local allowed GUC;
  delete Vault rows, drop the two retired private schemas and reuse the unchanged
  standalone-sequence cleanup SQL. No TRUNCATE, disabled trigger, reset, seed,
  lock-release helper or hosted SQL mutation. The authenticated original-data
  checkpoint proves zero active cron; the six-schema backup contains no cron
  catalog and this adapter does not invent one. Fresh live cron state and every
  remaining data/schema fingerprint still need independent comparison.
- Read back zero objects/Vault/private schemas/standalone sequences. Outputs
  remain diagnosticOnly=true, planQualified=false, remainingDataProven=false.
  Offline metadata replay does NOT prove all Storage API side effects or live
  equivalence. The authenticated three-archive composition now invokes this
  adapter; original encrypted execution remains NOT_RUN without the protected key.
- Five additional permanent cases pass (16 restore cases total), covering graph
  drift, exact paths and post-replay failures. Missing export and missing replay
  result REDs retained. Six related files63PASS; lint/typecheck/guardrails
  2345files146migrations/diff PASS; backup-bound four input paths unchanged.
- Native synthetic replay-v2 passed42 deletions with original guard/ACL/FKs and
  unrelated canaries preserved. Replay-v3 additionally restored7 synthetic Vault
  rows through pg_dump/pg_restore and retired them to0. Final state:3 jobs,
  3 offline parents,2 validated FKs,0 objects/Vault/private schemas,1 retained
  owned identity sequence and1 Storage canary. A subsequent direct DELETE still
  failed42501, proving the allowed GUC was not left enabled. This is synthetic
  data, not original backup or hosted proof. The first harness failed42P06 on a
  pre-existing bootstrap schema; retained that failure and moved fixture creation
  to a new template0 source DB, without weakening product guards.
- All three new exact replay containers finally stopped and independently read
  back exited; images/data preserved. LINE56863 remains the only running container.
  Eleven candidate paths remain uncommitted at3965f1dc; no remote writer, workflow,
  Plan/Apply reuse, reset, provider change or service outside the test was touched.
- 13:52:38Z Primary alias/project/dpl4v5/revision4e95 and public version,
  connectivity/login/config200 NORMAL_PRIMARY/PRIMARYepoch3 unchanged. Separate
  authenticated ordinary Chrome Staff network normal/SSE immediate/no pending
  orders after one bounded reread; no reload/login/write. New AOCI refresh loaded
  the shared-root empty skeleton; its delivery confirmation was reported
  incomplete and attestation0/0 failed, so no governance/full-cognition claim.

Next implement exhaustive expected-remaining data/schema evidence and compare
against read-only exact DR, then the complete protected read-only entry and normal
review. No current snapshot or local replay alone qualifies a continuation.

Full new unit regression completed exit0:3523PASS/9SKIP,575filesPASS/2SKIP,
109.62s. Source remained unchanged afterward; evidence-documentation updates only.

### Remaining-table data comparison slice (2026-10-23, 14:16Z)

- Added `staging-partial-retirement-data.mjs/test`. Expected data is captured
  only after the authenticated composition restores/replays the original copy.
  The restore adapter now independently rechecks all three exception rows after
  replay, then captures a single-statement snapshot of every surviving original
  table's ordered-column fingerprint and actual complete table/column inventory.
  Extra/missing tables or columns, reordered columns, foreign/partitioned/inherited
  tables and surviving retired schemas fail closed. Only the two intentionally
  retired schemas are removed from the original table scope.
- The three offline parent IDs are excluded ONLY from the isolated expected
  fingerprint; their exact rows are checked before and after replay. The hosted
  projection never excludes them and separately requires their count to be zero.
  The fixed retired-DR `conversionQuery(..., true)` transport issues only the
  generated SELECT, no target parameter, writes, retry or fallback. All row/count
  mismatches and malformed/provider errors fail with fixed sanitized codes.
  This transport was tested with mocks/local synthetic databases, NOT against DR.
- Private snapshot hashes/inventory stay in process. The new composition derives
  expected data from the authenticated three-archive path and strips private
  evidence from its comparison summary; an unauthenticated backup fails before
  any restore or hosted read. Table data matching is explicitly NOT full schema
  equivalence: `remainingSchemaProven=false`, `remainingDataProven=false`,
  `diagnosticOnly=true`, `planQualified=false`. Types, defaults, constraints,
  routines, policies, owners/ACLs, views, sequences and provider/current safety
  catalogs still need the separate complete structural proof and protected entry.
- Six new data tests plus post-replay reference and composition rejection cases
  pass. Missing-module, missing-capture and missing-post-replay-check REDs retained.
  Initial fixture shallow-copy aliasing and a `beforeEach` returning its mock
  (unintended cleanup invocation) were corrected in the test, not product gates.
  Related7files67PASS preceded the final additional composition case. Full final
  regression3531PASS/9SKIP,576filesPASS/2SKIP,108.72s; lint/type/production guardrails
  2347files146migrations/diff PASS. The four backup-bound input paths remain unchanged.
- Native synthetic data-v1 and final data-v2 used fresh exact-owned network-none
  containers and a local second database. Actual generated SQL matched7 remaining
  tables, rejected a changed row, an extra column and hosted-shaped parent rows;
  a transaction-read-only DELETE failed25006. Four intercepted transport calls
  used the fixed DR URL and read_only=true but never sent network traffic.
  Original constraints/canaries and Storage42501 guard remained intact. Final v2
  includes the added post-replay reference readback. Both containers finally
  stopped and independently read back exited; data retained, LINE56863 sole running.
- Thirteen candidate paths remain uncommitted at3965f1dc. No original backup key
  lookup/decryption, real DR comparison, workflow dispatch, reset, Plan/Apply,
  helper activation, build/application E2E, commit/push/PR or provider write.
  14:12:53Z actual Primary hostname/alias resolves to original project/dpl4v5/
  revision4e95; public config NORMAL_PRIMARY/PRIMARYepoch3 and version/connectivity/
  login200 unchanged. Separate authenticated ordinary Chrome Staff network normal/
  SSE immediate/no pending after one bounded reread, with no reload/login/write.
  AOCI14:00 fresh transport now has confirmed delivery using the issued receipt
  version, but the shared-root zero-entry attestation/governance still fail;
  source-bound only, no complete-system claim or shared-root initialization.

Next implement complete remaining structural/sequence evidence and independent
current safety/provider/entry checks, then finish and normally review the protected
read-only workflow. Local table data comparison is not original encrypted proof,
live equivalence, continuation authority or persistent Staging acceptance.

### Remaining catalog and sequence slice (2026-10-23,14:44Z)

- Added `staging-partial-retirement-schema.mjs` and tests. Authenticated original
  restore/replay now derives a PRIVATE catalog alongside PRIVATE table evidence.
  The catalog covers the surviving four schemas, relation/column types/defaults/
  collation/identity/storage, domains/enums/ranges, constraints/validation, index
  definitions/state, routines, ordinary and internal constraint triggers, rules,
  views, RLS/policies, owners/ACL/default ACLs and named dependency edges.
  Sequence definitions plus exact decimal-string last_value and is_called are
  compared; no nextval/setval is used by the candidate. Specialty unsupported
  catalog categories, unsupported internal-trigger shapes, retired schemas,
  malformed/duplicate objects and incomplete sequence coverage fail closed.
- Catalog SQL explicitly qualifies PostgreSQL functions/catalogs/types; search_path
  and server major are compared, not silently normalized. Only generated physical
  TOAST names are replaced by their VERIFIED exact owning-table identity; the
  dependency edge remains present. Internal constraint trigger identities use
  constraint/type/function instead of OID-bearing names, retaining enabled,
  argument, relation, deferral and column semantics. No DDL/function body is
  executed while reading definitions. Unsupported objects are not skipped to
  obtain a match. Raw definitions, hashes and sequence values never enter the
  public comparison summary.
- This remains a catalog slice, NOT exhaustive environment qualification:
  global role/extension/security-label/event-trigger settings, current safety,
  provider/Auth/Edge/entry/Primary/source proofs and a coherent combined data+
  catalog snapshot still require the protected entry. The current data and
  catalog comparisons use separate read-only SELECTs. `remainingCatalogMatched`
  and `sequenceStateMatched` are distinct from `remainingSchemaProven=false`,
  `remainingDataProven=false`, `planQualified=false`. No continuation authority
  comes from this adapter or a caller-supplied snapshot.
- Five permanent schema cases plus the restore-composition assertion pass;
  related five modules49PASS. Missing module, missing private capture, missing
  internal-trigger projection and unqualified-function guards first failed.
  Native synthetic v1 had a fixture dollar-quote replacement error42601; v2
  exposed a real generated SQL aggregate comma error42601, which was fixed.
  v3/v4 correctly rejected OID-based TOAST dependency identities. v5 matched;
  v6 added internal-trigger coverage; final v7 also exercised explicit catalog
  qualification and the current authenticated-restore integration.
- Final native schema-v7:122 catalog objects,109 named dependency edges,18 shared
  role edges and1 exact sequence matched across two purely synthetic databases.
  Ten mutations were rejected: default, policy, ACL, routine, sequence value,
  sequence is_called, index, constraint validation, internal trigger enabled
  state and enum labels. Eleven intercepted fixed-DR read_only=true requests
  executed ONLY on the local synthetic database, with zero external network.
  Actual transaction-read-only DDL failed25006. Existing original3jobs/3offline
  parents/2validatedFKs/grant/canaries remained; replay retired42objects/7Vault
  only in the isolated copy and retained the42501 Storage guard.
- All seven new exact schema-v1..v7 containers finally stopped and independent
  inspection confirmed exited; no mounts/ports/network, data/images retained.
  LINE56863 remained the sole running container. Fifteen candidate paths now
  remain uncommitted at3965f1dc. No original-key lookup/decryption, actual DR
  comparison, protected workflow/dispatch, Plan/Apply/reset/helper, provider write,
  commit/push/PR or new build/application E2E occurred. Backup-bound input paths
  remain unchanged. Lint/type/production guardrails2349files146migrations/diff PASS.
-14:32:05Z actual Primary hostname and alias still bind original project/dpl4v5/
  revision4e95; public version/availability/connectivity/login200, NORMAL_PRIMARY/
  PRIMARYepoch3 unchanged. Separate ordinary authenticated Staff network normal,
  SSE immediate/no pending after one bounded read (initial connecting); no reload,
  login or write. AOCI14:23 fresh body delivery confirmed, one zero-entry
  attestation/governance failed; source-bound only, no shared-root initialization.

Next close the explicit remaining global/security and consistent-snapshot gaps,
add independent current safety/provider/entry/Primary/source checks, and finish
the protected read-only entry with normal review. Do not rerun unchanged green
probes or infer hosted recovery from this synthetic catalog evidence.

Final full unit run on this candidate:3536PASS/9SKIP,577filesPASS/2SKIP,
111.33s, exit0. Only documentation/state updates followed; no new product edits.

### Combined row/catalog statement (2026-10-23,15:02Z)

- Added the snapshot adapter and tests. Final offline row/catalog evidence is now
  captured by one generated SELECT after preliminary sequence-name discovery;
  the authenticated three-archive composition compares both projections with ONE
  fixed retired-DR read_only=true request. It cannot accept a caller's current
  snapshot as original-backup provenance. The existing row/schema validators and
  mismatch checks are reused, with qualified pg_catalog data functions as well
  as the existing qualified catalog functions. No session settings, transaction
  commands, target overrides, retries, DDL or DML enter the hosted query.
- `rowCatalogSingleStatement=true` describes this mechanism, NOT complete global
  atomicity. PostgreSQL sequence values are non-MVCC; `sequenceSnapshotAtomic=false`
  remains explicit even when `sequenceStateMatched=true`. Global roles/extensions/
  security labels/event triggers, current safety/provider/Auth/Edge/entry/Primary/
  source checks and the complete protected entry are still unfinished. The six-
  schema backup is not evidence of historical global-role state. Do not invent
  that state from today's catalog or label it original equivalence.
- Missing module first RED; capture and qualification checks2FAIL2PASS; restore
  integration1FAIL16PASS. Four new permanent cases and related five modules41PASS
  after correction. Malformed/split responses, either-side drift and invalid
  expected evidence fail closed; output excludes private hashes/catalogs. All
  remainingDataProven/remainingSchemaProven/planQualified flags stay false.
- Native snapshot-v1 used the current restore/replay and combined reader against
  two purely synthetic databases:7 tables,122 objects,1 sequence matched; changed
  row, policy, sequence state, extra column and mixed row+policy drift rejected.
  Six intercepted fixed-DR requests executed only local SQL, zero external
  network; read-only DDL failed25006. A separate synthetic setval transaction
  retained9/false after rollback, confirming why rollback is not sequence-state
  recovery evidence. No such mutation ran on DR or Primary. Original3jobs/
  3offline parents/2validatedFKs/ACL/Storage canary and DELETE42501 guard retained;
  only the local replay retired42metadata/7Vault. This is NOT original encrypted
  backup decryption, live equivalence or Storage API side-effect proof.
- Exact network-none/no-mount/no-port snapshot-v1 container finally stopped and
  independent inspect confirmed exited. Data/images retained; LINE56863 remains
  sole running container.17 uncommitted candidate paths, HEAD3965f1dc unchanged.
  No commit/push/PR/dispatch/Plan/Apply/reset/helper/provider writes, local key
  lookup or new build/application E2E. Backup-bound inputs remain unchanged.
  Lint/type/production guardrails2351files146migrations/diff PASS.
-14:59:23-24Z Primary actual hostname and alias still bind original project/dpl4v5/
  revision4e95; public NORMAL_PRIMARY/PRIMARYepoch3/version/connectivity/login200
  unchanged. Separate ordinary authenticated Staff network normal/SSE immediate/
  no pending after one bounded re-read; no reload/login/write. AOCI14:53 fresh
  delivery confirmed, single zero-entry attestation/governance failed; source-
  bound continuation only, no shared-root initialization or alignment claim.

Next finish explicit global/current safety evidence and the protected read-only
entry with normal review. Sequence writer quiescence still needs independent
evidence before any future continuation; a single SELECT does not supply it.

Final full unit regression:3540PASS/9SKIP,578filesPASS/2SKIP,109.70s,
exit0. Only documentation/state updates followed; no new product edits.

### Current global-security inventory (2026-10-23,15:21Z)

- Added a separate fixed-target, one-SELECT, read_only=true current catalog reader:
  database owner/ACL/locale, roles and flags/settings, membership options,
  database/role settings, extensions and config-table conditions, event triggers,
  object/shared security labels and global default ACLs. Catalog functions are
  explicitly pg_catalog-qualified. No password verifier is selected; no application
  function executes. This is CURRENT inventory, not historical global equivalence:
  the authenticated six-schema backup did not capture global-role history.
- Exact response validation and fixed transport/validation errors keep private
  content out of errors. Settings/extension conditions/labels/event definitions
  can contain secrets; returned privateGlobalSecurity is private process memory,
  never a logged or uploaded receipt. Public fields contain only counts and
  diagnosticOnly=true, planQualified=false, historicalGlobalStateProven=false,
  currentGlobalSafetyProven=false. No isolation policy or continuation gate has
  been declared passed; this reader is not yet part of a protected workflow entry.
- Missing-module RED retained. A permanent case exposed ambiguity between all
  roles and a real role named all-roles (1FAIL1PASS); SQL now uses null for the
  all-role identity. Five cases pass, including all private fields, malformed/
  inconsistent/overbroad responses, secret-bearing errors and qualified query
  restrictions. Related seven modules58PASS. Lint/type/guardrails2353files and
  146migrations/diff PASS; backup-bound inputs unchanged.
- Native security-v1 on a fresh pinned network-none/no-mount/no-port synthetic
  PostgreSQL17 container captured31roles/22memberships/2extensions/1event trigger.
  Eight controlled changes to role flags/membership/settings/extension/event-
  trigger enabled state/default ACL/database ACL were represented. Nine fixed-
  DR fetch interceptions ran only local SQL, zero external network. Read-only
  CREATE ROLE failed25006. Null all-role and real all-roles settings remained
  distinct. Real security-label application was NOT_RUN (no label provider was
  installed); array/shape/privacy behavior has unit evidence only. No original
  encrypted backup decryption, actual DR capture/comparison or historical global
  proof occurred. The exact container is independently exited, with all data and
  images retained; LINE56863 remains the sole running container.
-19 uncommitted candidate paths, HEAD3965f1dc unchanged. No commit/push/PR,
  protected workflow/dispatch/Plan/Apply/reset/helper/provider write or new
  build/application E2E.15:19:12-14Z Primary actual hostname project/dpl4v5/
  revision4e95, public NORMAL_PRIMARY/PRIMARYepoch3/version/connectivity/login200
  remained unchanged. Separate authenticated ordinary Staff network normal/SSE
  immediate/no pending after one bounded re-read; no reload/login/write.
  AOCI15:15 complete transportconfirmed, one zero-entry attestation/governance
  failed; source-bound continuation, no shared-root initialization/alignment.

Next implement the independent current isolation/provider/Auth/Edge/entry/source/
Primary checks and the reviewed protected read-only composition. Current global
inventory cannot manufacture missing historical role evidence. Sequence-writer
quiescence remains an independent requirement; all full-proof/Plan flags stay
false. Do not rerun consumed Plan/Apply or unchanged successful probes.

Final full unit regression:3545PASS/9SKIP,579filesPASS/2SKIP,110.98s,
exit0. Only documentation/state updates followed; no new product edits.

### Current partial-isolation observation (2026-10-23,15:32Z)

- Added a fixed retired-target read-only observer for the actual partial-state
  boundary. One qualified DB SELECT requires exactly one current enforced DR
  READ_ONLY_STANDBY backend with writes disabled; zero subscriptions, active cron,
  outgoing requests, Auth users, Storage objects, Vault entries and retired private
  schemas. These checks do not replace remaining original-data equivalence.
  Non-idle client count is observed, not treated as proof that sequence writers
  cannot race after the read. No user query text or credentials are selected.
- Independent GETs inspect Auth and Edge metadata: disabled signup/provider/hook
  and mail configuration, cleared provider credentials, exact eight custom Edge
  names and the six known constant-value hashes. Random-secret hashes cannot
  recover runner-only plaintext or prove fresh Primary-independent credentials.
  privateIsolation contains potentially sensitive provider data; only counts and
  limited observation booleans are public. planQualified,
  independentEdgeCredentialsProven and sequenceWriterQuiescenceProven stay false.
  These are separate observations, not one atomic provider/DB snapshot, complete
  safety proof, authenticated Staging acceptance or permission to resume Apply.
- Missing-module RED retained; five permanent cases now pass, including drift in
  every DB count/fence, Auth activation/residual credentials, changed Edge scope/
  known hashes, malformed responses and sanitized provider/SQL errors. Actual
  API methods/target are fixed; no api-keys reveal, provider writes, retries,
  SQL reset/seed/helper or credential rotation. Related eight modules63PASS;
  lint/type/guardrails2355files146migrations/diff PASS, backup-bound diff EMPTY.
- Native isolation-v1 used a fresh pinned network-none/no-mount/no-port synthetic
  PostgreSQL17 DB and exercised the actual SELECT/reader. Eight mutations
  (Auth/Storage/Vault rows, active cron, queued request, private schema, enabled
  backend writes, duplicate current backend) were rejected.27 intercepted fixed-
  target fetches included9 local DB queries and fixture-only Auth/Edge responses,
  zero external network. Read-only DELETE failed25006. Real subscription mutation
  and real Auth/Edge provider readbacks were NOT_RUN. No original encrypted
  backup decryption, live DR comparison or sequence-quiescence proof occurred.
- Exact isolation-v1 container finally stopped and independently confirmed exited;
  data/images retained. LINE56863 remains the sole running container.21 candidate
  paths remain uncommitted at HEAD3965f1dc; no commit/push/PR/dispatch/Plan/Apply/
  reset/helper/provider write, new application build/E2E or key lookup. Existing
  AOCI source-bound state retained; no new compaction or shared-root initialization.

Next implement current Vercel/Cloudflare entry and old-QA-token/policy absence
checks, bind source/Primary evidence, then assemble the protected read-only entry
and obtain normal review. No full-proof flag can become true from these current
observations alone, and all consumed Plan/Apply IDs remain forbidden.

Final full unit regression:3550PASS/9SKIP,580filesPASS/2SKIP,111.23s,
exit0. Only documentation/state updates followed.15:33:30-32Z Primary actual
hostname/alias still bind original project/dpl4v5/revision4e95; public availability
NORMAL_PRIMARY/PRIMARYepoch3 and version/connectivity/login200 unchanged. Separate
ordinary authenticated Staff network normal/SSE immediate/no pending after one
bounded read-only recheck. No reload/login/write or changes to Primary KDSOFF.

### Authenticated current-entry candidate (2026-10-23,15:54Z)

- Extended authenticated Apply/Plan archive reading to six bounded JSON members,
  binding the exact created Access/DNS/QA identities and retired aliases before
  exposing a PRIVATE original provider/Primary baseline. No caller-extracted JSON
  or new current snapshot can replace the ZIPs. Consumed Plan remains history only.
- Added read-only current-entry composition: fixed Vercel/Cloudflare GETs verify
  the retained new entry and old Cloudflare resources, original owner policy/IdP,
  project protection/domain binding/empty project environment, exact old Vercel
  not_found404 and QA-token/policy absence. Complete list count/page evidence is
  required; missing/ambiguous pagination fails closed. Missing policy identity
  also fails closed. Current Primary is compared with the authenticated original
  baseline. Raw responses remain PRIVATE; no tokens, emails or response bodies
  are printed/uploaded. No write, credential reveal, retry or repair path exists.
- New fixture tests exercise the actual provider GET transport, target/team,
  pagination, stale QA policy/token, owner/IdP/domain/project/protection drift,
  malformed404,401/403/429/500 and sanitized failures. Their provenance/Primary
  seams use fixtures; they are not actual provider readback. Five entry and13
  provenance cases PASS; related six files41PASS before the final missing-policy-
  identity regression. That regression was RED1FAIL4PASS, then GREEN; final two
  focused files18PASS. Missing export/module REDs also remain recorded.
- Native Node/Python actual original two ZIPs + four fresh read-only GitHub GETs
  authenticated the six unique members and rejected both byte-tampered archives.
  Private baseline was not logged. No original backup key lookup/decryption,
  isolated restore, current CF/DR provider comparison or independent QA-token
  absence was performed. The existing actual CF absence gap therefore remains.
- Diagnostic-only and planQualified=false throughout. Entry configuration match
  would not prove real human IdP/ordinary Chrome acceptance, runtime deployment,
  sequence quiescence, full original-state equivalence or continuation authority.
  Current source/ref/main-remote-readiness binding and protected composition are
  still required before normal review; no Plan/Apply/reset/helper dispatch.
-23 uncommitted candidate paths, HEAD3965f1dc unchanged. No commit/push/PR,
  protected workflow, provider write, service start/stop, build/application E2E
  or key lookup. LINE56863 remains the sole running container; no new container.
 15:52:28Z Primary hostname/alias/project/dpl4v5/revision4e95/public mode/epoch and
  connectivity/login stayed unchanged. Separate authenticated ordinary Staff
  network normal/SSE immediate/no pending after one bounded re-read; no reload,
  login/write or KDS change. AOCI15:42 full delivery confirmed; one zero-entry
  attestation/governance failed, source-bound only, no shared-root initialization.

Final full regression after the policy-identity fix:3556PASS/9SKIP,
581filesPASS/2SKIP,119.29s,exit0. Lint/type/guardrails2357files146migrations,
diff and backup-bound-input comparison PASS. Earlier110.38s full PASS preceded
the added missing-identity regression and is not the final-version evidence.
Only documentation/state updates followed; no source change after final tests.

### Current source and main remote-readiness binding (2026-10-23,16:12Z)

- Added a read-only source observer. The actual checkout HEAD must equal the
  requested SHA, live main must still match it, and both live commit trees must
  match. The original six-gate query, first-match selection, page-count assertion
  and success predicates are reused unchanged. Separate exact-run GETs bind each
  positive run ID/attempt to the expected repository, push branch, SHA and workflow.
  This candidate requires six distinct main/staging run identities; it does not
  silently deduplicate the two branch gates or change the old source diagnostic.
- Main's selected Readiness latest attempt must contain successful verify-local
  and verify-remote jobs. All nine required remote verification/receipt steps
  must actually complete successfully with bounded job/step timestamps, while
  all seventeen known Production mutation-path steps remain skipped. Reject
  missing/duplicate/invalid job or step identity and incomplete job-list counts.
  Re-read the latest main Readiness attempt and both refs before returning.
  This is bounded observation, not an atomic lock on future runs/refs/providers.
  Staging's main-only remote skip is explicitly not claimed as remote PASS.
- Five permanent tests exercise the real observer, existing six-gate verifier
  and fixed GitHub fetch boundary; child-process Git reads and HTTP responses
  are fixtures. They reject malformed/stale checkout/ref/tree, first-match failure,
  full page, missing gate, foreign repo/branch/event, malformed run identity,
  changed attempt, skipped/missing remote work, invalid time bounds, duplicated
  steps, executed Production mutation paths and401/403/429/500 without retry.
  Missing-module RED preceded implementation; focused observer + original source
  suite21PASS. No independent native positive observer run or protected invocation
  was performed. Two actual read-only GitHub GETs inspected the existing main
  Readiness run and attempt jobs to confirm API field/step shapes; these reads
  do not qualify the unreviewed candidate or reconstruct the old source failure.
- Final full unit regression3561PASS/9SKIP,582filesPASS/2SKIP,110.89s,exit0.
  Focused lint/type/guardrails2359files146migrations/diff PASS; backup-bound inputs
  unchanged.25 uncommitted candidate paths at HEAD3965f1dc. No protected workflow,
  original-key lookup/decryption, live remaining-data comparison, commit/push/PR,
  dispatch/Plan/Apply/reset/helper/provider write or new application build/E2E.
  No services started/stopped; LINE56863 independently remains the sole running
  container. Existing lab data and stopped containers are preserved.
-16:10:54Z Primary actual hostname/alias/project/dpl4v5/revision4e95 and public
  NORMAL_PRIMARY/PRIMARYepoch3/version/connectivity/login200 unchanged. Separate
  ordinary authenticated Staff network normal/SSE immediate/no pending after one
  bounded read-only recheck; no reload/login/write or KDSOFF change. AOCI16:02
  complete delivery confirmed; one zero-entry attestation/governance failed,
  source-bound only and no shared-root initialization.

Next assemble and test the protected read-only composition/workflow, then obtain
normal review. Original encrypted replay/live comparison, independent current CF
QA absence, historical global-role proof, sequence-writer quiescence and fresh
independent credentials remain unproven. All full-proof/Plan qualification flags
remain false; consumed Plan/Apply IDs remain unusable. No continuation/reset is
authorized by this diagnostic-only source observer.

### Protected read-only composition candidate (2026-10-23,16:34Z)

- Added `staging-partial-retirement-readonly.mjs/test` and the separate manual
  `dr-staging-partial-proof.yml` candidate. Owner/main/protected-ref/workflow/SHA/
  run-attempt context is checked against the live running GitHub run; local,
  fork, rerun, wrong actor/path/ref and terminal-state substitutes fail closed.
  This is uncommitted source, not a reviewed or executed protected workflow.
- Downloads only the three fixed raw archives with exact byte bounds and pinned
  hashes. One HTTPS signed artifact redirect is allowed only on approved storage
  suffixes, without forwarding authorization or following further redirects.
  Existing readers independently validate archive metadata/expiry/provenance.
  Backup-bound migrations/seed/rehearsal/preparation Git diff must remain empty.
- Composes existing authenticated backup/failed-Apply/consumed-Plan readers,
  offline restore and completed retirement replay, combined remaining rows/catalog,
  and current source/entry/Primary/isolation/global observers. Final source/entry/
  isolation/global readback must match. Public output explicitly enumerates fields,
  never spreads a private adapter response; errors retain only a fixed code/phase.
  Full-proof and Plan qualification remain false, including historical global
  roles, sequence atomicity/quiescence, fresh independent credentials and actual
  human/runtime acceptance. No continuation or remote mutation is implemented.
- Workflow uses production environment, contents/actions read, existing shared
  concurrency, locked dependencies without install scripts, and a fresh pinned
  network-none/mount-free/port-free Docker copy. Secrets exist only on the proof
  step. Always cleanup verifies exact container/run ownership and stops/read-backs
  that ID; no prune/deletion of retained data. Only the public receipt is uploaded.
  Git child environments were narrowed in the new source reader and reused source
  verifier; original query/selection/count/success predicates remain unchanged.
- Missing-module RED and next two failing archive/workflow tests preceded their
  implementation. Five new cases cover context/live-run rejection, fixed bounded
  raw downloads, malicious redirects, error privacy and workflow safety contracts.
  Source regression additionally proves Git receives PATH/SystemRoot only, never
  backup/provider keys. Focused four files30PASS; full3566PASS9SKIP,583filesPASS/
  2SKIP,110.61s,exit0. Lint/type/guardrails2362files146migrations/diff PASS; backup-
  bound inputs unchanged. A later ignore rule only keeps the public local receipt
  out of Git; no product code changed after this full run.
- Native actual CLI on the real local context exits1 at invocation with the
  sanitized false-qualification receipt: this is the required negative boundary,
  NOT a protected positive test. No fake GITHUB_ACTIONS/ref, original-key lookup,
  original decrypt/restore/live comparison, current CF absence, deployment,
  commit/push/PR/dispatch/Plan/Apply/reset/helper/provider mutation or new build/
  application E2E. No service changes; LINE56863 remains the only running container.
-16:32:24Z Primary actual hostname/alias/project/dpl4v5/revision4e95 and public
  NORMAL_PRIMARY/PRIMARYepoch3/version/connectivity/login remain unchanged.
  Separate ordinary authenticated Staff network normal/SSE immediate/no pending
  after one bounded read-only recheck; no reload/login/write/KDSOFF change.
  AOCI16:20 full delivery confirmed; one zero-entry attestation/governance failure,
  source-bound only and no shared-root initialization.

Next review the entire uncommitted candidate against fixed HEAD3965f1dc, including
the newly connected workflow and failure/cleanup boundaries. Positive protected
execution must follow normal reviewed promotion, never local key extraction or
reusing consumed runs. Existing slice passes do not establish end-to-end success.

### Composition review follow-up (2026-10-23,16:57Z)

- Two independent read-only reviews (Spec and documented Standards) identified
  the missing late-decision regression seam. Extracted a pure diagnostic receipt
  policy, without injecting readers into the protected entry or mocking owned
  modules. Matching observations, each shape-preserving late source/entry/Auth-
  Edge/global drift, missing observations, incomplete match flags and private
  output exclusion are covered. The protected entry still obtains all evidence.
  This pure function is not provenance and cannot authorize continuation.
- Initial new tests were3FAIL5PASS. Review caught that malformed string drift
  exercised shape rejection rather than equality: corrected to valid SHA and
  nested-object mutations. Temporarily removing all four equality checks then
  produced1FAIL7PASS; the checks were restored before final tests. Both reviews
  confirmed no remaining actionable finding in this scoped seam.
- Read-only official ECR manifest inspection established pinned80d7b27c... is
  the OCI index; amd64 manifestb021e96054128399f84f24e39d29c21ee7c7169515e5d9e4e99ff15d5043d1d8
  binds config2d3ac69ad5c95d81458cc93a6cc6c31a98dfa00cd28f88a0a9358d315e1c357a.
  Desktop container inspection reports the index; classic Docker may report the
  config. The new1FAIL17PASS regression preceded accepting only this exact pair
  plus an exact pinned Config.Image reference. Workflow pull/create explicitly
  use linux/amd64; arbitrary digests/tags remain rejected. No actual GitHub Docker
  invocation or new image/container was created by this investigation.
- Executed the exact cleanup Bash body against an external fake Docker binary:
  eight cases cover success, no target, invalid target, each owner/task/run label,
  failed stop and still-running readback. Only the exact target can reach stop;
  failures propagate. The initial single eight-case test exceeded its5000ms
  deadline; split into eight independent cases without increasing deadlines.
 16readonly tests PASS. Only generated fixture directories were removed, not
  real containers/data; this is not actual protected-run cleanup evidence.
- Final full regression3578PASS9SKIP/583filesPASS2SKIP/108.59s exit0 after all
  product and test edits. Focused lint/type/guardrails2362files146migrations/diff
  PASS; dependency audit0. Production build compiled and generated101pages.
  Backup-bound diff remains empty, as does app/src/components/lib/prisma/supabase/
  package/lock/Next config diff against origin/staging. No new application E2E or
  DB suite run; fresh required PR/paired checks and ordinary Chrome remain gates.
  Mistaken npm test:unit and absent owned .mcp.json lookups are retained as local
  command errors, not application failures; corrected npm test is the full run.
-30uncommitted candidate paths (7tracked+23new), HEAD3965f1dc unchanged. No
  commit/push/PR/dispatch, original key lookup/decrypt/restore/live comparison,
  independent current CF QA absence, Plan/Apply/reset/helper/provider write.
 16:50:58Z actual Primary alias/project/dpl4v5/revision4e95/public NORMAL_PRIMARY/
  PRIMARYepoch3 preserved; separate ordinary authenticated Staff network normal,
  SSE immediate/no pending on first read, no reload/login/write/KDS change.
  LINE56863 remains the sole running container; no actual service was started.
- AOCI16:43 full current transport/delivery confirmed, one zero-entry attestation
  failed and governance remains false. Service still binds the shared skeleton,
  not this owned checkout; do not claim owned maintenance/alignment or initialize
  another workspace. Continue source-bound normal release preparation only.

Next perform normal candidate release preflight and exact-path commit/PR to
Staging, preserving other work and checking the two release owners before remote
writes. Fresh CI/paired Preview/ordinary Chrome must precede normal promotion.
Only then may the separate reviewed protected diagnostic be run; all consumed
conversion IDs stay forbidden and all full-proof/Plan flags remain false.
