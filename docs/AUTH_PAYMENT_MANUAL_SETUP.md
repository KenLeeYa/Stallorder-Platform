# One-Time Authentication and Payment Setup

This is the consolidated operator checklist. Do not paste secrets into Git, database fields, tickets, screenshots, or browser storage. Use Vercel/Supabase Vault/an approved secret manager and store only references such as `env://NAME` in StallOrder.

## Gate 0 — before entering credentials

- [ ] Confirm the target is Local, ephemeral Preview, Sandbox, or Production.
- [ ] Confirm Preview will never receive Production OAuth/payment secrets.
- [ ] Confirm exact application Origin and callback domain.
- [ ] Confirm a named operator and checker.
- [ ] Confirm rollback owner, provider support contact, and incident channel.
- [ ] Keep all Production feature flags OFF.

## Google Login

- [ ] Create/select the Google OAuth Web client in the approved Google Cloud project.
- [ ] Configure exact redirect: `https://app.qidaigo.com/api/auth/google/callback`.
- [ ] Configure approved JavaScript Origin if the console requires it.
- [ ] Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to managed secrets.
- [ ] Verify issuer, audience, nonce, state, PKCE, cancellation, and revoked consent in Sandbox/Preview.
- [ ] Enable `OAUTH_IDENTITY_FOUNDATION_ENABLED` and `OAUTH_GOOGLE_ENABLED` only through the approved canary.

## LINE Login

- [ ] Select the approved LINE Login channel; do not use a manually entered LINE username as authentication.
- [ ] Configure exact callback: `https://app.qidaigo.com/api/auth/line/callback`.
- [ ] Add `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, and `LINE_REDIRECT_URI` to managed secrets.
- [ ] Keep `LINE_EMAIL_SCOPE_ENABLED=false` unless LINE Email permission is approved.
- [ ] Test a user without Email scope, revoked authorization, explicit link, unlink, last-identity protection, and logout-all.
- [ ] Enable `OAUTH_LINE_ENABLED` only after canary approval.

## Sign in with Apple

- [ ] Confirm Apple Developer Program Team access.
- [ ] Configure Service ID / App ID and exact callback: `https://app.qidaigo.com/api/auth/apple/callback`.
- [ ] Configure event URL: `https://app.qidaigo.com/api/auth/apple/events`.
- [ ] Add Team ID, Service/Client ID, Key ID, private key, and redirect URI to managed secrets.
- [ ] Verify `form_post`, private relay Email, first-login name, revoked account event, and provider-side unlink/revocation.
- [ ] Enable `OAUTH_APPLE_ENABLED` only after canary approval.

## Microsoft Entra ID / Microsoft Account

- [ ] Select tenant policy: tenant UUID, `organizations`, `consumers`, or `common`.
- [ ] Register exact callback: `https://app.qidaigo.com/api/auth/microsoft/callback`.
- [ ] Record the exact verified token issuer in `MICROSOFT_ISSUER`; do not widen issuer matching.
- [ ] Add `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_ISSUER`, and `MICROSOFT_REDIRECT_URI` to managed secrets.
- [ ] Test organization and/or consumer accounts matching the selected policy.
- [ ] Keep `OAUTH_MICROSOFT_ENABLED` OFF unless an enterprise customer needs it.

## Passkeys / WebAuthn

- [ ] Select and security-review a WebAuthn attestation/assertion verification library.
- [ ] Set `PASSKEY_RP_ID=app.qidaigo.com` and `PASSKEY_ALLOWED_ORIGIN=https://app.qidaigo.com`.
- [ ] Verify registration, authentication, reauthentication, sign-counter replay, credential revocation, recovery, iPad/PWA behavior, and Origin mismatch.
- [ ] Verify challenge TTL and one-time use in Production-like E2E.
- [ ] Keep `AUTH_PASSKEYS_ENABLED` OFF until all checks pass.

## LINE Pay Taiwan

- [ ] Complete merchant/Sandbox onboarding and confirm channel/merchant identifier and channel secret.
- [ ] Confirm request, confirmation, query, cancellation/refund, timeout, and reconciliation endpoints against current official contracted documentation.
- [ ] Configure approved return/cancel URLs and any provider callback requirements.
- [ ] Add `PAYMENT_LINE_PAY_MERCHANT_ID`, `PAYMENT_LINE_PAY_CHANNEL_SECRET`, and `PAYMENT_LINE_PAY_ENVIRONMENT` to managed secrets.
- [ ] Create a `DIRECT` provider connection with an `env://`/vault reference; never raw secret.
- [ ] Pass Sandbox E2E for success, cancel, timeout, duplicate, full/partial refund, and settlement reconciliation.
- [ ] Keep `PAYMENTS_LINE_PAY_ENABLED` OFF until canary approval.

## JKO Pay / 街口支付

- [ ] Obtain private/contracted technical documentation and merchant approval.
- [ ] Confirm whether the contracted flow uses redirect, QR, webhook/callback, query, and refund.
- [ ] Confirm exact signing, certificate/key rotation, endpoints, timeout, and settlement format. Do not infer them.
- [ ] Add `PAYMENT_JKO_MERCHANT_ID` and `PAYMENT_JKO_SECRET_REFERENCE` to managed configuration.
- [ ] Replace `REQUIRES_PROVIDER_DOCUMENTATION` only after reviewed transport implementation and Sandbox E2E.
- [ ] Keep `PAYMENTS_JKO_PAY_ENABLED` OFF.

## TWQR / Taiwan Pay

- [ ] Select the actual acquiring bank/gateway and execute the merchant contract.
- [ ] Record acquirer, merchant/store reference, dynamic/static QR support, expiry, callback/query mechanism, and settlement file/API.
- [ ] Obtain the exact wallet capability list. Do not claim all wallets are supported.
- [ ] Add `PAYMENT_TWQR_ACQUIRER`, `PAYMENT_TWQR_MERCHANT_ID`, and `PAYMENT_TWQR_SECRET_REFERENCE` to managed configuration.
- [ ] Verify exact amount/order binding, QR expiry, replay, delayed confirmation, and reconciliation.
- [ ] Enable `PAYMENTS_TWQR_ENABLED` and `PAYMENTS_TAIWAN_PAY_ENABLED` separately only for proven capabilities.

## PX Pay Plus / 全支付

- [ ] Obtain merchant approval and private technical documentation.
- [ ] Confirm create/QR/redirect, callback signature, query, cancellation/refund, timeout, and settlement contracts.
- [ ] Add `PAYMENT_PX_PAY_PLUS_MERCHANT_ID` and `PAYMENT_PX_PAY_PLUS_SECRET_REFERENCE` to managed configuration.
- [ ] Keep `PAYMENTS_PX_PAY_PLUS_ENABLED` OFF until reviewed transport and Sandbox E2E pass.

## Payment gateway / cards / Apple Pay / Google Pay

- [ ] Select the contracted gateway (for example, ECPay, NewebPay, TapPay, or another reviewed provider).
- [ ] Confirm the gateway actually supports each advertised funding method.
- [ ] Use hosted/tokenized UI; StallOrder must never receive/store PAN or CVV.
- [ ] Add gateway provider, merchant ID, and approved secret reference to managed configuration.
- [ ] Record both gateway and real funding method in the transaction.
- [ ] Verify 3DS/tokenization, callback signature, query, refund, dispute, and settlement workflows.
- [ ] Keep `PAYMENTS_GATEWAY_ENABLED` OFF until canary approval.

## Local Mock acceptance

1. Use an isolated local database and set only local values in ignored `.env.local`:

   ```dotenv
   APP_BASE_URL=http://localhost:3000
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   PAYMENT_PROVIDER_MODE=mock
   PAYMENT_MOCK_WEBHOOK_SECRET=<unique local value of at least 32 bytes>
   OAUTH_PROVIDER_MODE=mock
   OAUTH_STATE_SECRET=<unique local value of at least 32 bytes>
   PASSKEY_PROVIDER_MODE=mock
   ```

2. Run the local database reset/migrations and pgTAP tests.
3. Start the app, sign in to local seed data, and open `/merchant/payments`.
4. Create a stall-scoped Mock connection.
5. Run success-before-return, return-before-webhook, pending, failed, expired, full refund, and reconciliation mismatch on disposable unpaid test orders.
6. Verify duplicate webhook attempt count, Order/Payment state, refund, reconciliation case, and audit log.
7. Remove disposable local data or reset the local database after acceptance.

## Production canary order

- [ ] Provider Sandbox and reconciliation evidence attached.
- [ ] Security review and secret scan pass.
- [ ] Staging migration and Preview pass.
- [ ] Provider callback allowlist and monitoring verified.
- [ ] Refund/reconciliation operator trained.
- [ ] Enable one provider, one organization/stall, one channel, and a bounded canary.
- [ ] Verify real transaction, query, webhook, refund, settlement, and rollback.
- [ ] Expand only after explicit approval. Never auto-promote from this checklist.
