# No-Persistent-Staging Release Strategy

## Current status

StallOrder is in a controlled transition:

```text
Local Development
+ Ephemeral Preview Validation
+ Persistent Staging release gate
+ Production
```

Persistent Staging is **not removed yet**. It remains the required source-tree
promotion gate until ephemeral validation has passed repeatedly and covers the
same functional, security, migration and deployment checks.

Production DR must never be used as Staging.

## Target state

After the exit criteria in this document pass:

```text
Local Development
+ Ephemeral Release Validation
+ Production Primary
+ Production DR
```

The target does not remove validation. It replaces a permanently running test
site with isolated, data-less resources that exist only for a Pull Request or a
manual validation run.

## Pull Request validation flow

The workflow in `.github/workflows/ephemeral-preview.yml` provides the database
portion of the release gate:

```text
Same-repository Pull Request
-> install with Node 24
-> create or reuse a data-less Supabase Preview Branch
-> mask generated credentials
-> apply all reviewed migrations through session mode
-> load deterministic synthetic fixtures only after verifying the branch is not the parent
-> compare migration history
-> run pgTAP
-> run database lint
-> deploy Edge Functions to the isolated branch
-> generate Prisma Client
-> run TypeScript validation
-> build against isolated configuration
-> retain the branch while the Pull Request is open
-> delete it when the Pull Request closes
```

Database lint fails on warnings in the application-owned `public`,
`app_private` and `internal` schemas. Supabase- and extension-owned schemas are
excluded because their lifecycle and bundled function definitions are not
controlled by this repository.

Manual workflow runs always remove their branch at the end.

## Trust boundary

The cloud validation job runs only when:

- the Pull Request branch belongs to `KenLeeYa/Stallorder-Platform`; or
- an authorized operator starts `workflow_dispatch`.

The Supabase Personal Access Token is scoped to the `Preview` GitHub
Environment and is injected only into Supabase management steps. It is not
available to `npm` install, TypeScript or build steps.

Generated branch connection values are masked before they are written to
`GITHUB_ENV`. They must never be printed, uploaded as artifacts or copied into
Pull Request text.

Fork Pull Requests receive the ordinary local CI checks only and do not receive
cloud credentials.

## Data policy

Preview Branch creation must always use:

```text
with_data=false
```

Forbidden Preview data:

- Production customer orders
- Production Auth users
- Production Storage objects
- Production customer notes or phone numbers
- Production payment references
- Production sessions
- Production provider secrets

Only deterministic synthetic fixtures may be added. The local demonstration
seed must not be applied to Production Primary or Production DR.

## Migration policy

All migrations must be new, ordered files. Applied migration files are
immutable.

Release migrations use:

```text
expand
-> migrate/backfill
-> deploy compatible application
-> verify
-> contract in a later release
```

The application rollback window must remain compatible with the expanded
database schema. An application rollback is not a substitute for an incompatible
database rollback.

The 2026-07-29 feasibility run found that the Supabase automatic Branching
workflow stopped after migration 50. The repository workflow therefore performs
an explicit `db push --include-all` against the isolated session-mode endpoint
and then verifies the resulting history.

## Vercel Preview requirement

Vercel's Git integration remains responsible for creating the Preview
Deployment for the Pull Request.

Persistent Staging cannot be removed until the Preview Deployment is connected
to the matching Supabase Preview Branch. A Vercel Preview must never point to:

- Production Primary
- Production DR
- persistent Staging

The final implementation must add a safe handoff from the Preview Branch output
to Vercel Preview environment values without placing credentials in logs. Until
that integration is verified, the new workflow is a database/build gate, not a
complete replacement for persistent Staging.

## Feature rollout

New resilience behavior follows:

```text
database expansion
-> application deployed with flag disabled
-> system canary
-> selected internal Organization/Stall
-> measured percentage rollout
-> broader rollout
```

Emergency kill switches expire automatically and require a reason, actor and
audit event.

## System canary

No Production canary identity is created by this workflow.

When a canary is separately approved, it must be:

- hidden from public discovery;
- marked `is_test=true`;
- excluded from merchant revenue and billable usage;
- excluded from payout and payment reconciliation;
- prevented from sending customer notifications;
- restricted to a dedicated Stall, QR and payment method.

The existing `orders.is_test` behavior is reusable, but a dedicated canary
bootstrap and teardown procedure is still required.

## Promotion sequence during transition

Until persistent Staging is retired:

1. Local CI passes.
2. Ephemeral Preview validation passes.
3. Vercel Preview is tested against the matching isolated Supabase branch when
   available.
4. The exact source tree is merged to `staging`.
5. Persistent Staging migration, remote lint and functional smoke pass.
6. The exact verified Staging tree is promoted to `main`.
7. Production migration dry-run and deployment checks pass.
8. Production receives only non-destructive smoke checks.

## Rollback

- Vercel application rollback uses a previously verified, schema-compatible
  deployment.
- A feature regression first disables its server-side flag.
- A migration regression follows the migration-specific forward-fix or restore
  runbook.
- Preview Branches may be deleted and recreated because they contain only
  synthetic data.
- Production Primary and Production DR are never reset by CI.

## Persistent Staging exit criteria

Persistent Staging may be removed only after all of the following are true:

1. At least three consecutive Pull Requests pass the ephemeral database
   workflow.
2. Vercel Preview uses the matching Preview Branch and never a Production URL.
3. Edge Functions deploy and smoke successfully on Preview.
4. Authentication uses a safe Preview configuration or approved OAuth mock.
5. QR, Staff, KDS, merchant and admin smoke tests pass on Preview.
6. Migration history and database lint pass.
7. Preview Branch deletion on Pull Request close is observed.
8. No Preview resource remains after a manual run.
9. GitHub `Preview` and `production` Environments have appropriate approval and
   branch protection.
10. Production rollback and incident procedures are exercised.
11. The user explicitly approves decommissioning persistent Staging.

## Current limitations

- GitHub Environment protection reviewers are not configured.
- Vercel Preview to Supabase Preview dynamic environment handoff is not yet
  verified.
- Preview OAuth and full browser E2E are not yet implemented.
- Production DR is not created.
- A measured Production failover RTO/RPO does not exist.

These limitations keep persistent Staging in place.
