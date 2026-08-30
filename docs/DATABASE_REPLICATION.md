# Database Replication

## Direction and ownership

```text
Production Primary -> publication -> DR subscription
```

Only Primary is writable in normal operation. Bidirectional replication and
automatic promotion are prohibited.

## Configuration tool

Review the local, no-connection dry run:

```powershell
npm run dr:replication:plan
```

Routine releases must use the protected `Production DR Operations` workflow.
`plan-incremental-replication` performs a live, read-only inspection and the
matching `incremental-replication` Apply is upgrade-only: both the reviewed
publication and subscription must already exist. Initial creation remains a
one-time bootstrap/rebuild operation.

The low-level apply path additionally requires:

```text
--apply --source PRIMARY --target DR
PRODUCTION_ENVIRONMENT_APPROVED=true
DR_CHANGE_CONFIRMATION=CONFIGURE_PRIMARY_TO_DR
DIRECT_URL
DR_DIRECT_URL
PRIMARY_REPLICATION_URL
```

Do not place these connection values on the command line, in GitHub logs or in
the repository. The script emits only sanitized status and never prints URLs.

The dedicated replication role has `REPLICATION`, `BYPASSRLS`, `LOGIN`, a
four-connection limit and read-only grants on the explicitly published tables.
`BYPASSRLS` is required because every exposed application table uses forced
RLS; without it, PostgreSQL's initial subscription copy can silently see zero
rows. The replication connection also sets `row_security=off`, so losing the
required privilege fails closed instead of producing an incomplete standby.

Rollback uses `--rollback` and the confirmation
`ROLLBACK_PRIMARY_TO_DR`. It removes the DR subscription before the Primary
publication and does not delete business data. It accepts a disabled reviewed
subscription and safe subsets of the allowlisted publication/subscription
scope, while still rejecting unexpected relations, endpoint identity or
subscription flags. It is rerunnable after a disable/drop or add/refresh
partial failure, so a failed bootstrap can remove only the reviewed pair before
rebuilding the standby.

An invalidated logical slot cannot be resumed by increasing the catch-up
timeout or advancing the subscriber past missing WAL. If PostgreSQL reports
the slot as `lost`/`wal_removed`, stop incremental repair and use the protected
`plan-bootstrap` / `bootstrap` rebuild. That path creates and restore-tests
encrypted backups, proves the Storage mirror before and after reset, then
creates a fresh initial-copy subscription. Never skip the missing WAL or mark
the disconnected standby ready.

Before any replication mutation, the tool also verifies that DR physically has
every allowlisted base/partitioned table, matching published-column types and
no target-only required column that could reject a replicated insert. The subscription
connection must match the reviewed Primary host, port, database and user,
forbid `hostaddr`, require `sslmode=require`, and set `row_security=off`. The
tool never emits the connection string or password.

## Schema sequence

1. Pass local QA and the paired data-less Preview checks.
2. Run `plan-dr-schema` with `PLAN_PRODUCTION_DR`, review its DR migration
   list, exact pending-file/content digest, `db push --dry-run`, and lint
   artifact, then run `dr-schema` from the
   same `main` commit with that Plan run ID and
   `APPLY_PRODUCTION_DR_SCHEMA`.
3. Run `Production Readiness` Plan with the successful DR schema Apply run ID,
   then Apply the same additive migration to Primary with that immutable Plan
   run ID and `APPLY_PRODUCTION_RELEASE`.
4. Keep new feature writes disabled while compatible Edge and Vercel code is
   deployed and verified. The successful Production run publishes immutable
   Primary-migration evidence.
5. Run `plan-incremental-replication` with that Primary-migration run ID,
   review the live exact-diff artifact, then run `incremental-replication`
   with its Plan run ID and `UPGRADE_PRODUCTION_DR_REPLICATION`.
6. Require the replication snapshot/readiness checks to pass before enabling a
   system canary or feature writes.
7. Perform destructive contract changes only in a later release.

DR-first schema migrations must not insert, update, delete or truncate rows in
replicated tables. Those writes would be repeated by Primary logical
replication and can stop the apply worker on a row conflict. The
`20260830010000` electronic-invoice flag seed is the final grandfathered
exception; its one-time recovery is protected by the
`plan-replication-conflict-repair` / `replication-conflict-repair` Plan and
Apply pair, which deletes only the verified matching DR seed copies before
replaying Primary WAL and proving exact row equality plus DR readiness.

Routine DR schema Apply is additive-only and never uses `--include-all`, seed,
reset or replication teardown. Never move DR schema changes after the Primary
migration or after the replication upgrade.

DDL, sequences, Auth settings, Storage objects, Vault values and project
secrets are not replicated.

`profiles.auth_user_id` is also excluded from the `profiles` publication column
list because Supabase Auth IDs belong to one project. The `id` replica identity
and every other Profile column remain published. DR login and RLS resolve the
project-local user through the replicated `profile_auth_identities` mapping.

Offline recovery additionally replicates `offline_order_sync_receipts`,
`offline_sync_conflicts`, `domain_inbox` and `domain_outbox`. These records are
required to preserve idempotency and reconciliation when an offline queue
synchronizes after promotion.

Before promotion, `prepare-dr-failover.mjs` inspects every identity/serial
sequence owned by a replicated table and advances the DR sequence above both
observed maxima with a reserve. The same operation runs in the opposite
direction before failback. Gaps are expected; uniqueness is mandatory.

## Monitoring

`GET /api/cron/replication-health` stores sanitized observations in
`replication_health_snapshots`. Alert when:

- the subscription worker is disconnected;
- schema history differs;
- lag exceeds 30 seconds;
- an observation is older than 60 seconds;
- retained slot WAL grows unexpectedly.

The report read router returns to Primary on any missing, stale or unhealthy
evidence.

Promotion and failback procedures are documented in
`PRODUCTION_FAILOVER_RUNBOOK.md` and `PRODUCTION_FAILBACK_RUNBOOK.md`.
