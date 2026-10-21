# Repository audit — bounded current baseline

2026-10-01. Worktree `C:/Users/KY/.codex/worktrees/responsive-cross-device/Stallorder-Platform`, branch `codex/responsive-cross-device-20260930`, HEAD `87230e266281472a71fd764d616be1adf788c635`, tree `ee9337ebc9a311ce68e1d2c1500379ab67129714`. BEFORE tracked diff0; unrelated untracked responsive artifacts and root-owned Awesome state/decisions/evidence retained. No CodeGraph directory; source audit fallback used. Node24.18.0/npm11.16.0 freshly observed. Root package and resolved lock retain Next16.3.4/React19.2.4/Tailwind4/Zod4/Prisma6.19. No package-manager/directory rewrite.

## Verified discovery sources (source inspection is not runtime PASS)
The full scoped source audits are `.superpowers/sdd/2026-10-01-awesome-optimization/audit-web-mobile.md` and `audit-backend-events.md`; the latter rehashed affected backend files at87230e2. Their concrete call paths were reused, not redundantly reaudited or promoted to fresh tests. Current route/dependency/module inventory: `batch-1/inventory.json`. Current downloaded master prompt1098lines SHA256`9028b6fd7bf80ce816eb49a316067b2dd8dd5fca61eaf0f3df63315bbebfb01b` was read in bounded full segments. Existing change ledger and current bundled Next `use-client.md` read before edits.

| Capability | Actual source seam | Existing owner / gap |
| --- | --- | --- |
| Web tokens/dialogs | globals.css, ExperienceDialog, shared-catalog-manager, Lucide | Reuse current responsive/focus/navigation; no shadcn overwrite |
| Session/scope | auth.ts, authorization.ts, rbac.ts, workspace.ts | Server Session/membership/permission/entitlement/CSRF authoritative; Prisma needs server auth too |
| Live reads | use-live-resource.ts, staff-order-board-live.ts | Existing abort/SSE/poll fallback; Query must not add another poller |
| Catalog | catalog-data.ts, organization catalog route, SharedCatalogManager | Existing server write/stock authority; unpaged catalog read and scope-late-response gap |
| Reports | report-scope.ts/report-data.ts/operations-pagination.ts/csv.ts | Scoped server pagination and test exclusion; replica reports not transaction authority |
| Applications | onboarding-form, merchant-application-contract/service/admin-service, approve-merchant-application | Four-step drafts and transactional approval exist; draft explicit version/conflict and admin201strow pagination gap |
| Notifications | billing_notifications/notification_outbox; notification_jobs; staff_push_deliveries | Distinct existing audiences/queues, no generic Inbox claim; fixed v2 sender vs new merchant-first requirement waits decision |
| Jobs | outbox-dispatcher, notification workers, report-delivery | Existing ownership must be preserved; report PROCESSING recovery/snapshot/UNKNOWN and legacy final crash gaps |
| Native | current checkout has no apps/mobile/packages/mobile BFF | Clean7849df8 audited clone has coherent Expo57/RN0.86/Auth/SecureStore/BFF; forwardport, no second App/Auth. Old audit/emulator are historical |
| Analytics/search/BI | Vercel monitoring/redaction, canonical reports, local catalog name filter | Product event/feedback/scoped search/trace seams pending; no external SDK/account |
| PAYG/OMO | payg-pricing/contract, billing events, SupplyLite/ExternalOrder | Original TWD1/1499cap and canonical ledgers retained; no B2B into B2C billing |
| QA/CI | rootci, ephemeral-preview, responsive target/provenance helpers | Root local checks retained. Preview ordinaryPR external mutation removed by explicit dispatch+Preview gate; existing owned cleanup preserved |

## Current bounded findings
- Real Admin/Merchant lab modules constructed Prisma before target guard; RED6constructor side effects reproduced with fake system boundaries and no wrong-target request; guard moved narrowly, GREEN6plus original target cases verified.
- Static existing edge `storefront-mode-nav.tsx -> public-storefront.ts -> prisma.ts` is recorded with exact3source hashes in `scripts/awesome-optimization/boundary-baseline.json`, normalizing only CRLF to LF for checkout portability. This is static baseline debt, not proven runtime/bundle leakage. New/different edge or substantive hashed source change fails. Product helper splitting belongs to a later consumer boundary change with navigation/bundle regression.
- Full real product/browser/DB/Native/metrics checks remain NOT_RUN. Batch1 CLI/security-source tests do not satisfy all82AW cases. Existing3630unit/128responsive results are historical.
- Root's read-only `preview-approval-readback-20261001.json` found Preview `protection_rules=[]`; actual approval configuration is MISSING and external activation remains blocked. Both owned Preview jobs now read actual nonempty required-reviewers rules before mutations, including fail-closed guards on always-cleanup steps; missing/denied/malformed readback rejects. No setting changed or workflow dispatched. Root resolved the v1 branch of supabase/setup-cli to `1dedf2c611547ede7232d26866dd3c56ab903bbb` and upload-artifact v4 to `ea165f8d65b6e75b540449e92b4886f43607fa02`; only owned workflow references were pinned. This does not certify other workflows or remotely executed approvals.

Repair I1–I4 adds shared recognized-scope recipes and exact receipt validation, reviewable effective-input path/hash inventory, CRLF-only baseline normalization and TypeScript directive-prologue discovery. Inventory binds current source/migrations, repository scripts/imported helpers, workflow test fixtures, nonsecret compiler/lint/QA/provider configs, package lock and the three installed check launcher files. `.env` files/values are excluded; dependency lock/launcher binding is not a hash of every installed dependency byte. Root-owned documentation/receipts are outside writer ownership.

Lifecycle: root retained only7containers in `stallorder-responsive-20260930` (API56821/DB56822). App3026 and original3023 have no listener. This batch started/stopped no Docker/app/DB/provider services and wrote no DB rows; parent retains the project for following consumer QA. See root `evidence/single-environment-20261001.json`, not a fabricated new readback.
