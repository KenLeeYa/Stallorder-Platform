# Production Resilience P0 Feasibility Result

## Status

- Validation date: 2026-07-29
- Approved path: Option 1
- Result: **PASS WITH LIMITATIONS**
- Production writes performed: no
- Persistent Staging writes performed: no
- Production customer data copied: no
- Temporary resources remaining: no

This document records the isolated capability proof requested by
`PRODUCTION_RESILIENCE_MASTER_AUDIT.md`. It is not evidence that a Production DR
standby, promotion or failback process is complete.

## Approved architecture interpretation

The current Vercel Pro plan is retained.

StallOrder will implement separately observable application-level order-intake
circuits and will not claim that Vercel Node.js automatic cross-region
`functionFailoverRegions` is available. One PostgreSQL backend remains the only
authoritative writer during normal operation.

Supabase logical replication may be used for a future asynchronous DR standby
because the isolated end-to-end capability proof passed. Production replication
must still remain disabled until fencing, schema synchronization, sequence
handling, monitoring, promotion and failback are implemented and drilled.

## Isolated environment

Two temporary, non-persistent Supabase Preview Branches were created in Tokyo:

```text
resilience-replication-source-20260729
resilience-replication-proof-20260729
```

Both branches were created with:

```text
with_data=false
region=ap-northeast-1
size=micro
```

The branches contained:

| Check | Source | Target |
| --- | ---: | ---: |
| Applied migrations | 53 | 53 |
| Public tables | 86 | 86 |
| Public tables with RLS | 86 | 86 |
| Organizations | 0 | 0 |
| Profiles | 0 | 0 |
| Orders | 0 | 0 |
| Auth users | 0 | 0 |
| Storage objects | 0 | 0 |

No Production seed, Auth identity, customer order or Storage object was copied.

## Branch migration finding

Supabase Branching initially applied 50 of 53 migrations and reported
`MIGRATIONS_FAILED`. The missing versions were:

```text
20260724134929
20260724175025
20260729094000
```

An isolated `supabase db push --dry-run` showed only those three migrations.
Applying them through the authenticated Supavisor session-mode endpoint
completed successfully.

This is a release-validation defect that P1 must correct. Preview Branch
provisioning cannot be considered ready while the automatic Branching workflow
stops at migration 50.

The local Windows host could not reach the direct IPv6 database endpoint.
Supavisor transaction mode on port 6543 also rejected migration prepared
statements. The validated IPv4 administrative path was the authenticated shared
pooler in session mode on port 5432.

No connection string or password was persisted or logged.

## Logical replication proof

### Capability checks

The Source and Target both reported:

```text
PostgreSQL 17.6
wal_level=logical
```

The temporary Source allowed the current administrative role to create a
dedicated replication role. The temporary Target included
`pg_create_subscription` membership.

### Test topology

Only one randomly named, non-public proof schema and table were used:

```text
Synthetic Source
  -> dedicated short-lived replication role
  -> one-table publication
  -> one logical replication slot
  -> one Target subscription
  -> identical synthetic Target table
```

The temporary replication password was generated with a cryptographic random
number generator and existed only in process memory.

### Result

1. The subscription was created successfully over TLS.
2. The Source replication slot was active.
3. The Target subscription was enabled.
4. One synthetic row was inserted on Source.
5. Exactly one row appeared on Target.
6. The observed CLI end-to-end interval was 7,774 ms.

The 7,774 ms interval includes CLI startup, connection setup, a two-second poll
interval and query execution. It is an upper-bound observation for this proof,
not a direct PostgreSQL apply-lag measurement or Production SLO.

### Cleanup proof

After validation:

| Temporary object | Remaining count |
| --- | ---: |
| Source proof schemas | 0 |
| Source proof publications | 0 |
| Source proof replication roles | 0 |
| Source proof replication slots | 0 |
| Target proof schemas | 0 |
| Target proof subscriptions | 0 |

Both Preview Branches were deleted. The parent project branch list returned only
the default `main` branch after cleanup.

## What this proves

- Supabase PostgreSQL 17 Preview Branches can participate in one-way logical
  replication.
- A dedicated least-purpose replication role can connect to the publisher.
- Publication, slot and subscription creation are supported.
- A synthetic insert reaches the subscriber without duplicate rows in the
  tested path.
- The temporary replication topology can be fully removed.
- Data-less Preview Branches are suitable for isolated capability tests.

## What this does not prove

- Production table publication coverage
- Initial copy duration for existing Production data
- Update and delete behavior for every table
- RLS, trigger and `SECURITY DEFINER` behavior after a complete schema deploy
- DDL replication, because PostgreSQL logical replication does not copy DDL
- Sequence synchronization
- Large object or Supabase Storage object replication
- Supabase Auth provider, signing-key or OAuth continuity
- Vault secret continuity
- `pg_cron` ownership and duplicate-job fencing
- Replication slot retention during a long outage
- Replication lag alerting
- Read-routing correctness
- Controlled promotion or failback
- Cross-region disaster recovery
- A measured Production RTO or RPO

## P0 gate decision

P0 is complete enough to proceed to P1 under these restrictions:

1. Persistent Staging remains in use until ephemeral validation is reliable.
2. Production replication remains disabled.
3. No Production DR project is created or converted automatically.
4. The existing Staging project is not repurposed as DR.
5. No Vercel Enterprise-only configuration is committed.
6. Every future Preview Branch must be data-less and synthetic-only.
7. Actual DR activation requires a separate approval after P1 and P2 safeguards
   pass.

## P1 entry work

P1 must address:

1. Align GitHub Actions with the repository's Node 24 runtime.
2. Create a repeatable ephemeral Preview Branch workflow.
3. Make migration application deterministic for all 53 versions.
4. Add dependency-specific liveness/readiness without exposing secrets.
5. Add an active-backend state contract, feature flags and kill switches.
6. Define an independent status and canary design.
7. Preserve the verified persistent-Staging promotion gate until its replacement
   passes repeatedly.

## Official references

- Supabase Branching:
  <https://supabase.com/docs/guides/deployment/branching>
- Supabase Branching troubleshooting:
  <https://supabase.com/docs/guides/deployment/branching/troubleshooting>
- Supabase database connections:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase logical replication:
  <https://supabase.com/docs/guides/database/replication>
- Vercel function regions:
  <https://vercel.com/docs/functions/configuring-functions/region>
