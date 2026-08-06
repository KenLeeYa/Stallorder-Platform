# Production DR Automation

## Scope

StallOrder uses one writable Supabase Primary project and one asynchronous,
read-only Supabase DR project. Both projects are currently in Tokyo
`ap-northeast-1`; therefore this protects against a project-level failure, not
a complete Tokyo regional outage. Vercel Functions remain in `hnd1`.

The persistent test environment has been replaced by the paired ephemeral
Preview workflow:

```text
Pull Request
-> data-less Supabase Preview Branch
-> reviewed migrations and synthetic fixtures
-> matching Vercel Preview
-> synthetic OAuth, webhook, order, KDS and payment checks
-> automatic cleanup when the Pull Request closes
```

Production DR operations never use a Preview Branch and may run only from the
verified `main` tree after it matches `staging`.

## Protected workflow

`.github/workflows/production-dr-operations.yml` has five protected Plan/Apply
pairs: DR schema, incremental replication, bootstrap, drill and Storage canary.
All use the GitHub `production` environment and serialized concurrency.

Every write operation requires two separate workflow runs:

1. run the matching `plan-*` operation with `PLAN_PRODUCTION_DR`;
2. review the uploaded dry-run artifact;
3. run the matching Apply operation from the same `main` commit with the Plan
   run ID and its operation-specific confirmation.

The receipt expires after 24 hours and binds the repository, workflow, Plan
run, commit, exact Staging tree, operation and non-sensitive parameters.
Bootstrap also binds `resume_backup_run_id`. Apply is rejected for a failed,
expired, replay-self, cross-workflow, cross-commit or non-owner Plan.

### Routine additive release order

1. Complete local and paired Preview QA.
2. Run `plan-dr-schema`, then `dr-schema` with
   `APPLY_PRODUCTION_DR_SCHEMA` and the reviewed Plan run ID.
3. Run `Production Readiness` Plan/Apply with that successful DR schema run ID.
4. Keep new feature writes disabled after the compatible application deploy.
5. Run `plan-incremental-replication` with the successful Production run ID,
   then `incremental-replication` with its Plan run ID and
   `UPGRADE_PRODUCTION_DR_REPLICATION`.
6. Enable a canary or feature only after snapshot/readiness verification.

`dr-schema` performs the DR migration list, fail-closed additive SQL check,
exact pending-file/content digest, `db push --dry-run`, and database lint again
before Apply and compares their immutable digest with the Plan. It
pushes only ordinary pending migrations, then repeats list, dry-run and lint.
It never resets, seeds, uses `--include-all`, or tears down replication.

Incremental replication is upgrade-only. It requires a successful immutable
Primary-migration evidence artifact and existing reviewed publication and
subscription objects. Its live Plan and Apply validate exact relation/column
scope, replica identities, subscription flags and endpoint identity. They also
require every published table/column to exist physically on DR, forbid
`hostaddr`, and require `sslmode=require` plus `row_security=off`. The approved
Plan is reconfirmed byte-for-byte immediately before mutation.

### `bootstrap`

Plan operation: `plan-bootstrap` with `PLAN_PRODUCTION_DR`

Confirmation: `CREATE_PRODUCTION_DR`

Bootstrap is retained only for first-time creation or a separately approved DR
rebuild. Routine schema releases must use `dr-schema` followed by the
upgrade-only incremental replication operation; they must not reset DR.

1. Require the exact verified Staging tree.
2. Create encrypted logical backups of Primary and the former Staging project,
   including public data plus Auth and Storage metadata.
3. Restore-test both public data backups against the reviewed migrations,
   restoring their matching `auth.users` dependency first, and validate every
   archive before encryption.
4. Upload only encrypted backup artifacts.
5. Reset the former Staging project and clear the fixed logical-replication
   table scope.
6. Configure DR Auth redirects, Edge secrets and Edge Functions.
7. Enable database writer fencing.
8. Create the least-privilege logical-replication role, publication and
   subscription. The `profiles` publication excludes the Primary-only
   `auth_user_id`; DR resolves its own Auth users through
   `profile_auth_identities`.
9. Wait for every relation to reach ready state and prove LSN/canary catch-up.
10. Reserve DR sequences and run the readiness gate.

If bootstrap fails after the encrypted backup artifact was uploaded and after
the former Staging conversion began, rerun `bootstrap` with
`resume_backup_run_id` set to that verified workflow run. The workflow accepts
the artifact only when:

- it belongs to an ancestor of the current verified `main` commit;
- its metadata records a successful former Staging restore test and encryption;
- all three former Staging encrypted dump checksums pass;
- all three archives decrypt with the protected key and pass PostgreSQL 17
  archive validation;
- the recorded former Staging Storage object count is zero.

Resume mode creates and restore-tests a fresh Primary backup. It reuses only the
verified, encrypted former Staging backup and does not treat a partially reset
DR candidate as a new recovery source.

### `drill`

Plan operation: `plan-drill` with `PLAN_PRODUCTION_DR`

Confirmation: `MEASURE_PRODUCTION_DR`

1. Prebuild Primary, DR and Primary-failback Vercel deployments without moving
   domains.
2. Promote the DR-aware Primary deployment and verify it.
3. Write and replicate a final RPO canary.
4. Freeze Primary writes and capture the authoritative freeze timestamp.
5. Wait until DR replay reaches the post-freeze WAL LSN.
6. Disable the one-way subscription and capture a business-table write
   fingerprint.
7. Promote the DR database, then promote the prebuilt DR Vercel deployment.
8. Poll the public availability endpoint to measure actual RTO.
9. Run only read-only Production smoke tests.
10. Prove the DR business fingerprint did not change.
11. Freeze DR, reconcile drill audit events, restore Primary, re-enable
    replication and validate Primary.

The workflow refuses automatic failback if DR business data changed. This
prevents silent loss of DR-era writes.

### `storage-canary`

Plan operation: `plan-storage-canary` with `PLAN_PRODUCTION_DR`

Confirmation: `PROVE_STORAGE_DR`

1. Require the exact verified Staging tree.
2. Build temporary protected Primary and DR database connections through the
   authenticated Supabase Management API.
3. Export current Primary and DR Storage credentials without printing them.
4. Run and record a no-write dry-run plan.
5. Upload one random JSON object containing no customer data to the dedicated
   `system-canary/storage` prefix.
6. Create the normal manifest and replication outbox job.
7. Wait for the deployed Production replication cron to mark the manifest
   `MIRRORED`.
8. Download both objects and compare their SHA-256 checksums.
9. Delete both objects and the Primary manifest/outbox records.
10. Wait for the manifest deletion to replicate to DR.

The canary fails if byte checksums differ, the outbox reaches `FAILED`, the
timeout is exceeded or cleanup is incomplete. Its artifact contains only a
random canary identifier, checksums, duration, high-level status and cleanup
result.

## RTO and RPO definitions

- RTO starts at the committed Primary write-freeze timestamp and ends when the
  public Production availability endpoint reports the DR backend and expected
  promotion epoch.
- Database RPO is zero only when DR replay is at or beyond the post-freeze
  Primary WAL LSN and the canary row is present.
- Canary replication latency is reported separately from RPO.
- Failback time starts at the committed DR freeze timestamp and ends when the
  public Production endpoint reports the restored Primary epoch.

No report may claim measured RTO or RPO until the workflow artifact contains
`production-dr-result.json`.

## Required protected configuration

GitHub `production` environment secrets:

- `SUPABASE_ACCESS_TOKEN`
- `DR_SUPABASE_DB_PASSWORD`
- `PRIMARY_REPLICATION_PASSWORD`
- `DR_BACKUP_ENCRYPTION_KEY`
- `VERCEL_TOKEN`

GitHub `production` environment variables:

- `PRIMARY_SUPABASE_PROJECT_REF`
- `DR_SUPABASE_PROJECT_REF`
- `APP_BASE_URL`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Values must never be committed or printed. Database URLs are assembled at run
time and masked before use. The workflow retrieves each project's current
Supavisor and database endpoints from the authenticated Supabase Management
API; it does not hard-code a regional Pooler hostname. Primary administrative
connections use the PAT through Supabase Temporary Access with a two-hour
`postgres` mapping that is renewed per operation. Production application
connections continue using Vercel's existing encrypted database variables;
the DR workflow does not reset or disclose that password.

## Recovery

Before DR database promotion, any failed step:

1. restores the Primary writer fence,
2. re-enables the DR subscription,
3. closes the time-bounded failover flag,
4. promotes the previously verified Primary deployment, and
5. waits for the public endpoint to report Primary.

After DR traffic is active, automatic Primary failback is allowed only after
the before/after business fingerprint matches. Otherwise keep the current
writer fenced and follow `PRODUCTION_FAILBACK_RUNBOOK.md`.

## Artifacts

Bootstrap uploads AES-256-CBC encrypted logical backups and SHA-256 files.
The initial conversion blocked if either project contained Storage bytes
because database metadata alone is not an object backup. New immutable objects
use the Storage manifest/outbox mirror. The protected `storage-canary`
operation proves real object bytes and cleanup independently of database row
replication.
DR schema Apply uploads `production-dr-schema-evidence.json`. A successful
Production release consumes that evidence and uploads
`production-primary-migration-evidence.json`; incremental replication consumes
the latter before it can create its live Plan or Apply. These files contain
only immutable run, commit, tree, operation and completion evidence.
Drill uploads sanitized JSON and Markdown evidence, including measured RTO,
RPO, failback time, deployment URLs, smoke results and replication state.
