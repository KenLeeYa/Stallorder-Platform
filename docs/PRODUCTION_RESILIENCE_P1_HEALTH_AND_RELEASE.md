# Production Resilience P1: Health and Safe Release

Date: 2026-07-29

This document describes the P1 foundation only. It does not claim that a DR
database, second write path, independent status site or automatic failover is
active.

## Runtime contract

The public runtime configuration endpoint is:

```text
GET /api/availability/config
```

It returns only:

```json
{
  "mode": "NORMAL_PRIMARY",
  "activeBackend": "PRIMARY",
  "promotionEpoch": 1,
  "qrOrdering": "AVAILABLE",
  "staffOnline": "AVAILABLE",
  "offlinePos": "MAINTENANCE",
  "linePay": "MAINTENANCE",
  "jkoPay": "MAINTENANCE",
  "updatedAt": "ISO_DATE"
}
```

The response contains no database URL, Supabase project ref, credential,
customer data or internal topology. Its CDN lifetime is two seconds. The
Service Worker already skips every `/api/*` request, so it cannot retain an old
backend target.

`BACKEND_ACTIVE_TARGET=DR` is ignored unless the audited
`DR_FAILOVER_ENABLED` flag is active. A mismatch returns `DEGRADED_SAFE` and
keeps `PRIMARY`; a deployment environment value cannot activate DR by itself.

If flags cannot be resolved, the endpoint fails closed:

- `PRIMARY` remains the target.
- online writes are `UNAVAILABLE`.
- offline POS is `UNAVAILABLE`.
- payment providers are `UNKNOWN`.

## Health endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `/api/health` | Public | Backward-compatible application and Primary DB readiness |
| `/api/health/primary` | Public | Minimal Primary DB status |
| `/api/health/dr` | Public | Minimal DR DB status; `UNKNOWN` when not configured |
| `/api/health/dependencies` | Platform Admin | Controlled dependency breakdown |

Supported statuses:

```text
HEALTHY
DEGRADED
UNAVAILABLE
MAINTENANCE
UNKNOWN
```

Database probes are `DEGRADED` after 800 ms and time out after 2.5 seconds.
Probe failures return fixed reason codes rather than exception messages.

P1 measures Application, Primary DB and an optionally configured DR DB. The
following dependencies remain `UNKNOWN` until a real, non-destructive probe is
implemented:

- replication
- Primary and DR Edge
- Realtime and SSE
- Storage mirror
- Turnstile
- LINE Pay and JKO Pay
- report delivery provider

Configuration presence is not reported as provider health.

## Feature flags

Resilience flags are separate from commercial plan entitlements. They are
evaluated on the server in this order:

```text
Device
-> Stall
-> Organization
-> Global
-> deterministic Percentage rollout
-> default
```

Expired overrides are retained for audit history but ignored during
evaluation. Scoped stalls are checked against their Organization in both the
service and a database trigger.

Platform Admin APIs:

```text
GET /api/admin/resilience/feature-flags
PUT /api/admin/resilience/feature-flags/:code
```

Writes require authenticated Platform Admin authorization, the existing rate
limit, CSRF validation, JSON size/content-type validation and Zod validation.
The transaction writes the override and audit record together.

Emergency flags:

- require an explicit reason;
- require automatic expiry;
- may remain active for at most 24 hours;
- create a high-severity audit event;
- cannot enable the future `LOCAL_EDGE_GATEWAY_ENABLED` capability.

## Release sequence

Every resilience change follows:

```text
expand-only migration
-> deploy compatible code with flag disabled
-> ephemeral validation
-> approved system canary
-> selected internal Organization or Stall
-> measured percentage rollout
-> broad rollout
```

Do not use a browser flag, Vercel environment variable or client payload as the
only authorization decision.

The current release gate remains:

1. Local lint, typecheck, unit tests, database tests and build.
2. Data-less Supabase Preview Branch validation.
3. Matching Vercel Preview validation when dynamic environment handoff is
   proven.
4. Persistent Staging validation while its exit criteria remain incomplete.
5. Promote the exact verified Staging tree to Production.
6. Run non-destructive Production smoke checks.

## Rollback order

1. Disable the affected server-side flag.
2. Confirm public availability and dependency health.
3. Stop percentage rollout.
4. Roll back to the last schema-compatible Vercel deployment if required.
5. Forward-fix database migrations unless an approved restore procedure is
   active.
6. Preserve audit, order, payment and incident evidence.

Never reset Production Primary or a future Production DR from CI.

## Independent status design

`status.qidaigo.com` must run outside the primary Vercel application and the
Primary Supabase project when practical. It should publish only:

- QR ordering status
- Staff POS status
- payment-provider status
- known incident summary
- customer workaround

It must not expose project refs, database roles, replication slots, security
events or internal recovery commands.

The in-app Platform Admin dependency endpoint is not an independent incident
channel because its authentication path can depend on the Primary system.

No independent status service is deployed by P1. Provider selection, DNS,
access control and incident publishing require a separate dry run and approval.

## System canary

No Production canary identity or order is created by P1. The approved future
canary must use `orders.is_test=true`, a dedicated hidden Stall and non-provider
payment method. It must remain excluded from revenue, billing, notifications
and reconciliation.

The full canary and persistent Staging exit controls are in
`docs/NO_PERSISTENT_STAGING_RELEASE_STRATEGY.md`.

## Environment variables

```text
BACKEND_ACTIVE_TARGET=PRIMARY
PROMOTION_EPOCH=1
DR_DATABASE_URL=<server-only runtime pooler placeholder>
```

`DR_DATABASE_URL` remains empty until an approved DR project exists. It must
never use a `NEXT_PUBLIC_` prefix and must never be logged.

## Verification

P1 verification includes:

- deterministic flag precedence and percentage behavior;
- expired override behavior;
- RLS and grant tests;
- cross-Organization Stall scope rejection;
- health success, failure and timeout behavior;
- fixed public error shapes;
- Platform Admin dependency authorization;
- DR target fail-closed behavior;
- public response secret-field regression tests.
