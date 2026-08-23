# Payment Provider Matrix

`Repository support` and `Mock support` are implementation facts, not live-readiness claims. No provider below is `LIVE READY`.

| Provider | Auth/Payment | Direct/TWQR/Gateway | Repository support | Mock support | Sandbox support | Live credential state | Refund | Query | Webhook | Reconciliation | Per-stall enablement | Manual action required |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Cash / manual | Payment | Manual | Existing canonical flow | Yes | N/A | N/A | Manual | Manual | N/A | Manual | Existing `PaymentOption` | None for Cash |
| LINE Pay Taiwan | Payment | Direct | Adapter contract + ledger + Mock | Yes | After onboarding | Missing | Contract + Mock | Contract + Mock | Contract + Mock ledger | Yes | Yes | Credentials, current official transport review, Sandbox E2E |
| JKO Pay | Payment | Direct | Contract boundary | Yes | Requires private docs | Missing | Contract + Mock | Contract + Mock | Contract + Mock ledger | Yes | Yes | `REQUIRES_PROVIDER_DOCUMENTATION` and merchant approval |
| TWQR | Payment rail | TWQR/acquirer | Capability + dynamic/static QR contract | Yes | After acquirer onboarding | Missing | Acquirer-specific | Contract + Mock | Contract + Mock ledger | Yes | Yes | Acquirer contract and exact wallet capability list |
| Taiwan Pay | Payment capability | TWQR/acquirer | Separate capability boundary | Yes | Requires acquirer docs | Missing | Acquirer-specific | Contract + Mock | Contract + Mock ledger | Yes | Yes | Confirm Taiwan Pay capability; never infer every wallet |
| PX Pay Plus | Payment | Direct | Contract boundary | Yes | Requires private docs | Missing | Contract + Mock | Contract + Mock | Contract + Mock ledger | Yes | Yes | `REQUIRES_PROVIDER_DOCUMENTATION` and merchant approval |
| iPASS MONEY | Payment capability | TWQR or gateway | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual acquirer/gateway support |
| icash Pay | Payment capability | TWQR or gateway | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual acquirer/gateway support |
| 全盈+PAY | Payment capability | TWQR or gateway | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual acquirer/gateway support |
| 悠遊付 | Payment capability | TWQR or gateway | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual acquirer/gateway support |
| GAMA Pay | Payment capability | Gateway/direct | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual provider/gateway support |
| O'Pay | Payment capability | Gateway/direct | Extensible capability | Yes | Unverified | Missing | Contract-specific | Contract-specific | Contract-specific | Supported by generic queue | Yes | Confirm actual provider/gateway support |
| Cards / Apple Pay / Google Pay | Payment | Hosted gateway | Gateway family + funding-method field | Yes | Provider-specific | Missing | Contract + Mock | Contract + Mock | Contract + Mock ledger | Yes | Yes | Select gateway and use hosted/tokenized components |

## Authentication provider status

| Provider | Repository support | Mock | Live credential state | Default flag | Remaining gate |
|---|---|---|---|---|---|
| Google | Unified OIDC | Yes | Not evaluated in this local task | OFF | Live callback/login canary |
| LINE Login | Unified OIDC + explicit linking | Yes | Not evaluated in this local task | OFF | Live login/link/revocation canary |
| Apple | Unified OIDC + account events | Yes | Not evaluated in this local task | OFF | Apple Team access and live canary |
| Microsoft | Optional unified OIDC | Yes | Missing | OFF | Tenant, exact issuer, credentials, enterprise canary |
| Passkeys | Credential/challenge architecture | Challenge tests | N/A | OFF | Approved WebAuthn verifier and RP/Origin E2E |
