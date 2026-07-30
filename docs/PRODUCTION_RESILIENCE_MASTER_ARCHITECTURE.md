# StallOrder Production Resilience Architecture

## Current decision

StallOrder uses three independent continuity layers:

```text
Cached public menu and stateless online compute
-> one authoritative writable PostgreSQL backend
-> one asynchronous read-only DR standby
-> one approved Offline Leader device per Stall
```

This is not a multi-writer or Active-Active database design.

| Layer | Normal state | Failure behavior |
| --- | --- | --- |
| Online compute | Supabase Edge Circuit A, Vercel Circuit B | Browser uses bounded circuit fallback with the same idempotency identifiers |
| Data backend | Primary `ACTIVE_WRITER`, DR `READ_ONLY_STANDBY` | Manual, fenced DR promotion after readiness approval |
| Stall operation | Online Staff POS | Approved Offline Leader records durable local transactions and later synchronizes |

## Invariants

1. A customer QR order is successful only after the active writer commits it.
2. Turnstile, QR session, rate limit, trusted pricing, idempotency, RLS and tenant scope remain authoritative.
3. DR report reads are eventual, flag-gated and limited by measured replication lag.
4. Authentication, current membership, entitlement, product state, payment, checkout, cash shift and KDS remain Primary-only until promotion.
5. Storage bytes, Auth configuration, DDL and sequences require separate continuity procedures.
6. Backend promotion is manual until repeated game-day drills demonstrate an acceptable RTO/RPO.
7. Environment-local backend and replication observations are never logically replicated.

## Delivery state

| Capability | State |
| --- | --- |
| P0 audit and isolated logical-replication proof | Verified |
| Ephemeral PR validation and resilience flags | Implemented |
| Dual online order-intake circuits | Implemented, disabled by default |
| Backend state, fencing and DR read-routing foundation | Implemented, enforcement disabled by default |
| Auth project identity mapping | Implemented; DR behavior requires DR OAuth configuration |
| Storage outbox, checksum mirror and asset fallback | Implemented; worker requires reviewed DR credentials |
| Existing Staging conversion | Not executed |
| Production logical replication | Not enabled |
| Automatic DR promotion | Intentionally not enabled |

Use expand, migrate, deploy, verify, then contract in a later release. Apply the
schema to DR first only after the project conversion checklist is approved.
Enable fencing before creating a subscription. Production Primary remains the
only writer during normal operation.
