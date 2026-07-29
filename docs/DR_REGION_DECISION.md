# DR Region Decision

## Short-term

The existing candidate Primary and Staging projects are both in Tokyo
(`ap-northeast-1`). Repurposing the second project can protect against selected
project-level failures, accidental data changes and some operational failures.
It does not provide a defensible Tokyo regional-outage guarantee.

## Long-term recommendation

Use Seoul (`ap-northeast-2`) as the preferred cross-region DR location when the
Supabase plan and tested replication path support it. Singapore
(`ap-southeast-1`) is the alternative.

The final choice requires measured:

- Primary-to-DR replication lag and WAL retention;
- failover application latency from Taiwan;
- provider availability and data residency requirements;
- Auth, Storage and Edge Function parity;
- monthly project, egress, backup and operational cost.

Do not move the Production database or create a new paid project automatically.
Cross-region provisioning remains approval-gated.
