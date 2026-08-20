# Online order payment and reconciliation foundation

Status: Proposed / provisional

Production decision: Not approved

Scope: QR-P3-02 local foundation only

## Decision

The platform will use a provider-neutral two-ledger boundary for online order
payments. No production provider has been selected. `LOCAL_MOCK` is the only
implemented provider and is blocked in Production. The
`ONLINE_ORDER_PAYMENT_ENABLED` resilience flag is created with
`default_enabled = false`; this migration never enables it.

This phase does not add a public route or UI and does not claim that money has
been collected outside the local mock. Cash and existing manual-payment paths
remain available whenever online initiation, provider processing, webhook
verification, or reconciliation fails.

## Authority and state boundaries

1. `app_private.create_online_order_payment_intent` is service-role only. It
   derives amount from `orders.total` and currency from `stalls.currency`; a
   caller cannot provide either value. The organization, stall, and order must
   match. A UUID idempotency key plus a SHA-256 request fingerprint prevents a
   retry from changing the request. One order can have only one intent, closing
   the alternate-key double-capture path.
2. The webhook service verifies the HMAC over the exact raw bytes using
   `timestamp + "." + rawBody` before parsing JSON. The timestamp tolerance is
   five minutes. Accepted input is normalized and only a SHA-256 body digest is
   persisted; the signature, secret, raw payload, and customer PII are not
   stored or logged.
3. A verified provider webhook may insert an
   `online_order_payment_events` row and advance its linked intent. It may not
   insert `payments` or update `orders`. Provider event IDs are unique. An exact
   retry is acknowledged; the same ID with changed content fails closed.
   A second capture event with a different provider event ID after successful
   reconciliation is retained as ignored and cannot reapply payment.
4. `PAYMENT_CAPTURED` has the highest state authority. Later delivery of an
   older authorize/fail/timeout event cannot downgrade it. A captured event may
   supersede an earlier timeout or failure because it is explicit evidence that
   funds were captured. All events remain visible in the normalized ledger with
   `RECORDED`, `IGNORED_OUT_OF_ORDER`, `MISMATCH`, or `APPLIED` processing state.
5. Only the separate `app_private.reconcile_online_order_payment` transaction
   may create the existing `payments` row and set `orders.payment_status` to
   `PAID`. It locks the intent and order, then rechecks organization, stall,
   order reference, amount, currency, captured status, and uniqueness. Only
   `MATCHED` succeeds. Repeating the transaction returns the same payment and
   never inserts twice.

The kill switch blocks new intents. Signed callbacks and explicit
reconciliation for intents that already exist remain available so disabling
new traffic cannot strand a capture that occurred before the switch.

## Security controls

- Both ledgers enable and force RLS. `anon` and `authenticated` receive no
  table access or RPC execution. Mutation is restricted to `service_role`.
- Composite foreign keys preserve organization/stall scope. Immutable webhook
  facts cannot be rewritten after insert.
- HMAC comparison is constant-time. Timestamps, event IDs, and body hashes
  provide replay detection; outbound retries use non-PII UUID idempotency keys.
- Tenant-scoped `audit_logs` entries contain only operation codes and normalized
  non-PII state. Request correlation IDs are SHA-256 hashed before persistence.
  Secrets, signatures, raw payloads, and customer fields are excluded.
- Amount, currency, order, and tenant matches use server-trusted database data,
  not browser success pages or caller-supplied totals.

These controls follow Stripe's guidance to verify against the raw request body,
expect duplicate and out-of-order webhook delivery, and enforce timestamp
tolerance: <https://docs.stripe.com/webhooks>. The outbound idempotency contract
follows Stripe's guidance to reuse a non-PII key only for an identical request:
<https://docs.stripe.com/api/idempotent_requests>. The trusted-price,
server-to-server callback, signature, replay, idempotency, and
amount/currency/order checks follow the OWASP Third Party Payment Gateway
Integration Cheat Sheet:
<https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Payment_Gateway_Integration_Cheat_Sheet.html>.

## Deliberate provisional choices

- Reconciled local-mock rows use the existing `payment_method.OTHER` value and
  `method_label = 'Online payment'`. Adding an online enum or accounting bucket
  requires a separately reviewed provider/accounting migration.
- Refund, partial capture, partial refund, chargeback, dispute, provider fee,
  tax, settlement currency, payout timing, and rounding policies are not
  implemented. A capture cannot be represented as refunded by this foundation.
- No Production secret lifecycle, provider credential vault, endpoint
  allowlisting, mTLS policy, provider SLA, reconciliation scheduler, or
  operational alert threshold is approved.

## Promotion gate

Local validation may establish only a local contract gate. Production remains
blocked until a provider is selected, its official API/webhook contract and
certification are reviewed, refund/fee/accounting policies are approved,
secrets are provisioned, Staging receives real-provider sandbox evidence, and
duplicate/out-of-order/failure recovery is exercised end to end.
