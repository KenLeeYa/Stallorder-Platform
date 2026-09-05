# StallOrder QA matrix

Use this matrix to select tests before changing code. Add or update automated tests in the repository where practical; this document is not a substitute for executable coverage.

## Universal preflight

| ID | Check | Pass condition |
|---|---|---|
| `QA-PRE-01` | Repository identity | Exact repo, branch, HEAD, upstream, worktree path, and dirty state recorded. |
| `QA-PRE-02` | Worktree safety | Existing dirty/untracked user files remain untouched; integration/release work uses a clean worktree. |
| `QA-PRE-03` | Concurrent work | Open PRs and local/remote branches reconciled by commit/tree/patch equivalence; no accidental omission or duplicate merge. |
| `QA-PRE-04` | CodeGraph | Query current `.codegraph` first when present; otherwise label source fallback and do not silently rebuild. |
| `QA-PRE-05` | Baseline | Focused reproduction is red before a defect fix, or existing behavior is recorded before an intentional change. |
| `QA-PRE-06` | Serving worktree | The process serving the local URL is mapped to its actual worktree/revision; concurrent writers have agreed file ownership and the revision is stable before build or browser evidence. |

## Required viewport and interaction matrix

Test each affected page at:

- `320x568`: narrow phone and worst-case wrapping.
- `390x844`: common phone.
- `768x1024`: tablet/portrait.
- `1440x900`: desktop.

For responsive shell, modal, toolbar, dashboard, catalog, or reporting changes, verify:

| ID | Check | Pass condition |
|---|---|---|
| `QA-UI-01` | Overflow | No unintended page-level horizontal scroll; intentional tool strips remain usable and do not hide logout/confirm actions. |
| `QA-UI-02` | Touch | Interactive targets are at least 44x44 CSS px or have equivalent hit area. |
| `QA-UI-03` | Text | No character-by-character compression, clipped label, overlapping icon, or unreadable ellipsis for critical actions. |
| `QA-UI-04` | Modal | Centered, bounded width/height, body scrolls, header/footer remain reachable, focus enters/restores, Escape/close behaves safely. Global save feedback traps focus until acknowledged; field errors remain inline and receive focus after dismissal. |
| `QA-UI-05` | Toolbar | Required order is preserved, controls do not duplicate, accessible name/tooltip exists for icon-only actions. |
| `QA-UI-06` | Dashboard | Cards select a safe column count for viewport; values/labels do not overflow and keyboard/screen-reader order matches visual order. |
| `QA-UI-07` | States | Loading, empty, success, validation, authorization, offline, retry, timeout, and unexpected failures render without layout collapse. |
| `QA-UI-08` | Navigation | Back/return restores origin route, query, filters, selection, and unsaved state when policy permits. |
| `QA-UI-09` | Localization | Traditional Chinese and one enabled non-Chinese locale cover static UI, dynamic catalog names, closure/status messages, errors, accessibility labels, and new feature copy without mixed-language leakage. |
| `QA-UI-10` | Compact action rows | Phone/tablet icon controls remain one orderly scrollable row with equal visual size, complete borders, reachable final actions, and no page-level horizontal overflow. |

## Role and permission journeys

| ID | Persona | Required journey |
|---|---|---|
| `QA-ROLE-01` | Customer | Open QR/public link → establish secure session → locale/catalog/closure translation → required contact → customize copies → submit → automatic status sync → ready sound/code → permitted modify/cancel → cache-safe return to Menu. |
| `QA-ROLE-02` | Staff | Login → configured group/product order → service mode → customized copies → schedule → discount/manager authorization → pickup-code pre-checkout → cash checkout → complete with KDS off → completed search/reprint/payment correction audit. |
| `QA-ROLE-03` | Kitchen | Login → one-row toolbar → orders/items/workstation flow → status updates → KDS/print interactions → refresh/SSE/network failure recovery. Pure Kitchen sees no unauthorized mode/stall switching. |
| `QA-ROLE-04` | Merchant | Login → multi-stall dashboard → one-vs-many stall selection → catalog/notes/bundles/publish → settings → reports → Staff/Kitchen authorized mode switching → return context. |
| `QA-ROLE-05` | Platform Admin | Login → responsive admin dashboard → open-beta/billing visibility → plan/entitlement Chinese labels → integration health → audit records. |
| `QA-ROLE-06` | Unauthorized | Cross-organization/stall IDs, direct URLs, hidden UI actions, and stale sessions are rejected by the server without existence leaks. |

## Functional regression packs

### QR and cart

| ID | Requirements | Assertion |
|---|---|---|
| `QA-QR-01` | `QR-001`,`QR-002` | Session succeeds or produces bounded retryable error; no infinite secure-session spinner. |
| `QA-QR-02` | `QR-003`–`QR-005` | Dine-in has no pickup selector; takeout/delivery and Staff scheduling follow their configured rules and five-minute steps. |
| `QA-QR-03` | `QR-006` | Pre-expiry and expired centered modals work; valid cart restores, invalid lines are explained. |
| `QA-QR-04` | `QR-007`,`QR-008`,`STAFF-008` | Edit changes the same line; add-another creates independent customization in both QR and Staff. |
| `QA-QR-05` | `QR-010`,`LOT-005` | Hot badge is compact; no rank text; popularity excludes invalid orders. |
| `QA-QR-06` | `QR-013`,`QR-014` | Success and modification flows preserve order integrity and return JSON errors. |
| `QA-QR-07` | `QR-016`–`QR-018` | Missing name/phone is rejected; a takeout/delivery amendment restores and preserves the original name and phone; Staff status changes arrive without reload; ready uses a centered code plus sound/visual fallback when autoplay is blocked. |
| `QA-QR-08` | `QR-019`,`QR-020` | Return-to-Menu revalidates availability/version; the edit draft remains scoped to the tracked order and original service-mode route; pre-confirm cancel and pre-lock amendment update that same order, while locked orders remain unchanged and Staff is re-notified. |
| `QA-QR-09` | `LOC-001`–`LOC-004` | Device locale and manual override resolve category/group/product/closure/order copy consistently; cache invalidation follows locale and catalog version. |
| `QA-QR-10` | `QR-021` | Draft restore is scoped and bounded; valid lines restore, while next-day/version/price/sold-out changes are explained and cannot submit stale data. |
| `QA-QR-11` | `QR-022` | Delivery notice appears once in a centered localized dialog only for delivery when configured; empty/plain-text/500-character boundaries and markup escaping pass. |
| `QA-QR-12` | `QR-011`,`STAFF-016` | Published/enabled sold-out items stay visible in public Menu/QR/takeout/delivery with grayscale image and localized label; all customer add/customize controls and stale submission are blocked, while authorized Staff onsite ordering retains the item. Disabled and unpublished controls remain hidden. |
| `QA-QR-13` | `QR-023` | Module and per-product recommendation default off; the large per-product switch is inside the stall product-detail dialog and the shared editor provides one switch per assigned stall below the lottery control. Both persist only on save and are not duplicated on catalog rows. Enabling both shows eligible recommendations once before checkout, skip/add/customization work, and cart-existing, sold-out, disabled, missing, or cross-stall candidates are excluded by UI and server validation. |
| `QA-QR-14` | `QR-024` | Force a reorder transport timeout and verify localized guidance plus a working retry with no raw timeout text. Delay the first post-cancel read, verify confirmed cancellation renders immediately, and verify the stale read cannot restore the active state. Run the same tracking contract for QR, takeout, and delivery orders. |

### Pickup codes and checkout

| ID | Requirements | Assertion |
|---|---|---|
| `QA-ORD-01` | `ORD-001`–`ORD-004` | Concurrent allocations never duplicate an active same-day code; rollover and completed reuse behave; Staff lookup opens the intended order. |
| `QA-ORD-02` | `STAFF-003`,`STAFF-004` | Cash/tender/change and discount totals are recomputed server-side; excluded products remain undiscounted. |
| `QA-ORD-03` | `STAFF-005`–`STAFF-007`,`X-002` | Payment correction success/failures are JSON, authorized, audited, and reports reconcile. |
| `QA-ORD-04` | `ORD-006` | Duplicate client requests/timeouts result in one order and stable response semantics. |
| `QA-ORD-05` | `STAFF-009`,`STAFF-010` | Staff uses configured group/product order without duplicated category/group navigation; required pickup code is entered in the centered pre-checkout flow. |
| `QA-ORD-06` | `STAFF-011`,`STAFF-012` | Completed orders default today, reprint is idempotent, manager code protects high-risk actions, and payment correction cannot mutate item lines. |
| `QA-ORD-07` | `STAFF-013`,`STAFF-014` | Staff toolbar icons are equal, bordered, one row, and reachable; redundant helper panels are absent while safety/offline/validation messages remain. |
| `QA-ORD-08` | `STAFF-015`,`QR-017` | Pre-production unpaid public takeout adjustment requires a reason/message, reprices and audits atomically, cancels stale pending print jobs, and reaches customer tracking; locked/paid failure leaves the order unchanged. |
| `QA-ORD-09` | `STAFF-003`,`STAFF-010`,`STAFF-018` | Confirm a real QR order, collect cash before production, and verify it remains active as `PAID` with `completedAt=null`; finish KDS/manual production, verify pickup, then confirm the explicit terminal request alone removes and completes the order. Payment, cash drawer, configured print job, pickup verification, and completion remain independently auditable. |

### KDS and printing

| ID | Requirements | Assertion |
|---|---|---|
| `QA-KDS-01` | `KDS-001`,`KDS-002` | All four KDS/printing combinations reach the correct terminal state and leave no hidden active task/job. |
| `QA-KDS-02` | `KDS-003`–`KDS-006` | Exact one-row icon order and permission visibility pass all viewports; no duplicate chef/production control. |
| `QA-KDS-03` | `KDS-007` | Settings back returns to exact prior context. |
| `QA-KDS-04` | `KDS-008` | Retry/callback/manual reprint is idempotent and copy counts/content are correct. |
| `QA-KDS-05` | `KDS-001`,`QR-017`,`QR-018` | With KDS off, confirmation still exposes Staff completion; completion—not confirmation—moves the public order to ready and triggers customer alert. |
| `QA-KDS-06` | `KDS-009`,`KDS-010` | Proxy checkout has one primary action; packaging is conditional; sticky group navigation works across Staff/QR/takeout/delivery without obscuring content. |
| `QA-KDS-07` | `STAFF-017` | Enable wake lock, navigate through a Staff/Kitchen internal tool, simulate browser sentinel release while visible, and return. A fresh `navigator.wakeLock.request()` succeeds and the active control returns without another user toggle; disable and background/foreground paths remain correct. |
| `QA-PRN-01` | `PRN-001`,`PRN-002` | Device/printer capability reports supported/setup/unsupported accurately; paired Bluetooth or cable alone never produces a false success. |
| `QA-PRN-02` | `PRN-003`–`PRN-006` | MCP31LB/57mm physical test covers compact content, no `[A1]` markers, auto/reprint retry, disconnect/paper-out, cutter/buzzer support, and cash-drawer outcome separately from payment. |
| `QA-PRN-03` | `PRN-007` | Create and rotate two printer credentials; verify stable distinct URLs, one-time raw passwords, hash-only persistence, immediate old-password rejection, cross-printer denial, no secret in URL/logs, and copyable no-overflow setup at 320/390/768/1440 px. |
| `QA-PRN-04` | `PRN-008`,`STAFF-018` | A reachable iPad webPRNT printer with no enabled auto-print rule reports setup required and does not promise output. Adding an enabled rule permits matching jobs; printing a QR receipt never removes the active order, while payment and eligible drawer opening remain successful if printing is absent or fails. |
| `QA-PRN-05` | `PRN-009`,`MER-014` | At 390/768/1440 px, stall/table A4, A5, and A6 controls keep paper size and 「印刷版」 on two intentional lines, open only the selected print layout, and invoke browser print/save-PDF. Tablet QR management renders QR/print left and unified-link/actions right without overflow. |

### Catalog, notes, bundles, and image upload

| ID | Requirements | Assertion |
|---|---|---|
| `QA-CAT-01` | `CAT-001`–`CAT-003`,`CAT-010` | Responsive tool grouping, group collapse, global single toggle, and menu publication icon remain reachable. |
| `QA-CAT-02` | `CAT-002` | Bundle publish makes it visible/orderable in QR and Staff; price and group constraints are server-authoritative. |
| `QA-CAT-03` | `CAT-004`–`CAT-006` | The main page simultaneously shows exactly two large entries for single notes and note groups, with no duplicate top toolbar or tabs. Each opens the same searchable hierarchy and centered action dialog; note selection scrolls, confirms, multi-adds, deduplicates, orders, and round-trips import/export inside the overlays. |
| `QA-CAT-04` | `CAT-007` | Numeric zero placeholder clears correctly and invalid numeric values identify the field. |
| `QA-CAT-05` | `CAT-008`,`CAT-009` | Valid image uploads and invalid type/size/dimension failures return JSON; processed media meets bounds. |
| `QA-CAT-06` | `CAT-011`,`CAT-012` | Lottery and no-extra-discount flags persist through create/edit/import/assignment/publish. |
| `QA-CAT-07` | `CAT-013`,`STAFF-009`,`LOC-002` | Category/group/product order and translated names match Merchant, public Menu/QR, Staff, KDS/print, and reports. |
| `QA-CAT-08` | `CAT-014`,`CAT-015` | Product and promo images preview, pan/zoom/crop, save, reload, render responsively, delete, and show JSON-backed success/failure; promo placement does not lengthen the page top. |
| `QA-CAT-09` | `CAT-004`,`CAT-016`,`MER-021` | Shared-catalog/note icons form one row with distinct category/group controls; single-note/group overlays and stall-product assignment remain reachable at phone/tablet sizes, and desktop panes scroll independently. |
| `QA-CAT-10` | `CAT-017`,`X-003` | Upload/assignment/publication/translation/order actions are reachable and provide immediate success/failure feedback without duplicate submission. |

### Lottery, capacity, and reservations

| ID | Requirements | Assertion |
|---|---|---|
| `QA-LOT-01` | `LOT-001`–`LOT-004` | Probability config validates; draw result modal works; once-per-day token is privacy-safe and repeat draw is blocked. |
| `QA-LOT-02` | `LOT-005`,`LOT-006` | Recommendation uses eligible sellable popularity and shows “推薦你點”. |
| `QA-LOT-03` | `LOT-007` | Threshold, birthday, and holiday eligibility is server-derived; live QR/takeout shows the centered final-submit eligibility alert, while delivery/preorder payloads suppress campaign eligibility and their draw requests fail before the draw RPC. The free item is eligible, zero-priced, audited, and idempotent under retries. |
| `QA-CAP-01` | `CAP-001`,`CAP-002` | Wait range changes with configured base/prep/queue inputs; no client hard-coded 13–18 fallback is mislabeled as live estimate. |
| `QA-CAP-02` | `CAP-003`,`CAP-004` | Pickup/delivery scheduling and merchant-proposed delivery change require valid windows and explicit customer decision. |
| `QA-CAP-03` | `CAP-005`,`CAP-006` | Five-minute takeout lead is consistent across DB/API/UI; customer-present override honors KDS-ready boundaries, clears the pending proposal, audits the action, and still requires pickup/payment checks. |
| `QA-NOT-01` | `NOT-001`–`NOT-003` | Reminder lead time, presets/custom media validation, audio unlock, bounded repeats, acknowledgement, background/offline recovery, and visual fallback pass Staff/Kitchen viewports. |

### Merchant/Admin shell and reports

| ID | Requirements | Assertion |
|---|---|---|
| `QA-MER-01` | `MER-001`,`MER-002` | Activated merchant lands on overview; exactly one stall routes to QR management; multiple stalls open selector modal. |
| `QA-MER-02` | `MER-003`–`MER-006` | Header, trend row, report actions/filters, dashboards pass responsive matrix. |
| `QA-MER-03` | `MER-007`,`MER-013`,`MER-023` | Return state and all centered overlays preserve usability/focus; stall-setting and stall-product-setting save success/global failure use the shared feedback dialog, while field validation remains inline and regains focus after acknowledgement. |
| `QA-MER-04` | `MER-008`,`ADM-003` | Operator-facing names are Traditional Chinese; raw keys remain available in detail where useful. |
| `QA-MER-05` | `MER-010`–`MER-012` | Floors/table shapes/single-page settings/group placement persist and remain usable. |
| `QA-MER-06` | `MER-015`,`QA-PERF-04` | Cross-stall reports, audit logs, and operational alerts default to the local current day; day/week/month/custom ranges produce matching bounded server queries and reject invalid or overlong ranges. |
| `QA-MER-07` | `MER-016` | Authorized report entry appears on desktop/mobile for one and many stalls; direct route authorization remains enforced and only page-internal multi-stall controls are conditional. |
| `QA-MER-08` | `MER-017`,`MER-018` | Server pagination defaults to five; login devices have no size selector; orders/date filters and collapsible product analyses retain query state across pages. |
| `QA-MER-09` | `MER-019`–`MER-022` | Metric cards, two-row filters, grouped non-accordion settings, independent scroll panes, and compact headers pass all viewports. |
| `QA-MER-10` | `MER-014`,`PRN-009` | QR management remains bounded on desktop, full-width two-column on tablet, single-column on phone, and all A4/A5/A6 print actions stay visible and operable. |
| `QA-ADM-01` | `ADM-001`–`ADM-004` | Responsive admin billing/plan UI, open-beta, and merchant billing visibility follow server flags. |
| `QA-ADM-02` | `ADM-005`,`ADM-006`,`ADM-011` | The fixed-port launcher proves the expected worktree/HEAD/origin, refuses collision/remote DB, disables stale development service workers, and the four local roles plus public Menu, successful QR/takeout session creation, and cash smoke work on that same origin. The guarded OAuth-policy bypass remains absent/inert in Production and all origins fail closed outside local config. |
| `QA-ADM-03` | `ADM-007`–`ADM-010` | Login methods reflect policy plus configured credentials; incomplete modules stay hidden/direct APIs closed; phone header/theme, simple copy, and privacy-safe device labels pass. |

### Integrations and mobile

| ID | Requirements | Assertion |
|---|---|---|
| `QA-INT-01` | `INT-001`,`INT-002` | Provider flags off fail closed; retries/dedup/reconciliation work in mock/Preview without external write. |
| `QA-INT-02` | `INT-003` | Webhook signature/replay, ledger, refund, and secret redaction tests pass. |
| `QA-INT-03` | `INT-004` | Translation is server-only, cached, budgeted, and secret-free in client bundles/logs. |
| `QA-INV-01` | `INV-001`–`INV-003` | Merchant-order and platform-billing invoices remain separate; tenant FK/RLS, idempotent state transitions, disabled live flags, and mock/contract behavior pass. |
| `QA-MOB-01` | `MOB-001`–`MOB-004` | Native API/session boundaries are distinct from browser cookies; RBAC/tenant tests and feature flags pass. |

### Protected release and DR

| ID | Requirements | Assertion |
|---|---|---|
| `QA-REL-01` | `REL-DR-VERCEL-01` | Create payload omits `ssoProtection` and leaves the exact project ID unlinked/domainless; PATCH and read-back require `all` before link/deploy/domain/DNS. PATCH/read-back failure deletes that exact ID, verifies rollback, stops, and never falls back to `all_except_custom_domains`. |
| `QA-REL-02` | `REL-DR-STORAGE-01` | Replication snapshot and standalone Storage verification share the canonical mirror proof. A valid completed `DELETED` tombstone with `deleted_at` and null checksums passes without inflating active manifest counts; missing/extra objects, missing active manifests, pending states, checksum mismatches, and every malformed tombstone fail closed. |

## Data, API, and security matrix

| ID | Check | Pass condition |
|---|---|---|
| `QA-SEC-01` | Tenant isolation | Cross-organization/stall reads and writes fail at service/API/database layers; client tenant IDs cannot override principal scope. |
| `QA-SEC-02` | Server totals | Product/bundle price, options, discount, tax, payment, and status transitions are recalculated from server records. |
| `QA-SEC-03` | Auth/session | Rotation, revocation, CSRF/origin, rate limit, cookie/native-token scope, and role permissions have positive and negative tests. Every deployed application and Edge participant in one environment receives the same active public-order token/hash secrets, while Primary and DR remain isolated; values never appear in logs or evidence. |
| `QA-SEC-04` | Input/output | Schema validation, content type, upload parser limits, output encoding, safe logs, and JSON error contracts pass. |
| `QA-SEC-05` | DB | Fresh migration rebuild, pgTAP/RLS/policies, grants, functions/search_path, remote lint, and history/dry-run pass. |
| `QA-SEC-06` | Supply chain | Lockfile install, dependency audit, secret scan, SAST/deep scan, build provenance, and artifact evidence pass or have an explicit bounded exception. |
| `QA-SEC-07` | Abuse/privacy | Pickup code, lottery token, public order, upload, and provider endpoints resist enumeration/replay/rate abuse without invasive device fingerprinting. |

## Performance evidence

| ID | Check | Pass condition |
|---|---|---|
| `QA-PERF-01` | Reproducibility | Before/after uses same commit basis, data fixture, local/hosted environment, warm/cold policy, concurrency, and sample count. |
| `QA-PERF-02` | Server paths | Report p50/p95/p99 and error rate for QR bootstrap/menu/session, Staff board, Kitchen board/SSE, Merchant dashboard/catalog, Admin dashboard, and touched mutations. |
| `QA-PERF-03` | Browser | Report navigation/TTFB and Core Web Vitals or repository-declared equivalents for affected views at phone/tablet/desktop. |
| `QA-PERF-04` | Database | Capture query count/duration and explain/index evidence for changed hot queries; prove no N+1 or cross-tenant overfetch. |
| `QA-PERF-05` | Regression | Repository budgets are authoritative. If no budget exists, do not claim improvement without repeated measurements and disclose variance; any material regression blocks release pending owner decision. |

## Completion evidence template

```text
Revision / tree:
Environment and data fixture:
Requirements covered:
QA case IDs passed:
Focused reproduction/control:
Full local gates:
Responsive/browser evidence:
Performance before/after:
Security scans and findings:
Skipped / not evaluated:
Staging / DR / Production receipts:
Live smoke and rollback state:
```
