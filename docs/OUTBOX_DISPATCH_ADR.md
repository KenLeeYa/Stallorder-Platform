# ADR: P1 outbox dispatch and dormant domain events

- Status: Accepted for P1
- Date: 2026-08-13
- Scope: `notification_outbox` and `domain_outbox`

## Context

`notification_outbox` has transactional producers in the billing entitlement SQL, but previously had no consumer. The existing `notification_jobs` processor is a different queue and cannot safely claim these rows. `domain_outbox` has two current producers in offline synchronization—`ORDER/OFFLINE_ORDER_IMPORTED` and `CASH_SHIFT/OFFLINE_CASH_EVENT_IMPORTED`—but no approved destination, payload version, delivery semantics, or downstream consumer contract.

## Decision

The billing notification consumer uses atomic PostgreSQL claims with `FOR UPDATE SKIP LOCKED`, a ten-minute worker lease, and at most five attempts. The migration preserves the existing `notification_outbox.status` constraint unchanged: persisted states remain `PENDING`, `DELIVERED`, `FAILED`, and `CANCELLED`. A `PENDING` row with `claimed_by_worker` and `lease_expires_at` is actively leased; a `PENDING` row with a future `available_at` is waiting for retry; `FAILED` is the terminal dead-letter representation. `RETRY_PENDING` and `DEAD_LETTER` are worker outcome names only and are never stored in `status`. Expired leases are recovered. Completion is reentrant, and every provider call receives the stable key `notification-outbox:<outbox-id>` so a retry after a crash reuses the same idempotency identity.

Retries are bounded at 1, 5, 15, 60, and 360 minutes. Provider errors marked non-retryable, including the disabled EMAIL provider, go directly to terminal `FAILED` while the worker reports a `DEAD_LETTER` outcome. `IN_APP` is a no-op delivery because the authoritative `billing_notifications` row was already committed in the producer transaction. This consumer does not enable an external provider or perform a real external send.

The cron route fails closed unless `CRON_SECRET` is configured and supplied as a matching bearer token. Responses and worker logs contain only aggregate queue health, outbox identifiers, channel, attempt number, and sanitized error codes; they exclude notification payload, recipient, and secrets.

Queue health reports pending depth from `PENDING` rows, oldest pending age, and dead-letter depth from `FAILED` rows. Alerts fire when depth exceeds 100, age exceeds ten minutes, or any dead letter exists.

`domain_outbox` remains dormant until a separate ADR defines a versioned event contract and an idempotent downstream consumer. The two observed offline producers write their rows directly as `CANCELLED` with `DOMAIN_OUTBOX_DORMANT_NO_CONSUMER`; no other producer is approved in application code. The first dispatcher cycle and every later cron cycle quarantine any legacy nonterminal rows and emit an aggregate alert, so the additive migration does not rewrite live data and no dormant event remains indefinitely pending or appears delivered. A database trigger on the pre-existing table was intentionally rejected because changing a security-sensitive object outside the additive provenance boundary requires a separate reviewed migration plan.

## Failure behavior

- Concurrent workers cannot claim the same active lease.
- A worker crash before completion leaves the row recoverable after lease expiry.
- A crash after provider acceptance may repeat the provider call; the stable delivery key is the idempotency boundary.
- Claim ownership is required for completion or failure updates.
- Disabled EMAIL delivery is an explicit dead letter, never a false success.
- Unapproved domain event writers are rejected in code review and release validation; any legacy nonterminal row is quarantined by the dispatcher before health is reported.

## Verification contract

Unit and failure-injection tests cover retry bounds, stable delivery identity, crash-after-send recovery, provider timeout, disabled EMAIL, IN_APP no-op behavior, PII-free log fields, and cron authentication. `supabase/tests/database/p1_outbox_dispatch.test.sql` covers claim ownership, lease recovery, reentrant completion, retry/dead-letter transitions, health metrics, function privileges, and legacy quarantine. Offline E2E verifies the two approved producers create already-cancelled rows.

## Follow-up required before activating domain delivery

A future ADR must name the destination and owner, version each payload, define ordering and replay behavior, set retention and dead-letter operations, provide an idempotent consumer, and add failure-injection plus remote staging evidence. Removing the dormant guard without those artifacts is not approved.
