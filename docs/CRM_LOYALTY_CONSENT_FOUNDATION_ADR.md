# QR-P3-05 CRM / Loyalty Consent Foundation ADR

- Status: Proposed; local foundation only
- Date: 2026-08-13
- Owners: Product, Legal/Privacy, Security, Merchant Operations
- Production gate: Closed

## Context

CRM and loyalty processing must not be inferred from ordering contact data. An order must remain fulfillable when a customer declines, withdraws, unsubscribes, or erases optional CRM/loyalty processing. The foundation follows the supplied ICO valid-consent criteria: consent is freely given, specific, informed, unambiguous, separate and granular, easy to withdraw, and supported by records.

## Decision

1. `CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED` is created with `default_enabled = false`. This migration does not enable it. Production activation requires explicit Product, Legal/Privacy, Security, and Merchant Operations approval.
2. The foundation never reads existing `orders.customer_phone` or other order contact fields to discover, backfill, or auto-convert CRM profiles. It does not alter order tables, checkout, or fulfillment. Declining or withdrawing consent therefore cannot block order creation or fulfillment.
3. A profile may be created only by the service-role `opt_in_crm_loyalty_profile` RPC after a trusted upstream has verified the contact. The database stores a one-way identifier hash and an opaque encrypted/vault reference, never the clear contact value.
4. Consent evidence is append-only and records purpose, notice version, source, timestamp, lawful basis, verification timestamp, withdrawal source/reason, and retention expiry. One purpose never implies another. Loyalty membership is a separate purpose from marketing.
5. Loyalty balance is the sum of an immutable points ledger. `EARN`, `ADJUST`, `EXPIRE`, and `REVERSE` entries are idempotent by tenant/stall/source event. Refund or cancellation uses a new reversal entry linked to the original ledger entry; it never recomputes points from the current order total.
6. Withdrawal and unsubscribe add evidence and immediately suppress the applicable optional processing. Erasure removes operational contact references and leaves only pseudonymous consent/ledger evidence plus a minimal immutable erasure tombstone where required for legal/audit defense.
7. All tables are tenant/stall scoped, forced-RLS, and manager-readable only through minimum column grants. Runtime mutation is available only through service-role RPCs. Audit metadata excludes contact identifiers and contact references.

## Provisional policy requiring approval

- Consent notice copy, translations, purpose taxonomy, lawful-basis assessment, age/capacity handling, and proof shown to the customer require Legal/Privacy approval.
- Profile retention is provisionally 365 days; consent evidence is provisionally 730 days; erasure tombstones are provisionally 2,190 days. These are schema bounds, not approved policy.
- Points earn rates, expiry windows, partial-refund behavior, negative-balance rules, fraud controls, and accounting treatment require Product, Finance, and Merchant Operations approval. The foundation stores supplied point deltas and supports full linked reversal only.
- No UI, campaign sender, external CRM integration, or automated order-contact import is authorized by this ADR.

## Consequences

- Local database and server contracts can be tested without exposing the feature.
- Consent capture UI and verified-contact workflows remain future, separately reviewed work.
- Production Gate remains FAIL until the approvals above, Staging validation, privacy/security review, and operational runbooks exist.
