# Auth and Taiwan Payment Integration Audit

Date: 2026-08-23

Baseline: `origin/staging` at `ee6a5b4474bbca9f55371bb9216afe8297fe9dbe`

Prompt SHA-256: `351832c487a09f0c2f5b722a32aff39509edab8c500bddd3c90cfbabf1f543a2`

## Executive result

The repository already had a secure provider-neutral OAuth core for Google, LINE, and Apple, explicit identity linking, session rotation/reuse detection, logout-all, and a provisional `LOCAL_MOCK` online-payment intent/event ledger. It did not yet have Microsoft, a user-facing account security screen, Passkey persistence/challenge controls, a provider connection model, a general provider transaction ledger, refunds, a reconciliation queue, or merchant/platform payment operations UI.

This change completes those repository-side foundations for local Mock acceptance. It does not activate any live provider, change Production configuration, or claim a sandbox/live transaction has passed.

## Authentication baseline preserved

- Canonical identity key is `(provider, provider_subject)`.
- Email remains profile/contact metadata and is never used for silent identity merging.
- Google, LINE, and Apple use the same OIDC adapter interface.
- State, nonce, PKCE, exact redirect URI, issuer, audience, and JWKS verification remain server-side.
- Identity link/unlink is explicit, recently authenticated, CSRF-protected, audited, and prevents unlinking the last usable identity.
- OAuth tokens are not stored in browser storage.
- Session cookies are HttpOnly; sessions rotate, have idle/absolute lifetime controls, are device-bound, and support reuse detection and logout-all.
- Legacy password fields and login remain in place because the OAuth-only migration gate is not proven.

## Authentication gaps closed

- Added optional Microsoft OIDC provider with an explicit verified issuer, exact callback, Mock support, UI label, and default-OFF feature flag.
- Added `passkey_credentials` and five-minute single-use `passkey_challenges` with RP ID, Origin, purpose, expiry, and replay controls.
- Added `帳號與安全性` UI for linked methods, safe unlink warnings, active sessions, current-device logout, and logout-all.
- Added server-scoped session revocation API.

Passkey registration/authentication remains blocked until a production-approved WebAuthn attestation/assertion verifier is selected and tested. The data model and challenge boundary are present; Production Passkeys remain OFF.

## Payment baseline preserved

- Existing `Order`, `Payment`, `PaymentOption`, Cash checkout, KDS, Print, and reporting remain canonical.
- Existing `PaymentOptionKind` values remain readable and unchanged.
- Existing LINE Pay/JKO payment options continue to behave as manual options unless an API provider connection is explicitly attached.
- The provisional `online_order_payment_intents` / `online_order_payment_events` `LOCAL_MOCK` foundation remains untouched as a compatibility layer.

## Payment gaps closed

- Added provider definitions for Cash/manual, LINE Pay, JKO Pay, TWQR, Taiwan Pay, PX Pay Plus, optional wallets, and a hosted/tokenized gateway family.
- Added a provider-neutral adapter contract and canonical server-side state machine.
- Added deterministic Mock create/query/cancel/refund/webhook/reconciliation behavior.
- Added constant-time Mock webhook signature checks, five-minute timestamp tolerance, body hashing, event uniqueness, and duplicate handling.
- Added tenant-scoped provider connections, transactions, webhook events, refunds, and reconciliation cases.
- Added TWD integer/check constraints, secret-reference-only persistence, RLS, service-role-only mutation, and backend writable guards.
- Added merchant Local Mock configuration/acceptance UI and platform read-only provider-health UI.
- Added safe provider capability discovery to public order tracking and staff POS configuration; only `ACTIVE` channel-enabled connections are exposed.

## Provider support conclusion

See [PAYMENT_PROVIDER_MATRIX.md](./PAYMENT_PROVIDER_MATRIX.md). Repository and Mock support do not mean live readiness. JKO Pay and PX Pay Plus live transports are explicitly `REQUIRES_PROVIDER_DOCUMENTATION`. TWQR/Taiwan Pay capabilities depend on the contracted acquirer and must not be generalized to every wallet.

## Migration risk

- Migration is expand-only: new tables, indexes, checks, triggers, and default-OFF flags.
- No enum value, column, table, legacy credential, or payment option is removed.
- New Prisma relations do not change existing checkout behavior.
- Main rollback is code/flag rollback. The additive tables should remain until a separately reviewed cleanup migration proves no data dependency.
- DR schema application and any remote migration require a new immutable Plan and separate approval. This local task performs neither.

## Remaining live blockers

- No real merchant credential or secret reference has been entered.
- No external provider console, callback, webhook, certificate, merchant/store mapping, sandbox, or settlement feed has been verified.
- No LINE Pay, JKO Pay, TWQR/Taiwan Pay, PX Pay Plus, or gateway sandbox/live E2E has passed.
- Passkey attestation/assertion verification is not implemented.
- Public ordering and staff POS expose only safe `ACTIVE` provider capability discovery; API-connected customer checkout controls and the complete pending/return UX are not implemented yet.
- Production provider flags remain OFF.

## Local validation evidence

- `npm test -- --run`: 340 passed / 2 skipped files; 2,212 passed / 9 skipped tests.
- `npm run db:test`: 61 files and 1,457 pgTAP tests passed after temporarily normalizing, then restoring, a pre-existing local PAYG delivery-entitlement override.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run ui:audit` passed; the UI audit covered 238 TSX files.
- Prisma validation, local database lint, the additive migration test, and the focused 19-test auth/payment pgTAP contract passed.
- The single pending expand-only migration was applied to the existing local Supabase database without resetting unrelated local data.
- Browser acceptance covered webhook-before-return success, return-before-webhook success, full refund, and reconciliation mismatch. Duplicate delivery produced one stored event with `attempt_count = 2`.
- Browser-created synthetic transactions, webhooks, refunds, reconciliation cases, and canonical payments were removed after evidence capture; the four selected Demo orders were restored to `UNPAID` while the Mock connection remains `READY`.
- Only local Mock OAuth/payment overrides are enabled. Passkeys and every non-Mock payment provider flag remain OFF.

## Evidence still required before Staging

- Fresh-database migration application in an isolated disposable database, followed by the complete pgTAP suite.
- Provider sandbox credentials, signed transport, callback/webhook registration, settlement evidence, and provider-specific acceptance tests.
- Complete public-order and staff-POS API payment UX, including pending, return, expiry, retry, and failure recovery states.
- Secret scan, final diff review, and a separately approved Staging PR.
- No automatic Production promotion.
