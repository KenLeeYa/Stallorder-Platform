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

Rollback uses `--rollback` and the confirmation
`ROLLBACK_PRIMARY_TO_DR`. It removes the DR subscription before the Primary
publication and does not delete business data.

## Schema sequence

1. Apply additive migration to fenced DR.
2. Validate schema digest and RLS.
3. Apply the same migration to Primary.
4. Deploy compatible Edge and Vercel code.
5. Enable the feature for a system canary.
6. Perform destructive contract changes only in a later release.

DDL, sequences, Auth settings, Storage objects, Vault values and project
secrets are not replicated.

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
