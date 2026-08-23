# Authentication and Payment Architecture

## Trust model

The browser may initiate a login, return from a provider, select a payment method, or display provider state. It cannot establish an identity or mark an order paid. Identity and payment transitions require server-verified provider evidence.

```text
Browser/PWA
  -> StallOrder API (CSRF, rate limit, RBAC, tenant scope)
    -> OAuth / PaymentProviderAdapter
      -> Mock, Sandbox, or Live transport
    -> server verification
      -> identity/session ledger or payment transaction ledger
        -> canonical Profile / Order / Payment / KDS / Print / reporting
```

## Authentication

### Federated identities

`OAuthProviderAdapter` is shared by Google, LINE, Apple, and Microsoft. The immutable provider subject is the identity key. Provider Email is optional metadata; two identities with the same Email are not silently merged.

Login and link flows use:

- exact allowlisted redirect URI;
- state and nonce;
- PKCE;
- issuer/audience/JWKS verification;
- encrypted, short-lived, single-use OAuth transactions;
- explicit authenticated link mode;
- audit events without raw provider subjects.

Microsoft is optional and hidden unless its flag and exact configuration are both ready. `MICROSOFT_ISSUER` is required so multi-tenant issuer validation cannot silently widen.

### Passkeys

Passkeys attach to an existing `Profile`; they never create a second profile.

- `PasskeyCredential` stores credential ID hash, public key, sign counter, transports, safe device label, and usage/revocation timestamps.
- `PasskeyChallenge` stores only a challenge hash and binds it to profile, purpose, RP ID, Origin, and a maximum five-minute expiry.
- Challenge consumption is atomic and replay-safe.
- `http://localhost` is accepted only in explicit Mock mode; Production requires exact HTTPS Origin.

The repository deliberately stops before registration/assertion endpoints because no production-approved WebAuthn verification library has been accepted. `AUTH_PASSKEYS_ENABLED` remains OFF.

### Sessions

Active sessions are HttpOnly, device-bound, rotated, and constrained by idle and absolute lifetime. The account-security page reveals only safe timestamps and a shortened device reference. It never reveals IP, tokens, cookies, or complete browser fingerprints.

## Payments

### Connection and capability separation

`PaymentProviderConnection` records:

- provider and connection mode (`DIRECT`, `TWQR`, `GATEWAY`, `MANUAL`);
- environment (`MOCK`, `SANDBOX`, `LIVE`);
- status;
- an approved secret reference, never a raw secret;
- masked merchant/store/acquirer references;
- capability JSON and enabled ordering channels;
- health timestamps and sanitized error code.

TWQR is a rail/capability. Taiwan Pay is a customer-facing ecosystem capability. Other wallets are configuration supplied by the actual merchant/acquirer contract. A gateway records the real funding method separately and must use hosted/tokenized components for cards, Apple Pay, or Google Pay.

### Canonical transaction state

```text
CREATED -> PENDING / REQUIRES_CUSTOMER_ACTION
  -> AUTHORIZED -> PAID
  -> FAILED / CANCELLED / EXPIRED
PAID -> PARTIALLY_REFUNDED -> REFUNDED
any verified mismatch -> RECONCILIATION_REQUIRED
```

The transition validator rejects invalid edges. `BROWSER_RETURN` evidence cannot transition to `AUTHORIZED` or `PAID`. Trusted evidence is a signed webhook, verified provider query/confirmation, or privileged audited reconciliation.

### Persistence

- `payment_provider_transactions`: server-authoritative TWD integer ledger and idempotency hash.
- `payment_provider_webhook_events`: unique provider event, body hash, signature result, attempts, and sanitized status; no raw body/signature persistence.
- `payment_provider_refunds`: idempotent partial/full refunds with actor and state.
- `payment_reconciliation_cases`: mismatch review queue for amount, status, missing order, duplicates, refund, or settlement.

Tenant scope is checked in composite foreign keys and the provider-connection scope trigger. All sensitive tables force RLS and grant browser roles no direct access.

### Existing order lifecycle

The provider transaction does not replace `Order` or `Payment`. After trusted confirmation, the service creates the existing canonical `Payment`, updates `Order.paymentStatus`, and lets existing KDS/Print/reporting logic continue. Cash/manual checkout is unchanged.

### Public and staff discovery

Public tracking and staff POS configuration expose only safe provider/capability records where the connection is `ACTIVE` and explicitly enables `PUBLIC_MENU` or `STAFF_POS`. A `READY` Local Mock connection is visible only in the merchant acceptance lab and cannot become a customer-facing payment method by itself.

## Mock strategy

The deterministic Mock adapter supports success, pending, failure, expiry, cancellation, signed webhook, duplicate webhook, invalid signature, idempotent create/refund, partial/full refund, and reconciliation mismatch. Mock mode hard-fails in Production.

## Feature flags

The existing resilience flag service owns all gates. Every new flag defaults OFF. Connection status, environment, credentials, and feature flags are separate gates; satisfying one never implies another.
