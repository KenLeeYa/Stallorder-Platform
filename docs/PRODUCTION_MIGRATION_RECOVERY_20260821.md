# Production Migration Forward-only Recovery — 2026-08-21

## Incident

The verified Phase 0–3 release added nine migration files whose versions start
with `20260813`, but those files entered the release tree only on 2026-08-20.
Production Primary and DR had already applied migrations through
`20260820071255`. The migrations below are absent from both remote histories,
so the normal additive-only dry-run correctly rejected them as out of order.

Evidence:

- Production Readiness run `32435237243` stopped at the dry-run before Apply.
- Read-only DR schema Plan run `32435869638` stopped at the same dry-run.
- Neither run changed remote schema or application state.

## Recovery

Retimestamp the nine unapplied files after the shared remote head while keeping
their relative order and SQL behavior unchanged:

| Previous version | Forward-only version |
| --- | --- |
| `20260813001731_p1_outbox_dispatch.sql` | `20260821012138_p1_outbox_dispatch.sql` |
| `20260813010000_target_stall_schedule_catch_up.sql` | `20260821012139_target_stall_schedule_catch_up.sql` |
| `20260813011804_reservation_preorder_foundation.sql` | `20260821012140_reservation_preorder_foundation.sql` |
| `20260813020000_canonical_public_order_preflight.sql` | `20260821012141_canonical_public_order_preflight.sql` |
| `20260813030000_digital_waitlist_foundation.sql` | `20260821012142_digital_waitlist_foundation.sql` |
| `20260813040000_online_order_payment_reconciliation.sql` | `20260821012143_online_order_payment_reconciliation.sql` |
| `20260813050000_dynamic_ordering_qr_foundation.sql` | `20260821012144_dynamic_ordering_qr_foundation.sql` |
| `20260813060000_crm_loyalty_consent_foundation.sql` | `20260821012145_crm_loyalty_consent_foundation.sql` |
| `20260813070000_phase_three_feature_flag_hard_lock.sql` | `20260821012146_phase_three_feature_flag_hard_lock.sql` |

The SQL content is byte-for-byte unchanged. No migration has been repaired,
manually marked as applied, reset, seeded, or applied with `--include-all`.

## Required gates

1. Rebuild a clean local database in the new order; run pgTAP, remote-safe lint,
   unit tests, build, Playwright E2E, and Production guardrails.
2. Merge through `staging`, verify the exact tree, then promote that same tree to
   `main`.
3. Create a fresh DR schema Plan and Apply it before creating a fresh Production
   Plan.
4. Production Apply must use `include_all_migrations=false` and the immutable DR
   Apply and Production Plan run IDs.
5. Keep Phase 3 feature writes disabled until the post-Apply replication upgrade
   and readiness gates pass.

Before any remote Apply, this recovery can be rolled back by reverting the
retimestamp commit. After Apply, database correction remains forward-only.
