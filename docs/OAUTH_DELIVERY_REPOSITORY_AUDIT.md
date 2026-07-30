# StallOrder OAuth and Delivery Repository Audit

## Document status

- Audit date: 2026-07-30
- Repository: `KenLeeYa/Stallorder-Platform`
- Working branch: `feature/delivery-platform-integration-foundation`
- Stacked base: `feature/production-resilience-master` at `28bede2`
- Target integration branch after the stacked base merges: `main`
- Production activation: prohibited by this work

This document records the P0 repository and migration audit. It does not enable
an OAuth provider, external delivery provider, Production feature flag or
destructive credential migration.

## Verified baseline

| Area | Current state |
| --- | --- |
| Runtime | Node 24, Next.js 16.2.11, React 19.2.4, TypeScript |
| Database | Supabase PostgreSQL 17, Prisma 6.19 |
| Application API | 110 Next.js route handlers; no Server Actions |
| Data model | 102 Prisma models, 62 ordered migrations |
| Database tests | 34 pgTAP files |
| Edge Functions | Five public-order and LINE-related functions |
| Unit baseline | 113 files and 453 tests passing |
| Release validation | CI plus data-less Supabase Ephemeral Preview from the stacked base |
| Function region | Vercel `hnd1`; Supabase Tokyo |

The original checkout contains unrelated untracked infrastructure artifacts.
Development therefore uses a separate clean clone and does not modify the
original worktree.

## Existing authentication architecture

### Application session

`src/lib/auth.ts` issues a StallOrder-owned opaque session and CSRF token:

- the session cookie is `HttpOnly`;
- the CSRF cookie is readable by the browser and verified by mutating APIs;
- only token hashes are stored in `auth_sessions`;
- profile activity and session expiry are checked on every principal lookup;
- RBAC, Organization and Stall access are loaded from server-side records.

This is the correct authorization boundary to preserve after OAuth. Provider
tokens must never replace the StallOrder session or carry trusted tenant roles.

### Current Google path

The current flow is:

```text
/auth/google
-> Supabase Auth signInWithOAuth
-> /auth/callback
-> exchangeCodeForSession
-> locate Profile
-> create StallOrder session
```

The callback currently searches by verified Email and can attach a new Auth
identity to an existing Profile. `profile_auth_identities` also indexes
`verified_email`, and the DR continuity procedure permits Email lookup.

This conflicts with the new security contract:

- OAuth identity must be keyed by `(provider, provider_subject)`;
- Email is nullable profile/contact data only;
- matching Email must never silently link two identities;
- a privileged role may only come from existing trusted membership records or a
  one-time identity-link invitation.

Supabase Auth also supports automatic same-Email identity linking. Consequently,
the final provider-subject contract cannot rely on the current callback as its
only identity ledger.

### Local password path

`POST /api/auth/login`, `src/components/login-form.tsx`,
`src/lib/password-auth.ts`, `profiles.password_hash`, seed fixtures and tests
still implement local Email/password login.

The requested end state is OAuth-only. Removing this path now would be
irreversible and could lock out privileged users. The contract phase is blocked
until all of the following are measured:

1. every `PLATFORM_ADMIN` has a verified provider-subject identity;
2. every Organization primary owner has a verified identity;
3. Staff and Kitchen migration reports have no unresolved required accounts;
4. identity-link invitations, logout-all and emergency recovery are exercised;
5. approved Google, LINE and Apple callback configurations are verified;
6. an approved Production canary succeeds.

Until then, the implementation must be expand-only and OAuth-only UI must remain
disabled by a server-side flag.

## Existing reusable authorization and resilience controls

- `src/lib/authorization.ts` resolves Profile, Organization and Stall scope on
  the server and returns 404/403 without trusting request tenant identifiers.
- `src/lib/rbac.ts` is the canonical role/permission map.
- `src/server/billing/entitlement-service.ts` enforces commercial features on
  the server.
- `src/server/resilience/feature-flag-service.ts` evaluates Device, Stall,
  Organization, Global and deterministic percentage overrides.
- `src/lib/audit.ts` writes structured audit events and removes line breaks and
  oversized metadata.
- `src/lib/rate-limit.ts` provides PostgreSQL-backed rate limiting.
- public order creation remains protected by trusted Edge Functions,
  Turnstile, short-lived one-use sessions, idempotency and server-side pricing.
- `orders.is_test` already excludes test orders from billing and reporting and
  can support a future approved system canary.

OAuth and delivery integration must reuse these controls rather than create a
parallel authorization stack.

## Existing delivery-related scope

StallOrder currently supports a first-party `DELIVERY` fulfillment mode and
customer address/phone collection. This is not an Uber Eats or foodpanda
integration.

Missing provider integration primitives include:

- provider-neutral adapter registry;
- merchant connection lifecycle and store mapping;
- menu, modifier and item mappings;
- signed webhook ledger and replay protection;
- external order ledger and provider-action idempotency;
- PostgreSQL-backed synchronization jobs;
- external payment allocation that stays out of expected cash;
- merchant and platform-admin integration management;
- deterministic Mock provider.

External orders must enter the existing `orders`, order-item snapshot, KDS,
print and audit flows. They must not create a second canonical order model.

## Architecture decisions

### Identity domain

1. Keep `profile_auth_identities` as the project-local Supabase Auth/DR mapping
   and add a separate `auth_identities` ledger whose only identity key is the
   verified `(provider, provider_subject)` pair.
2. Add one-time `oauth_transactions` with hashed state/nonce/code evidence and
   encrypted PKCE verifier storage.
3. Add hashed identity-link invitations.
4. Expand `auth_sessions` for rotation, revocation, device evidence and reuse
   detection.
5. Use one stable callback per provider and environment.
6. Provide a deterministic Mock OIDC adapter for Local and Ephemeral Preview.
7. Keep all live providers fail-closed until exact console configuration and
   credentials are verified.

### Delivery domain

1. Keep user-login OAuth and delivery-provider credentials in separate tables,
   state namespaces, audit events and feature flags.
2. Store only secret references in public application tables.
3. Persist webhook evidence before processing and deduplicate independently of
   Circuit A or Circuit B.
4. Permit normal writes only when the active backend reports
   `ACTIVE_WRITER`.
5. Treat business rejection as final and never as a circuit-fallback reason.
6. Use Mock providers for Local and Ephemeral Preview; live provider adapters
   remain disabled pending partner approval.

## Phase boundary

The automatable scope is P0 through P7:

- expand-only schema and Prisma models;
- server-side feature flags defaulting to disabled;
- provider adapters and deterministic mocks;
- secure routes and Taiwan Traditional Chinese management UI;
- RLS, authorization, unit, database and synthetic E2E tests;
- data-less Ephemeral Preview validation;
- runbooks and user-action checklist.

The following are deliberately parked:

- live Google, LINE and Apple console changes and callback verification;
- Apple private-key provisioning;
- Uber Eats and foodpanda partner approval and credentials;
- Production canary creation;
- local password credential deletion;
- Production flag activation and percentage rollout.

No parked item may be inferred as complete from a successful Mock test.
