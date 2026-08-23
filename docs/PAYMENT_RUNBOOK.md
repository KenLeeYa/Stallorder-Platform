# Payment Operations Runbook

## Operating rule

Never mark an API-connected payment `PAID` from a browser return, screenshot, client flag, or staff click. Use a verified signed webhook, provider query/confirmation, or privileged audited reconciliation.

## Normal lifecycle

1. Confirm provider connection, environment, stall/channel, secret-reference presence, and flag state.
2. Create one provider transaction using a unique idempotency key derived/stored only as a hash.
3. Present the provider redirect/deep link/dynamic QR.
4. Treat browser return as UX evidence only; show pending while server confirmation is absent.
5. Verify webhook signature/timestamp or query the provider.
6. Apply a valid canonical state transition.
7. On trusted `PAID`, create/update the canonical `Payment` and `Order` in one transaction.
8. Confirm existing KDS/Print/reporting receives the canonical order state.

## Provider outage / timeout

- Stop creating new provider sessions with the provider-specific flag or connection status; do not disable Cash/manual payment.
- Keep existing pending transactions queryable.
- Do not retry non-idempotent provider operations without the same idempotency key.
- Record sanitized provider/error codes only. Never log secret/signature/raw customer payload.
- Move unresolved verified inconsistencies to `RECONCILIATION_REQUIRED`.

## Webhook handling

- Read a bounded raw body in memory.
- Validate timestamp tolerance and signature in constant time before parsing trusted fields.
- Hash the body and store only normalized fields.
- Enforce `(provider, external_event_id)` uniqueness.
- A duplicate increments attempt evidence but does not repeat Order/Payment mutation.
- For out-of-order events, query the provider and apply only a valid state-machine transition.
- Alert when `RECEIVED` remains unprocessed beyond five minutes.

## Browser return before webhook

- Set `browserReturnedAt` only.
- Show `PENDING` or `REQUIRES_CUSTOMER_ACTION`.
- Query provider if the contract allows; otherwise await webhook until timeout.
- Never mark paid from query parameters.

## Webhook before browser return

- Apply trusted provider evidence immediately.
- Browser return later reads the canonical transaction/Order state.
- Do not create a second payment session.

## Refund

1. Require an authorized role and recent authenticated session.
2. Load transaction and paid/refunded totals from tenant-scoped server data.
3. Validate TWD integer amount and remaining refundable balance.
4. Create an idempotent refund request with actor and reason.
5. Call provider and verify result/query.
6. Update `PARTIALLY_REFUNDED` or `REFUNDED`.
7. Only a full verified refund updates canonical `Payment`/`Order` to `REFUNDED`; partial refund remains represented in provider ledger.
8. If response is ambiguous, retain `PROCESSING`/create reconciliation case; do not repeat with a new key.

## Cancellation

- Cancel only states allowed by the provider/state machine.
- A customer closing the page is abandonment, not provider cancellation.
- If payment succeeds after order cancellation/expiry, create a reconciliation/refund case and do not silently reopen fulfillment.

## Security incident

- Disable the affected provider flag/connection, not all ordering unless necessary.
- Rotate the provider secret in the managed store; update only its reference metadata if needed.
- Reject callbacks signed by retired keys after the planned overlap.
- Preserve hashed webhook/audit/refund/reconciliation evidence.
- Review affected organizations, pending transactions, failed signatures, duplicate events, refunds, and settlement mismatches.

## Local Mock acceptance

The merchant lab supports deterministic success-before-return, return-before-webhook, pending, failure, expiry, full refund, and reconciliation mismatch. It hard-fails in Production and writes only to the selected local database/order. Reset disposable test data after acceptance.

## Rollback

- Turn new flags OFF and set provider connections `DISABLED`.
- Revert application code to the prior approved revision.
- Keep additive ledger tables for evidence/compatibility; do not drop them in an emergency rollback.
- Cash/manual checkout remains available because its models and paths were not replaced.
