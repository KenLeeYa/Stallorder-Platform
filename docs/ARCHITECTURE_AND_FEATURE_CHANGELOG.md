# StallOrder Architecture and Feature Change Ledger

This ledger is the durable entry point for owner-approved architecture and product-function changes. It prevents a new task from relying only on chat history or rediscovering an already changed contract.

## Source-of-truth order

1. Current code, migrations, configuration, and executable tests define observed behavior.
2. The affected architecture document, ADR, runbook, or product requirement explains the intended contract.
3. This ledger records what changed, its status, and where to find the detail and evidence.
4. The `stallorder-product-qa` Skill routes future tasks to the right documents and preserves durable invariants. It must not duplicate the full design.
5. Historical tasks and downloaded prompts are provenance only. They are not current behavior or authorization.

## Required entry contract

Add one row before merging an architecture or feature change. Use these statuses:

- `Proposed`: evaluated or designed, but no implementation or remote mutation has occurred.
- `Implemented`: code/configuration is committed and locally verified, but not released.
- `Released`: the exact revision has completed the protected release workflow and has immutable evidence.
- `Superseded`: a newer accepted entry replaces the decision; retain both entries and link them.

Every entry must identify the affected user roles, routes/services/data/environment, detailed document or ADR, executable verification, release evidence when applicable, and any superseded rule. Never place credentials, customer data, callback secrets, or connection strings here.

## Ledger

| Date | ID | Status | Change | Affected surfaces | Detail and verification |
| --- | --- | --- | --- | --- | --- |
| 2026-09-01 | `GOV-001` | Implemented | Require architecture and product-function changes to update repository Markdown, this ledger, and applicable Skill invariants in the same change. | All StallOrder implementation, review, QA, and release work | `AGENTS.md`; global `stallorder-product-qa/references/change-governance.md`; Skill validation required before handoff |
| 2026-09-01 | `DOMAIN-DR-001` | Proposed | Retire the stale `staging.qidaigo.com` runtime alias and reserve `dr.qidaigo.com` for protected operator-only DR validation. Keep `app.qidaigo.com` as the sole customer-facing Production hostname during Primary and DR operation. No DNS or Vercel mutation has been applied. | Cloudflare DNS, Vercel domains/deployments, Production/DR runtime configuration, OAuth, Passkeys, CSRF/CORS, Turnstile, callbacks, monitoring, failover/failback | [ADR-005](adr/ADR-005-dr-hostname-and-environment-domain-policy.md); read-only DNS/Vercel/HTTP evidence dated 2026-09-01 |
| 2026-09-01 | `DOMAIN-DR-002` | Implemented | Add the fail-closed protected DR operator endpoint and a separate immutable Plan/Apply workflow that creates `stallorder-dr`, verifies Vercel Authentication, DR database/Supabase/Auth/Storage/Edge identity, binds `dr.qidaigo.com`, and retires the legacy alias. Provider state remains unchanged until a reviewed Plan is explicitly applied. | `/api/health/dr/operator`, `vercel.dr.json`, Vercel project/domain API, Cloudflare DNS API, GitHub Production environment, DR Supabase project | [ADR-005](adr/ADR-005-dr-hostname-and-environment-domain-policy.md); `.github/workflows/production-dr-operator-entry.yml`; `scripts/manage-dr-operator-entry.mjs`; focused unit/contract tests and full release gates |
| 2026-09-01 | `DOMAIN-DR-003` | Implemented | Correct the Vercel provider sequence so the Git-unlinked project is created first, then `All Deployments` authentication is applied through Update Project and read back before any link, deployment, domain, or DNS mutation. | `scripts/manage-dr-operator-entry.mjs`, protected DR operator Apply and rollback | [PRODUCTION_DR_AUTOMATION.md](PRODUCTION_DR_AUTOMATION.md); failing-then-passing Production workflow contract test; failed Apply `33459478404` proved rollback complete before this correction |
| 2026-09-01 | `DOMAIN-DR-004` | Implemented | Align the Vercel project bootstrap with the current provider schema: keep `nodeVersion` out of Create Project, set Node.js `24.x` together with `All Deployments` through Update Project, and retain only a safe failure stage plus allowlisted provider error code in failed Apply evidence. | `scripts/manage-dr-operator-entry.mjs`, DR operator evidence artifact, Vercel Create/Update Project APIs | [PRODUCTION_DR_AUTOMATION.md](PRODUCTION_DR_AUTOMATION.md); focused unit/contract tests; failed Apply `33466252565` and read-only rollback audit `33466495876` |

## Maintenance rule

Do not rewrite an old row to make a later rollout look complete. Append a new row when status changes, include the exact commit/tree and protected evidence, and mark the prior row superseded only when the new decision is accepted.
