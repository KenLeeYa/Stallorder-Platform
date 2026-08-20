# ADR: Reservation-linked preorder local foundation

- Status: Proposed / provisional
- Scope: QR-P3-03 local foundation only
- Production decision: Not approved

## Context

StallOrder already supports ordinary `PREORDER` ordering sessions, but it does not have an authoritative reservation record. Reusing an ordinary QR order session as a reservation would let possession of a QR token imply table or time-slot capacity. That is not an acceptable authorization boundary.

This ADR deliberately defines only the local database and server contract. It does not enable a Production customer journey, expose a QR UI, collect money, or promise that the provisional operating policy is commercially approved.

## Decision

### Separate records with an explicit link

- `reservations` is the authority for a table and `[starts_at, ends_at)` interval.
- `reservation_preorder_sessions` is a separate, short-lived preorder capability. It has an explicit foreign key to one reservation and snapshots the reservation version it was issued for.
- This foundation does not insert into or alter the existing `order_sessions` path. A future approved integration may exchange a valid reservation preorder session for the ordinary ordering flow, but that is outside QR-P3-03.
- Modifying or cancelling a reservation revokes its active reservation preorder sessions.

No valid, `CONFIRMED` reservation for an active stall and dining table means no reserved table/time-slot session is issued. A missing, cancelled, completed, no-show, not-yet-open, or cutoff-passed reservation fails closed.

### Feature flag and rollout boundary

`RESERVATION_PREORDER_ENABLED` is inserted with `default_enabled = false`.

- Create, modify, and issue operations require an effective enabled flag for the reservation's organization and stall.
- Cancellation remains available while the flag is disabled so a kill switch cannot trap an existing reservation.
- There is no Production UI or public route in this phase.
- Local migration, pgTAP, unit tests, mocks, and type/lint checks are foundation evidence only. Production readiness additionally requires approved commercial/operations policy, privacy review, Staging validation, deployment evidence, and Production smoke evidence.

### Provisional capacity policy

- One active `CONFIRMED` reservation exclusively owns one dining table for its half-open `[starts_at, ends_at)` range.
- Capacity is enforced under concurrency by a per-table transaction lock and a database exclusion constraint. Adjacent ranges are allowed; overlapping ranges are rejected.
- Existing dining-table data does not contain seat capacity. `party_size` is recorded (1-20) but is not asserted to fit a table. Seat-based inventory, table combinations, buffers, overbooking, and walk-in allocation require an external product/operations decision.
- A reservation lasts more than zero and at most six hours. Cross-midnight intervals are allowed.

### Provisional time policy

All instants are stored as `timestamptz`. Every reservation also stores a validated IANA timezone and derives `local_business_date` from the local date of `starts_at`; this keeps a cross-midnight reservation attached to its starting business date.

Until externally approved, the fixed policy is:

- preorder opens at T-24 hours;
- preorder closes at T-30 minutes;
- modification closes at T-2 hours;
- cancellation closes at T-2 hours;
- late grace ends at T+15 minutes;
- no-show becomes eligible at T+30 minutes.

No-show is a staff decision; this phase does not add an automatic no-show job. The timestamps are persisted so a later approved workflow can enforce the same boundary without guessing.

### Provisional deposit and refund policy

No money is collected in this phase:

- `deposit_amount = 0`;
- `deposit_status = NOT_REQUIRED`;
- `refund_status = NOT_APPLICABLE`.

The database constrains these values. Cancellation never claims that a payment was refunded. Deposit amounts, payment authorization/capture, refund eligibility, fees, late cancellation charges, and no-show charges remain external decisions and require a separate payment design and audit.

### Tenant, token, RLS, and audit boundary

- Composite foreign keys bind reservation organization, stall, and dining table. Session rows repeat organization/stall scope and bind it to the linked reservation.
- RLS is enabled and forced. `anon` has no table access. `authenticated` receives read-only access filtered through the existing server-defined stall-role predicate. Mutation functions are granted only to `service_role`.
- Public reservation and session tokens are never stored raw; only lowercase SHA-256 hashes are persisted. Audit payloads exclude token and device hashes.
- Create, modify, cancel, and session issue emit tenant-scoped audit records with before/after business state.
- Merchant mutation functions require trusted organization and stall scope in addition to the reservation ID. Client-provided IDs alone are not an authorization decision.

## Consequences and follow-up decisions

The foundation can prove atomic table/time capacity and fail-closed session issuance locally, but it intentionally cannot complete a customer preorder. Before any Production surface is enabled, owners must approve table seat capacity, duration/buffer rules, booking horizon, modification and cancellation exceptions, contact/PII retention, notification delivery, deposit/payment/refund rules, no-show authority, accessibility copy, rate limits, and operational support procedures.
