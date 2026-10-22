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
