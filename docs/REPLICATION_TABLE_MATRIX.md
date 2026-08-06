# Replication Table Matrix

The executable allowlist is
`scripts/lib/dr-replication-scope.mjs`. At this revision it contains 118
`public` business tables, and every selected table has a primary key.

## Included

| Domain | Examples | Notes |
| --- | --- | --- |
| Tenant and authorization | organizations, profiles, memberships, auth identity mappings | `profiles.auth_user_id` stays project-local; DR resolves the replicated identity mapping |
| Catalog and ordering | products, bundles, reusable notes, QR, sessions, orders, lottery draws | Trusted writes remain fenced |
| Operations | KDS, capacity, cash, print, schedules, alerts | Subscriber apply does not run normal application triggers |
| Commercial | plans, subscriptions, usage, invoices, billing events | System test orders remain non-billable |
| Notifications | outbox, integrations, jobs, webhook receipts | Outbound workers stay disabled on standby |
| OAuth identity | identity mappings, link invitations, state transactions, provider event ledger | Preserves account linking and replay protection across promotion |
| Delivery platforms | connections, store/menu mappings, external orders, webhook ledger, sync jobs | Preserves provider idempotency and order reconciliation across promotion |
| Resilience | feature flags, failover events, Storage manifest/jobs | Emergency state remains audited |
| Offline recovery | sync receipts, conflicts, domain Inbox and Outbox | Preserves failover-safe idempotency and reconciliation |
| Abuse controls | rate buckets and public order attempts | Prevents a failover from silently clearing recent abuse history |

The full names live in the fixed source allowlist so a newly created table
cannot enter replication accidentally.

The `profiles` publication has an explicit column list containing every current
column except `auth_user_id`. Its primary key remains published. Adding a
Profile column therefore requires updating and revalidating the publication
before relying on that column in DR.

## Excluded

| Table | Reason |
| --- | --- |
| `backend_runtime_state` | Environment-local role, writer fence and promotion epoch |
| `replication_health_snapshots` | Environment-local observations about the other backend |

Database configuration, `pg_cron`, Vault, provider credentials and temporary
health samples are outside the publication.

## New-table rule

Every migration adding a business table must:

1. add a primary key or measured replica identity;
2. add RLS and grants;
3. install `app_private.install_backend_writable_guard(...)`;
4. classify the table as included or environment-local;
5. update this matrix and the fixed allowlist;
6. validate DDL on DR before Primary.

Do not use `REPLICA IDENTITY FULL` on a high-volume table without WAL and
privacy evidence.
