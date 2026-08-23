# Payment Reconciliation Runbook

## Objective

Reconcile provider transaction/settlement evidence to StallOrder `PaymentProviderTransaction`, canonical `Payment`, and `Order` without trusting browser state or deleting source evidence.

## Frequency

- Near-real-time: process signed webhooks and provider queries.
- Operational review: inspect open/stalled cases at least daily while a provider is enabled.
- Settlement review: run for each provider settlement date/file/API window.
- Post-refund: verify provider and StallOrder refunded totals.

## Matching keys

Use, in order:

1. provider + provider transaction ID;
2. merchant order ID;
3. StallOrder transaction/order IDs stored in sanitized metadata;
4. exact TWD amount, currency, provider/store, and time window as secondary evidence.

Never auto-match on amount/time alone.

## Match conditions

A transaction is `MATCHED` only when:

- provider/store scope matches the connection;
- provider transaction and merchant order references match;
- currency is `TWD`;
- integer amount matches;
- canonical status matches trusted provider state;
- paid/refunded timestamps are plausible;
- accumulated refunds do not exceed paid amount;
- no duplicate provider payment exists for the same order.

## Case types

- `AMOUNT_MISMATCH`: provider and StallOrder amounts differ.
- `MISSING_ORDER`: provider evidence has no canonical order.
- `DUPLICATE_PAYMENT`: more than one provider payment appears for an order/reference.
- `STATUS_MISMATCH`: paid/cancelled/failed/expired states disagree.
- `REFUNDED_MISMATCH`: refund total or state disagrees.
- `SETTLEMENT_MISSING`: transaction is paid but absent from expected settlement.

## Review procedure

1. Open the platform payment-health console and filter provider/environment.
2. Confirm the provider connection and affected organization/stall.
3. Read normalized ledger fields; retrieve provider detail through the approved server query, never from customer screenshots alone.
4. Compare amount, currency, references, status, refund totals, and settlement date.
5. Choose an audited resolution:
   - provider truth verified; repair StallOrder canonical state;
   - StallOrder truth verified; request provider correction/refund;
   - duplicate; refund/void the duplicate according to provider rules;
   - unresolved; retain open and escalate.
6. Record a sanitized resolution code and note. Do not paste PII, secrets, signatures, or raw webhook bodies.
7. Re-query and verify the case can be closed.

## Privileged repair rules

- Requires an authorized finance/owner/platform role and recent authentication.
- Use a serializable server-side transaction.
- Lock the provider transaction, Order, and Payment.
- Validate a permitted transition with `PRIVILEGED_RECONCILIATION` evidence.
- Create an audit event with actor, request ID, before/after state, provider, amount, currency, and safe reason.
- Never rewrite/delete webhook or refund evidence.

## Refund reconciliation

- Sum only provider-confirmed successful refunds.
- Keep partial and full refunds separate.
- If provider says full refund but StallOrder is partial/paid, open `REFUNDED_MISMATCH` before changing the canonical order.
- If StallOrder says refunded but provider does not, do not retry blindly; query by the original refund idempotency key/reference.

## Settlement reconciliation

- Verify settlement date/timezone, provider fees, gross amount, refunds, and net settlement separately.
- Payment fee differences are not order amount differences; model/record them only after the settlement contract is defined.
- A gateway transaction must retain both gateway and funding method.
- TWQR wallet capability must come from the acquiring contract/settlement record.

## Alerts

- signed webhook remains `RECEIVED` beyond five minutes;
- signature verification failures spike;
- payment failure rate changes materially;
- open reconciliation cases age beyond the operational SLA;
- refund remains `PROCESSING` beyond provider SLA;
- paid transaction is absent from settlement;
- settlement contains an unknown provider transaction/order.

## Rollback and evidence

Turning a provider flag OFF stops new traffic but does not remove open cases. Keep all additive ledger and audit rows. Application rollback must retain read compatibility until all pending/refund/reconciliation items are resolved or exported under an approved retention process.
