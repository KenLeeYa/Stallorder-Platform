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
| 2026-09-01 | `DOMAIN-DR-005` | Implemented | Replace the unavailable Vercel `All Deployments` DR boundary with Cloudflare Access on the proxied custom hostname, Vercel Standard protection on generated deployment URLs, and Plan-bound Access JWT verification at the DR origin. Human access is limited to current Cloudflare account members; automated Apply QA uses a one-hour service token that is deleted after verification. No remote resource is created until a fresh immutable Plan passes. This supersedes the protection mechanism in `DOMAIN-DR-002` through `DOMAIN-DR-004` while retaining their historical evidence. | `dr.qidaigo.com`, Next.js proxy, Cloudflare Access application/policies/service token, proxied DNS, Vercel DR project, protected Plan/Apply and rollback | [ADR-005](adr/ADR-005-dr-hostname-and-environment-domain-policy.md); [PRODUCTION_DR_AUTOMATION.md](PRODUCTION_DR_AUTOMATION.md); Cloudflare Access JWT and DR workflow contract tests |
| 2026-09-04 | `ORDER-QR-001` | Implemented | Separate onsite QR payment from fulfillment completion: Staff may collect payment after confirmation while the order remains active; configured print rules and cash drawer stay independent; print success or pickup verification cannot silently close the order; explicit completion remains the terminal gate. | Customer QR tracking, Staff checkout/KDS, order and payment transaction, pickup verification, print routing, cash drawer; local only | `STAFF-018`, `PRN-008`, `QA-ORD-09`, `QA-PRN-04`; focused Vitest coverage and real local QR/KDS/cash/pickup Playwright flow |
| 2026-09-04 | `PWA-WAKE-001` | Implemented | Reacquire an operator-requested Wake Lock after internal Next.js navigation as well as initial load and visibility restoration, without showing active state until a new sentinel is granted. | Global PWA runtime, Staff and Kitchen operational pages; local only | `STAFF-017`, `QA-KDS-07`; focused contract test and Playwright route-away/release/return assertion |
| 2026-09-04 | `PUBLIC-ORDER-EDIT-001` | Implemented | Keep QR/takeout/delivery amendments bound to the original order and service-mode Menu, restore and preserve takeout contact data, normalize scheduled instants, and align deployed application/Edge token secrets so update and cancel actions authenticate consistently. | Public Menu/cart/tracking, Circuit B/RPC/Edge order creation, Production/DR application workflows; local only | `QR-014`, `QR-016`, `QR-020`, `QR-024`, `QA-QR-06`–`QA-QR-08`, `QA-QR-14`, `QA-SEC-03`; focused contracts plus real local QR and takeout edit/cancel Playwright flows |
| 2026-09-04 | `QR-PRINT-RESP-001` | Implemented | Make A4/A5/A6 QR print actions visually unambiguous and operable, and use a full-width left-QR/right-actions tablet layout while retaining bounded desktop and single-column phone presentation. | Merchant stall/table QR management and isolated print pages; local only | `PRN-009`, `MER-014`, `QA-PRN-05`, `QA-MER-10`; responsive contract and Playwright print/layout checks |

## Maintenance rule

Do not rewrite an old row to make a later rollout look complete. Append a new row when status changes, include the exact commit/tree and protected evidence, and mark the prior row superseded only when the new decision is accepted.
