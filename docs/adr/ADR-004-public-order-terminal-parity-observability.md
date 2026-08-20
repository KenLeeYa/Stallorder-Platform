# ADR-004: Public-order terminal parity and observability policy

- Status: Accepted for local verification; Production evidence pending
- Date: 2026-08-13
- Scope: QR-P2-05 Circuit A / Circuit B canonical public-order preflight

## Context

The public ordering client may retry one logical operation through Circuit B after Circuit A loses a response or becomes unavailable. A fallback is safe only when both circuits produce the same terminal contract and retain enough correlation to explain the outcome without logging customer data, tokens, or raw network identifiers.

The DB-backed replay suite already proves committed session and order replay. The terminal matrix extends that evidence to domain denials using the same seeded stall, product, QR, table, schedule, capacity, and idempotency contracts.

## Decision

### Shared pure contract and retained failure-domain boundaries

Circuit A and Circuit B import one runtime-neutral pure contract for:

- abuse-behavior key construction;
- public-order line conversion to trusted RPC JSON;
- order and lightweight-session success bodies;
- resumable-session bodies;
- capacity details in terminal error bodies; and
- takeaway pickup-code visibility.

Characterization tests own these shapes directly. The two physical handlers no longer keep
source-copied response formatters whose equality could drift through an unrelated edit.

The following remain independent by design:

- HTTP/CORS parsing and trusted client-IP extraction, because Edge and Next.js have different
  proxy trust boundaries;
- intake, global, and submission rate-limit calls, because the PostgREST and Prisma adapters are
  separate failure domains;
- Turnstile execution and environment lookup, so an Edge runtime/configuration failure does not
  require the Next.js path to share the same transport adapter; and
- full-menu enrichment, because Circuit A queries the canonical tables while Circuit B uses the
  independently deployed server cache.

Moving those responsibilities into one async orchestrator would be an architecture change, not a
safe formatter refactor: it would increase common-mode code and dependency failures. This ADR
therefore treats canonical DB preflight plus the shared pure contract as the local P2-05 boundary.
Calling both handlers "thin adapters" would require a separate decision defining which redundancy
is intentionally sacrificed and new failure-injection evidence for both runtimes.

### Canonical terminal response

For one logical operation, Circuit A and Circuit B must agree on:

- HTTP status;
- stable `code`;
- the complete public JSON payload, including the localized error and any capacity quote;
- the caller-provided `x-stallorder-operation-id`.

Each circuit generates its own `x-request-id`. Those request IDs must be distinct because they identify physical attempts, while the operation ID joins both attempts into one logical operation. Circuit B additionally identifies itself with `x-order-circuit: B`.

The local DB matrix covers:

| Terminal | Status | Public code | DB attempt policy |
| --- | ---: | --- | --- |
| Delivery disabled | 409 | `DELIVERY_UNAVAILABLE` | A and B each record one denied `SESSION_ISSUE` |
| Inactive dining table | 409 | `TABLE_UNAVAILABLE` | A and B each record one denied `SESSION_ISSUE` |
| QR/session schedule drift | 409 | `SCHEDULE_CONTEXT_MISMATCH` | A and B each record one denied `ORDER_SUBMIT` |
| Reused idempotency key with changed command | 409 | `IDEMPOTENCY_CONFLICT` | A and B each record one denied `ORDER_SUBMIT` |
| Automatic capacity pause | 409 | `CAPACITY_PAUSED` | A and B each record one denied `ORDER_SUBMIT` |
| Wait quote not acknowledged | 422 | `WAIT_ACKNOWLEDGMENT_REQUIRED` | A and B each record one denied `ORDER_SUBMIT`; public capacity payload must also match |
| PREORDER without a pickup time | 422 | `PREORDER_TIME_REQUIRED` | Schema rejection occurs before DB access, so neither circuit records a DB attempt |

Known sealed or unavailable infrastructure terminals are not required to create a database attempt when the database is intentionally unreachable. Domain denials produced by canonical preflight are required to create one metadata-only attempt per physical request.

### Audit content

`public_order_attempts` is the domain-denial ledger. Tests require only request ID, event type, outcome, and stable reason code. Production diagnostics may join physical request logs by `x-request-id` and logical fallback logs by `x-stallorder-operation-id`.

The observability contract must not log raw QR tokens, order-session tokens, tracking tokens, customer names, phone numbers, delivery addresses, notes, Turnstile tokens, or raw IP/device identifiers. Existing persisted correlation fields remain one-way hashes.

### PREORDER validation boundary

`createPublicOrderSchema` rejects `orderingMode: PREORDER` with a null `scheduledPickupAt` before either HTTP handler reaches canonical DB preflight. Both handlers preserve that strict validation and map this specifically identifiable issue to the public `422 PREORDER_TIME_REQUIRED` response without exposing raw validation details.

Because the command is rejected before database access, neither circuit writes a `public_order_attempts` row. Request and operation headers remain available for HTTP-log correlation. Other schema failures continue to use the bounded `400 INVALID_REQUEST` contract.

## Verification gate

Local verification requires the terminal matrix to run against the fresh local PostgreSQL/Supabase runtime with `PUBLIC_ORDER_DB_REPLAY=1`. Static or mocked tests alone do not satisfy P2-05. Production rollout still requires the repository's Staging-first migration, CI, application smoke, and immutable release-plan gates.

## Consequences

- Circuit fallback regressions become visible as a status, code, payload, operation-correlation, or audit-policy mismatch.
- Strict PREORDER validation remains intact while the public response gives the customer an actionable recovery code.
- Terminal evidence contains operational metadata only and does not broaden personal-data collection.
