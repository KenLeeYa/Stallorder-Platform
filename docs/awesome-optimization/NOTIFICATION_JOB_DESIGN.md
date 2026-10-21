# Existing report delivery execution contract

Batch 4b keeps `report_deliveries` as the existing report owner. The existing report cron route calls the existing Node worker; this change adds no scheduler, queue, ledger, status enum, or API authentication mechanism. This document describes the implementation contract; runtime acceptance is recorded separately in `batch-4b-report.md`.

## Intent, snapshot, and effect

A new delivery starts at lifetime attempt zero with a versioned immutable intent: report schedule fingerprint, authorized stall IDs, provider mode and binding, and one stable idempotency key. The database rejects edits to the delivery identity, organization, schedule, period, recipients, subject, intent, and request correlation. Legacy deliveries without this contract are quarantined as UNKNOWN and are not upgraded by guessing intent.

The claim function locks at most 20 organizations with `FOR UPDATE SKIP LOCKED`, selects at most one eligible job per organization, and atomically increments the lifetime attempt and execution version while creating a 90-second lease. A partial unique index enforces one active lease per organization even when a separate SQL writer races the claim. Only the identified index conflict is translated to SQLSTATE P4B01. The entire claim rolls back; the Node owner recognizes the exact Prisma code/message and rereads committed state. Other database errors propagate.

The original report builder creates the payload and envelope. Their JSONB snapshot and database SHA-256 are persisted before any provider request. Subsequent attempts reuse the identical snapshot, intent, binding, and key. The short pre-effect transaction locks the current delivery, organization, schedule, stalls, subscription, fixed billing flag, matching plan entitlement, subscription add-on items and matching catalog rows. It rereads current authority under Read Committed before the token/version/expiry/hash CAS grants an effect. An absent billing flag uses a conditional table SHARE lock and a fresh reread while preserving the central default. No network call occurs while these authority locks are held. Lock failures deny the effect.

Only the current token/version and unexpired lease may grant an effect or record a completion. The provider timeout is 15 seconds. Expired NOT_STARTED leases may be reclaimed below five attempts; expired IN_FLIGHT leases become UNKNOWN and cannot be automatically resent. A fifth attempt that expires before its effect becomes visibly terminal. Trusted retryable rejection uses bounded backoff, jitter and capped Retry-After; attempts never reset. No detached sleeping job retains a lease.

## Provider evidence

ACCEPTED means the provider accepted a request, not that it was delivered or read. Local simulation is explicitly SIMULATED. Unproved responses, response loss and post-grant crashes remain UNKNOWN. The fixed Resend adapter does not claim a reviewed nonacceptance or idempotency window and its reconciliation lookup currently returns UNKNOWN. No user checkbox, arbitrary endpoint, claimed message ID or operator-provided verdict can authorize a resend.

Manual retry requires persisted trusted nonacceptance for the same binding/snapshot, proof that an older grant cannot resume, current management permission, a current session, CSRF and the expected version. It preserves lifetime attempts and identity. Reconciliation requires a current platform administrator and a trusted fixed-provider lookup with matching key, binding and hash; current profile/session/stall authority is reread after lookup before committing. Unsupported lookup leaves the delivery stopped.

## Operations API and UI

`GET /api/merchant/organizations/:organizationId/report-deliveries` and its detail route require VIEW_REPORTS. Retry/reconcile POST routes require MANAGE_REPORT_SCHEDULES, CSRF and strict expected-version commands. All responses are private/no-store. The redacted v1 summary includes status/effect, version, lifetime attempt/max, reason, operational timestamps and request correlation; it excludes recipients, payload, snapshots, provider identifiers, lease tokens and reconciliation evidence.

Reads default to the organization's current calendar day, have a 90-day maximum range and a 50-row maximum, and use the database's native `(created_at,id)` cursor so microseconds are not rounded away. Cursors must be visible within the same organization and filters. The mounted operations region presents stopped/unknown/accepted states and separate permitted retry/reconcile actions with 48-pixel controls. Current source/build/runtime and browser acceptance must be read from the batch report; this design document alone is not evidence of a completed flow.

## Additive migrations and handoff

The four additive local migrations are `20261001160000_report_delivery_execution.sql`, `20261001163000_report_delivery_attempt_zero.sql`, `20261001164500_report_delivery_claim_conflict.sql` and `20261001171500_report_delivery_claim_code.sql`. The second preserves the legacy attempt range 1..10 while permitting opted-in attempt zero; the new contract independently caps its lifetime at five. The last two preserve function signature, owner, invoker mode, empty search path and grants while narrowing one-org conflict handling. Previously applied SQL bytes are immutable.

`docs/awesome-optimization/qa/report-schema-overlay.mjs` binds the exact approved Prisma schema to the retained local fixture guard. It retains the original corpus digest, original 201 draftVersion-zero applications, two old approval records and prior Staff facts. This local permission is not remote migration approval. Rollback requires a compatible worker or pausing dispatch; an old worker must not send leased/UNKNOWN rows.

Batch 4c should retain this owner while handling its separate scope. Batch 6 should consume the redacted summary/permission seam without treating operations timestamps as delivery/read evidence. Batch 7 should preserve this batch's required local acceptance and independently report real provider, OAuth, native/physical-device, hosted CI and deployed verification. None of those external states is established by local Mock or browser evidence.

## Mounted authority lifecycle

The report region consumes the existing OPERATIONS_AUTH_INVALIDATED event. It synchronously fences late load/mutation callbacks, aborts outstanding requests, clears private items/cursors/ranges/notices and stops automatic reload until a fresh context is mounted. Workspace changes and public logout also invalidate old responses. Shared POS storage is untouched. Local browser evidence combines five unchanged callbacks from browser-2 with the complete four-variant sixth callback from browser-3; it is a declared native Node24 registration runner, not a successful ordinary Playwright runner. See the batch report for exact source/build bindings, limitations and independent-review status.
