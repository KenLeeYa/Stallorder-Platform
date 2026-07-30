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

`.github/workflows/production-dr-operations.yml` has two manual operations.
Both use the protected GitHub `production` environment and serialized
concurrency.

### `bootstrap`

Confirmation: `CREATE_PRODUCTION_DR`

1. Require the exact verified Staging tree.
2. Create encrypted logical backups of Primary and the former Staging project,
   including public data plus Auth and Storage metadata.
3. Restore-test both public data backups against the reviewed migrations and
   validate every archive before encryption.
4. Upload only encrypted backup artifacts.
5. Reset the former Staging project and clear the fixed logical-replication
   table scope.
6. Configure DR Auth redirects, Edge secrets and Edge Functions.
7. Enable database writer fencing.
8. Create the least-privilege logical-replication role, publication and
   subscription.
9. Wait for every relation to reach ready state and prove LSN/canary catch-up.
10. Reserve DR sequences and run the readiness gate.

### `drill`

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
- `SUPABASE_DB_PASSWORD`
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
time and masked before use.

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
The current conversion blocks if either project contains Storage bytes because
database metadata alone is not an object backup.
Drill uploads sanitized JSON and Markdown evidence, including measured RTO,
RPO, failback time, deployment URLs, smoke results and replication state.
