# Replication Conflict Runbook

## Immediate response

1. Stop application writes to the affected standby and confirm Primary remains
   the only writer.
2. Disable DR report routing.
3. Capture sanitized subscription status, replay LSN, retained WAL size,
   migration digest and the first provider error code.
4. Do not skip, delete or manually rewrite customer rows to restart apply.
5. Classify the conflict: schema drift, missing relation, uniqueness conflict,
   foreign key order, replica identity, permissions or unavailable source.

## Recovery

- Schema drift: apply the missing additive migration to DR, then resume.
- Permission/RLS ownership: restore the reviewed owner, grants and
  `SECURITY DEFINER` search path.
- Duplicate key: establish which backend accepted the write and reconcile by
  business idempotency identifiers before resuming.
- WAL growth: disable report routing, repair the subscriber promptly, and
  preserve the slot unless disk safety requires the approved backup fallback.
- Unrecoverable subscription: take encrypted backups, remove the subscription,
  reseed fenced DR, validate checksums, then create a new subscription.

Record the incident, affected table class, last good LSN, estimated RPO,
operator, approver, repair action and validation result in
`backend_failover_events`. Do not store customer notes, payment references,
credentials or full Auth identifiers in incident metadata.
