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
