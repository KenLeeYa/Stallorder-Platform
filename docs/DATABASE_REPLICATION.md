# Database Replication

## Direction and ownership

```text
Production Primary -> publication -> DR subscription
```

Only Primary is writable in normal operation. Bidirectional replication and
automatic promotion are prohibited.

## Configuration tool

Review the dry run:

```powershell
npm run dr:replication:plan
```

The apply path additionally requires:

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
publication and does not delete business data. The rollback is idempotent so a
failed bootstrap can safely remove only the reviewed subscription/publication
pair before rebuilding the standby.

## Schema sequence

1. Apply additive migration to fenced DR.
2. Validate schema digest and RLS.
3. Apply the same migration to Primary.
4. Deploy compatible Edge and Vercel code.
5. Enable the feature for a system canary.
6. Perform destructive contract changes only in a later release.

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
