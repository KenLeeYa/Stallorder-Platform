# StallOrder product requirements baseline

This file is the durable owner acceptance baseline. It does not assert that a requirement is currently implemented or deployed. Verify the current revision. Newer explicit owner instructions override older ones; superseded interpretations are noted where important.

## Requirement notation

- `MUST`: release-blocking behavior when the affected domain changes.
- `LOCAL`: allowed only in an explicitly local test environment.
- `FLAGGED`: present behind a server-controlled feature flag and fail closed when unavailable.
- IDs are stable and should be referenced by tests and release notes.

## QR ordering and public menus

- `QR-001` QR session establishment MUST leave the loading state or show a useful, retryable Traditional Chinese error; it MUST NOT remain indefinitely at “正在建立安全點餐工作階段”.
- `QR-002` QR ordering MUST preserve server-side session, CSRF/origin, stall status, service-mode, and tenant checks. A network failure MUST not be presented as a security denial without a retry path.
- `QR-003` Dine-in QR ordering does not ask the customer for a pickup time. A public takeout link may ask for expected pickup time, and a delivery link may ask for expected delivery time. Staff phone orders retain scheduling controls.
- `QR-004` Public takeout and delivery links MUST use separate service-mode rules, scheduling, availability, and copy. Local testing may bypass business hours only under a non-Production guard.
- `QR-005` Takeout and delivery date selection uses an accessible calendar. Time uses 24-hour hours and five-minute minute increments (`00, 05, 10…55`). Store rules determine allowed windows.
- `QR-006` A 10-minute customer ordering session MUST show a centered warning shortly before expiry and an expiry modal afterward. The action refreshes/re-establishes the session. The cart MUST be restored when product/version validity permits; invalid lines MUST be explained instead of silently dropped.
- `QR-007` Editing an existing cart line changes the primary action label from “加入購物車” to “修改完成” and updates that line rather than adding a duplicate.
- `QR-008` The same product with different notes/options MUST be represented as independent cart lines. Both QR and Staff ordering MUST support an explicit add-another-item path.
- `QR-009` The product page provides a small floating return-to-top action at the lower right without covering checkout controls.
- `QR-010` Hot products show a compact “熱銷” label/icon only; do not expose “近 30 天熱銷第 N 名”. Ranking and recommendation are server-derived from eligible completed sales.
- `QR-011` Public Menu, QR, takeout, and delivery catalog presentation keeps every published and enabled product or bundle visible in configured order even when it is sold out. A sold-out item uses a grayscale image plus the localized sold-out label, and all customer customization, quantity, and add controls are disabled; authoritative order submission still rejects stale sold-out lines. Disabled or unpublished items retain their existing visibility rules. Public Menu also has a shareable link suitable for LINE and other platforms and a stable menu-image/export presentation where supported.
- `QR-012` Non-business hours may accept configured takeout reservations; closed/paused service states and temporary network interruption are distinct and clearly described.
- `QR-013` Order success displays the unique pickup verification code, payment state, expected/confirmed time, items, and a safe modification path when modification is still allowed.
- `QR-014` Public order modification MUST return structured JSON errors, preserve the original order on failure, and reject changes after production/printing policy locks the order.
- `QR-015` QR, public takeout, and delivery entry points MUST remain operable in phone, tablet, and desktop layouts without oversized QR/menu content or unintended viewport scaling.
- `QR-016` Public takeout and delivery require customer name and reachable phone before submission. Validation is server-enforced and identifies the missing field in the active locale.
- `QR-017` Customer order tracking updates automatically after Staff confirmation, preparation, ready/completion, cancellation, payment, or proposed-time changes. Use a single live subscription owner with bounded polling fallback, stale-state indication, and retry; customers MUST NOT need manual refresh.
- `QR-018` Ready-for-pickup shows a centered pickup-code overlay and a noticeable sound after browser audio has been unlocked by user interaction. Visual and vibration-capable fallbacks remain when autoplay is blocked.
- `QR-019` Returning to Menu from order completion revalidates business hours, pauses, holidays, publication, price, sold-out status, and menu version instead of restoring a stale cached orderable page.
- `QR-020` Before merchant confirmation, a customer may cancel or modify the submitted order. After confirmation but before production policy locks it, changes use an amendment flow on the same order, recompute totals server-side, and notify Staff again. Once locked, the UI explains why a new order is required.
- `QR-021` Customer draft/cart retention is explicit, tenant/stall/service-mode scoped, and bounded. A restored draft revalidates menu version, price, availability, options, and business-day policy; stale next-day items are never submitted silently.
- `QR-022` A merchant-configured delivery notice is optional, delivery-only, limited to 500 plain-text characters, and shown in a centered localized dialog when the customer enters delivery ordering. Empty notices do not create an empty dialog, and merchant text is never interpreted as markup or instructions.
- `QR-023` Checkout add-on recommendation is a per-stall module that defaults off. Each stall product has a separate large recommendation switch inside its product-detail dialog and defaults unselected; the shared-product editor may expose the same saved state as one switch per assigned stall below the lottery control, but catalog rows MUST NOT duplicate it. The centered recommendation dialog appears once before checkout only when the module is enabled and at least one configured product is published, enabled, not sold out, and not already in the cart. Skip continues checkout; add uses the normal customization flow; server-side catalog and price validation remains authoritative. A stall may configure at most six recommendation products.
- `QR-024` Public order tracking, modification, and cancellation MUST convert transport/timeout failures into localized, retryable customer guidance and MUST NOT expose raw browser/network text such as `signal timed out`. After the cancellation endpoint confirms `CANCELLED`, the tracker updates immediately without waiting for another poll; an older in-flight response cannot restore the pre-cancel state.

## Pickup verification and order identity

- `ORD-001` Online pickup orders receive a three-digit display code from `001` to `999`.
- `ORD-002` Codes MUST be unique among active online orders for the same stall and local business day. Issued active codes are recorded transactionally so concurrent requests cannot collide.
- `ORD-003` A code from a completed/cancelled/expired order may be reused when policy allows. Day rollover archives or expires the allocation without deleting audit history needed for reconciliation.
- `ORD-004` Staff has a prominent “輸入取餐驗證碼” action that finds the active order and opens the correct checkout/order detail directly. Ambiguous or unavailable codes show a useful message.
- `ORD-005` Manual pickup verification does not require typing the full order number after a verified pickup code or an already authenticated staff selection.
- `ORD-006` All order creation and mutation endpoints are idempotent for retries and never duplicate an order because of client timeout/retry.

## Staff ordering, checkout, discounts, and payment correction

- `STAFF-001` Staff ordering supports dine-in, takeout, and delivery when each service mode is enabled for the stall.
- `STAFF-002` Staff takeout/delivery scheduling uses the same calendar and five-minute, 24-hour time controls as public scheduling, with server validation.
- `STAFF-003` Cash checkout MUST settle an eligible payment, validate tendered amount, calculate change, and show actionable field errors. It completes the order only when checkout is the terminal fulfillment action; QR prepayment follows `STAFF-018`.
- `STAFF-004` Configured discounts are selectable at checkout and recalculate the authoritative server total. Per-product “不額外折扣” defaults off unless explicitly set and excludes that product from order-level discounts.
- `STAFF-005` Completed-order payment-method correction returns structured JSON on every response, records actor/reason/old/new value, updates financial reports consistently, and never exposes HTML as JSON.
- `STAFF-006` Payment method codes may use the supported character set declared by the product. Every constrained setting field MUST show an inline and submit-time Traditional Chinese validation message identifying the invalid field and rule.
- `STAFF-007` Cancelling or correcting completed orders requires explicit authorization and an audit trail; reports, cash handoff, payment analysis, and inventory effects remain reconciled.
- `STAFF-008` Staff cart behavior matches `QR-007` and `QR-008`: modifying a line is distinct from adding another line with different customization.
- `STAFF-009` Staff ordering follows the configured product-group and product order used by QR/Menu. It shows one group navigation hierarchy and MUST NOT duplicate category and group rows for the same grouping.
- `STAFF-010` Pickup verification is entered in a centered pre-completion overlay. A paid takeout order's final completion action opens the overlay when verification is required; payment collection remains independent, and Staff is not expected to find a separate field elsewhere.
- `STAFF-011` Completed-order search defaults to the current local day, exposes order details and receipt reprint, and supports authorized cancellation. Payment-method correction may change only the payment method and related ledger/report entries, never products, options, or quantity.
- `STAFF-012` A merchant-configured manager authorization code protects high discounts, completed-order cancellation/deletion, completed-payment correction, and other explicitly high-risk Staff actions. The server verifies the code, rate-limits attempts, records actor/reason/action, and never stores or logs plaintext.
- `STAFF-013` Staff operational toolbars use equal-size icons, complete borders, one-row horizontal scrolling on constrained phone/tablet widths, accessible names/tooltips, and no compressed second row. Offline, translation, logout, saved-order, product, and checkout controls follow the same sizing contract.
- `STAFF-014` Staff ordering removes permanent space-consuming instructional panels once the action is self-explanatory. Compact icon tooltips/accessibility names provide help; actionable validation, offline, safety, and order-state messages remain visible.
- `STAFF-015` Staff may adjust an unpaid public takeout order only before production or printing locks it. The adjustment requires an explicit sold-out/replacement/quantity/other reason and a customer-facing message, reprices the complete order on the server, invalidates stale pending print jobs, records before/after audit data, and delivers the amendment to customer tracking without reload. Failure preserves the original order.
- `STAFF-016` A per-stall sold-out flag blocks online customer ordering but does not hide or disable the product in authorized Staff onsite ordering. Master-product deactivation, stall-assignment disablement, schedule constraints, and other explicit Staff availability rules remain independently enforced.
- `STAFF-017` When Staff or Kitchen enables screen wake lock, the preference persists across full reload, internal route navigation, and temporary backgrounding. Returning to a visible operational page MUST re-request a released lock and show the active state only after the browser grants a live sentinel.
- `STAFF-018` A confirmed onsite QR order may be paid before production finishes. Successful payment records the authoritative payment and cash-shift linkage, triggers only configured print rules, and keeps the active order visible through KDS/manual fulfillment. Receipt success and pickup verification MUST NOT independently close the order; the explicit final completion action enforces ready/served and pickup gates, then sets `COMPLETED`.

## Kitchen, printing, and operational completion

- `KDS-001` For customer-submitted takeout/delivery orders, disabling KDS MUST leave an explicit Staff “完成訂單” action after confirmation; confirmation alone is not “可取餐”. Completion updates customer tracking and ready alerts. When KDS is enabled, the kitchen lifecycle remains authoritative. Printing is a related idempotent job and MUST NOT remove the required manual/KDS terminal path.
- `KDS-002` Disabling KDS or printing cleans or reconciles hidden active tasks/jobs so orders do not remain permanently blocked. Takeout pickup verification remains enforced where configured.
- `KDS-003` Kitchen toolbar is one row at every supported width, with horizontal scrolling only when necessary. Latest required order: 訂單、品項、工作站、廚房切換、語言、模式切換、網路、喚醒控制、SSE、工作站設定、KDS 設定、提示音、重整、登出. Do not duplicate a separate “生產看板” button.
- `KDS-004` Language and every toolbar control share the same visual size and minimum 44px touch target. Logout follows refresh in the same tool row on desktop and mobile.
- `KDS-005` A pure Staff or pure Kitchen account MUST NOT see stall selection or work-mode switching. A Merchant acting within authorized Staff/Kitchen modes may switch. Kitchen entry is hidden when the module is disabled.
- `KDS-006` Staff and kitchen role-switch icons are visually distinct from operational toolbar icons: use a person/badge metaphor for Staff and a chef/person metaphor for Kitchen, not duplicate chef-hat controls.
- `KDS-007` Workstation and KDS setting pages return to the exact preceding page/state; no settings page may jump to an unrelated merchant page on back.
- `KDS-008` Printing is idempotent. Automatic routing and manual reprints do not collide; copies, product-scoped rules, status callbacks, and order completion remain consistent.
- `KDS-009` Staff proxy checkout exposes one clear primary action. A separate “包裝中” transition appears only when the merchant has enabled a real packaging stage; otherwise it is hidden and the lifecycle proceeds through the configured preparation/completion states.
- `KDS-010` Product-group navigation stays sticky below the active header on Staff, QR, public takeout, and delivery phone/tablet views without covering products, alerts, or checkout controls.

## Printer, receipt, and cash-drawer capability

- `PRN-001` The printing module detects the signed-in device, browser capability, configured printer, transport, and connection state, then reports `可列印`, `需要設定`, or `不支援`. Bluetooth pairing or a connected cable alone is not proof that Safari can send print commands.
- `PRN-002` For iPad Safari and Star MCP31LB/mC-Print3, do not assume generic raw Bluetooth, USB, or Lightning browser access. Enable a transport only after proving a vendor-supported browser protocol/URL scheme, reachable network/CloudPRNT route, approved bridge, or native integration. Unsupported paths fail closed with setup guidance and never fake a successful print.
- `PRN-003` The 57mm receipt layout is compact and configurable. It prints only enabled important fields, uses small safe vertical spacing, wraps Chinese text, supports copies/routing, and never prints editing markers such as `[A1]`…`[A4]`.
- `PRN-004` Automatic print triggers, retry, status callback, manual reprint, and completed-order receipt print share one idempotent job contract. A retry cannot duplicate an order or silently increase copy count.
- `PRN-005` A cash drawer connected to the printer opens only through a verified printer/bridge capability after an eligible completed payment. Drawer failure is a separate actionable hardware error, is audited, and does not rewrite the settled payment.
- `PRN-006` Print settings may control event, copy count, destination/workstation, receipt fields, font emphasis, line spacing, logo/QR, cutter, buzzer, drawer pulse, and failure policy. Unsupported controls are hidden or disabled by detected printer capability.
- `PRN-007` Each CloudPRNT printer has a stable, system-generated HTTPS Server URL and independent credentials. The setup UI permanently exposes the copyable Server URL and User Name/Device ID, exposes the raw Password/Device Token only immediately after generation or rotation, stores only its hash, and invalidates the prior password immediately on rotation. Credentials never appear in the URL or logs.
- `PRN-008` Automatic-print readiness requires both a reachable enabled printer and at least one enabled `autoPrint` rule assigned to it. A connected printer without a rule is reported as `需要設定`; payments and cash-drawer actions remain independent and no automatic print is promised.

## Catalog, bundles, notes, media, and menu publication

- `CAT-001` Shared catalog supports categories, groups, products, bundles, CSV import/export, menu version, and publication. Phone layouts wrap category/group controls separately from product/bundle controls without compression.
- `CAT-002` Bundle management combines configured sellable products/groups and sets a bundle price. Published bundles MUST appear and be orderable in both QR and Staff ordering with authoritative bundle pricing.
- `CAT-003` Product creation uses logical collapsible sections. “收合全部／展開全部” is a single stateful button. Catalog item collapse is by group; a global product-collapse control is not duplicated.
- `CAT-004` Shared notes are first-class reusable records. The main note-settings page shows exactly two large entry actions at the same time: reusable notes and note groups. It has no duplicate top toolbar or tab row; import/export and create actions live inside the relevant searchable, hierarchical overlay. Individual note/group actions open a second centered action dialog instead of expanding a long flat page. Note groups select multiple existing shared notes through a centered, scrollable modal with search, multi-select, visible confirm/cancel, deduplication, and responsive layout.
- `CAT-005` Notes, note groups, categories, groups, products, and relevant catalog groups support deterministic ordering. Any note-group expansion control appears only inside the note-group hierarchy and aligns with that hierarchy's controls.
- `CAT-006` Shared note groups support import/export without losing option price, required/multi-select rules, order, or relationships.
- `CAT-007` Product amount fields clear the initial zero when the user starts typing and never create ambiguous values.
- `CAT-008` Product image upload accepts at most 5MB, validates content and pixel dimensions before expensive processing, corrects orientation, preserves aspect ratio, does not upscale, outputs bounded WebP, and never stores the original oversized file.
- `CAT-009` Image upload APIs return structured JSON for expected errors and never let an HTML framework/proxy page surface as `Unexpected token '<'`.
- `CAT-010` “菜單版本與發佈” is visible as an icon at the end of the catalog tool row and remains reachable on phone, tablet, and desktop.
- `CAT-011` Every product can opt into lottery eligibility; default is enabled for newly created products. Eligibility and sold-out/publication status are enforced server-side.
- `CAT-012` Products may be marked excluded from extra/order-level discounts, and this flag is preserved across catalog assignment/import/publish flows.
- `CAT-013` Category, group, product, bundle, option, and note ordering is deterministic and shared by Merchant preview, QR, public Menu, Staff, Kitchen tickets, and print routing where applicable.
- `CAT-014` Product-image upload shows an immediate local preview, then a centered crop editor with drag, pan, zoom, bounded crop, cancel, delete, and explicit upload-success feedback. The stored/rendered image MUST use the confirmed crop and remain visible after reload.
- `CAT-015` Public Menu promotional media supports upload, preview, responsive crop/focal-point adjustment, delete, and success/failure feedback. It renders inside the merchant-information/banner region, not as an oversized page-lengthening image above it.
- `CAT-016` On phone/tablet, shared-catalog and shared-note action groups stay in one compact horizontally scrollable icon row. Category and group creation use distinct icons and accessible names.
- `CAT-017` Every catalog-management upload, assignment, publication, translation, and ordering control shows immediate success/failure feedback and remains reachable without scrolling an unrelated pane.

## Lottery and hot-product recommendation

- `LOT-001` Lottery settings allow multiple discount outcomes (for example 95折、9折、8折), enable/disable each outcome, and assign server-validated probabilities.
- `LOT-002` The customer starts lottery from a centered modal/animation flow. The result modal shows the recommended item with “接受” and “取消”. Accept adds it to the cart; if customization is required, the flow opens the product customization step instead of creating an invalid line.
- `LOT-003` A customer device may draw once per stall/local day. Do not access hardware serial numbers. Use a privacy-preserving, revocable server-issued device token plus rate/abuse controls and clear retention policy.
- `LOT-004` A second draw shows a centered “一日僅能抽取一次” message and does not leak whether another customer used the same network.
- `LOT-005` Recommendation weighs recent completed-sales popularity among currently sellable and lottery-eligible products, while preserving configurable randomness/discount rules. Cancelled/refunded/test orders do not inflate popularity.
- `LOT-006` Customer copy is “推薦你點” so it covers food and drinks.
- `LOT-007` Lottery campaigns support spend-threshold, birthday, and merchant-defined holiday eligibility. Spend/holiday rewards are exposed only in eligible live QR/takeout sessions; delivery and preorder sessions receive no eligible campaign state and the draw API rejects those channels before invoking the draw function. When a live QR/takeout cart first qualifies at final submission, a centered alert dialog offers the draw before order submission. An awarded free product is server-selected only from eligible configured products, added to the same order at zero price with an auditable promotion reference, and cannot be duplicated by retry or client tampering.

## Capacity, wait time, reservations, and delivery changes

- `CAP-001` Wait-time display is not a hard-coded 13–18 minutes. Merchants configure base time and preparation contribution; the server calculates a range from queued orders, item quantities, workstations/capacity, and current operating state.
- `CAP-002` QR/public pages display the latest server estimate and explain when an estimate is unavailable. Client code does not independently invent capacity time.
- `CAP-003` Takeout supports expected pickup time; delivery supports requested delivery time. A merchant who cannot meet a requested delivery time proposes a new time and notifies the customer for explicit accept/reject.
- `CAP-004` Reservation windows, lead time, capacity, holidays, pauses, and business hours are enforced transactionally at order creation and revalidated on modification.
- `CAP-005` Public takeout minimum advance time is at least five minutes. Database defaults, API normalization, settings validation, and merchant form limits use the same five-minute floor; older values below the floor are normalized before enforcement.
- `CAP-006` If a takeout customer arrives while a merchant-proposed pickup time is still awaiting response, authorized Staff may mark the customer present and continue the original checkout. With KDS enabled, every item and the order must already be ready; with KDS disabled, the manual terminal path may reconcile unfinished item state. The override clears the pending proposal and is audited, but it never bypasses pickup-code or payment validation.

## Operational reminders and alert audio

- `NOT-001` Merchants configure reservation/preorder reminder lead time. At the due time, authorized Staff/Kitchen views receive a synchronized sound plus visible flashing/highlighted order alert until acknowledged or the bounded repeat policy ends.
- `NOT-002` Alert settings provide tested preset sounds and may accept a custom audio file only within documented MIME, decoded-duration, byte-size, and loudness bounds. The server validates/normalizes media; unsupported or corrupt audio is rejected with JSON and Traditional Chinese guidance.
- `NOT-003` Browser audio is unlocked through an explicit user interaction and tested after reload/background recovery. Because the web app cannot override device mute/volume, critical alerts always have visual, stale/offline, retry, and acknowledgement fallbacks.

## Merchant navigation, stalls, tables, reports, and responsive UI

- `MER-001` After first-time activation, Merchant login defaults to the multi-stall operations overview. Opening/onboarding remains under stall-management settings.
- `MER-002` If the organization has exactly one stall, the stall selector goes directly to that stall’s QR management page—not the generic stall settings page. Two or more stalls open a centered selector modal.
- `MER-003` The header uses compact icon controls for role/work mode, stall, language, theme, network, and logout. On phone, controls must not create a second large blank header or require repetitive collapse/expand interaction.
- `MER-004` Multi-stall overview, sales trends, platform billing, cash handoff, and other metric-heavy phone pages use compact responsive dashboard grids. Desktop/tablet may show labels; phone may show icons with accessible names/tooltips.
- `MER-005` Sales-trend navigation icons remain in one row, not a vertical column. Hourly sales chooses the maximum safe column count from the viewport without overflow.
- `MER-006` Stall-performance report filters/actions use compact icons on phone and text on tablet/desktop. Audit and operational-warning filters wrap into two responsive rows on phone/tablet.
- `MER-007` Every navigation transition preserves the originating route, query, filters, sort, date range, selected stall, scroll position where reasonable, and draft form state on return.
- `MER-008` Audit event/action identifiers and other operator-facing technical labels display a clear Traditional Chinese name, while retaining the raw identifier in detail/debug views where useful.
- `MER-009` Theme is a single sun/moon toggle with accessible state and no layout shift.
- `MER-010` A stall supports multiple floors and separate floor plans. Table editor includes common shapes such as oval, rectangle/square, diamond, and triangle with accessible selection and persistent geometry.
- `MER-011` Single-stall management pages may show setting choices directly. Do not add collapse controls to a short single-page settings screen; use them only when content length materially benefits.
- `MER-012` Security and order-limit settings live with their corresponding stall setting groups rather than a disconnected top-level page.
- `MER-013` Centered overlays MUST constrain width, keep readable text, allow internal vertical scrolling, preserve a visible header/close control and footer confirmation actions, avoid narrow character-by-character wrapping, and restore focus on close.
- `MER-014` On desktop, QR management displays QR codes at a bounded, scannable size rather than scaling to fill the viewport.
- `MER-015` Cross-stall reports, audit logs, operational alerts, and every historical database-heavy list default to the current local day. They MUST provide a validated bounded date range before loading older records; audit/operations filters include day, week, month, and explicit start/end controls. The server query—not only the displayed form—enforces the same tenant-scoped time boundary.
- `MER-016` The authorized “跨攤位報表” navigation entry remains visible for one-stall and multi-stall organizations. Single-stall mode may hide only genuinely multi-stall comparison/batch content inside the page; it MUST NOT hide the ordinary report entry or single-stall report overview.
- `MER-017` All large order, cash-handoff, audit, warning, device, and comparable data lists paginate. The current default is five rows, superseding earlier ten-row defaults. Login devices always show five rows with pagination only when needed and no page-size selector; other lists may expose a bounded page-size selector when useful.
- `MER-018` Completed-order reporting supports day, week, month, and validated custom ranges. Product analysis includes product-group/category sales; product-group sales, organization-wide best sellers, and per-stall best sellers are collapsible.
- `MER-019` Trend overview, stall comparison, payment analysis, and cash handoff use the same responsive metric-card language. Filters on phone/tablet wrap into at most two orderly rows rather than one long compressed row.
- `MER-020` Stall settings do not wrap every subsection in repetitive “詳細資料” accordions. Similar pickup, delivery, reservation, availability, and notification settings are grouped by workflow; long editors use a dedicated page or bounded modal, while short settings remain directly visible.
- `MER-021` Stall-product assignment is a distinct action. Phone/tablet open it in a bounded modal or dedicated view; desktop list panes scroll independently so a long product list does not force the operator to reach another pane’s bottom.
- `MER-022` Merchant header, report navigation, language/theme controls, and icon toolbars align consistently at phone, tablet, and desktop widths. Compact rows may scroll horizontally, but logout/checkout/confirm actions cannot be clipped or pushed outside the reachable strip.
- `MER-023` A stall-settings or stall-product-settings save success or global save failure is shown in one centered, accessible feedback dialog with a clear acknowledgement action. Field-specific validation remains next to the affected field; after acknowledgement, focus returns to the first invalid control. Persistent instructions, availability state, and destructive confirmations are not converted into transient success dialogs.

## Platform admin, plans, billing, localization, and local test access

- `ADM-001` Platform Admin navigation adapts to viewport; phone top navigation uses compact icons with accessible labels.
- `ADM-002` Platform billing/operations metrics use the same responsive card-dashboard visual language as sales trends.
- `ADM-003` Feature entitlement matrix, plan catalog, add-ons, billing relationships, and other identifiable operator labels use Traditional Chinese display names. Stable technical keys remain internal/detail data.
- `ADM-004` An Admin-controlled open-beta switch may put the platform into no-fee testing. Merchant subscription/payment UI remains hidden until the owner enables the billing feature; enforcement is server-controlled.
- `ADM-005` Local development login exposes four explicit role buttons for fixed test accounts only. The guarded bypass may ignore the Platform OAuth-only display policy, but MUST still verify the test account password/session and requires development mode, a loopback app origin, a loopback database, an exact same-origin request, and the explicit local-QA flag. Production builds MUST not render, accept, or route through local test-login credentials or origin bypasses.
- `ADM-006` Account login origin/CSRF validation accepts only the one explicitly selected local QA origin during local development. APP, public-order, browser, and CSRF origins use the same fixed port; an occupied port is a test failure and MUST NOT silently auto-increment. All non-local configurations remain fail-closed.
- `ADM-007` Platform Admin controls which login methods are shown. Google login is shown by default only when correctly configured; email/password follows policy. Passkeys/WebAuthn and any incomplete provider/module stay hidden until their full server path, recovery, audit, and QA are operational.
- `ADM-008` Platform Admin phone navigation is one compact horizontally scrollable icon row. Account/logout sits at the upper right without forcing an extra line, and a compact light/dark theme toggle is present.
- `ADM-009` Merchant-facing device information uses simple labels such as phone, tablet, or computer plus browser/platform when available. Do not expose IP, Cookie, full fingerprint, or promise an exact Safari hardware model.
- `ADM-010` Merchant-facing explanatory copy is short and task-oriented. Avoid protocol, identity-linking, browser-fingerprint, provider-contract, or infrastructure jargon unless the page is explicitly a technical Admin detail view.
- `ADM-011` The canonical local-QA launcher records the actual worktree, HEAD, fixed origin, and enabled local guards; rejects Production mode, non-loopback databases, and port collisions; disables the development service worker; prewarms login and availability code; and starts Next from that worktree. A health response alone is insufficient: readiness also requires owner, Staff, Kitchen, Platform Admin, public Menu, successful QR/takeout order-session creation, and cash-handoff smoke checks against the same origin.

## Localization and translated catalog content

- `LOC-001` QR and public Menu detect the browser/device language on first visit. An explicit customer language choice overrides detection and persists within a bounded first-party preference; Traditional Chinese is the declared fallback only when that locale is not enabled.
- `LOC-002` Every enabled locale covers static UI plus merchant data shown to customers: category, group, product, bundle, option, note, service mode, temporary closure/holiday, scheduling, validation, order status, payment, and new feature copy. Missing translations are flagged before publication; an enabled non-Chinese locale MUST NOT silently leak Chinese labels.
- `LOC-003` Merchant/Staff/Kitchen language switching also refreshes applicable catalog names and operational labels without requiring a full manual reload. Translation caches are keyed and invalidated by locale, tenant, catalog/menu version, and source update.
- `LOC-004` Every user-visible feature change updates the central message catalog and tests at least Traditional Chinese plus one enabled non-Chinese locale. Literal UI strings outside the catalog require an explicit technical reason.

## External delivery, payments, translation, and native mobile

- `INT-001` Foodpanda/Uber Eats and other delivery connections use provider-neutral adapters, idempotency, outbox/retry, provider-scoped deduplication, observability, and reconciliation. Provider read/write flags remain off until credentials, partner approval, hosted Preview, and Staging smoke pass.
- `INT-002` Missing credentials or provider capability fails closed with actionable status; mock adapters never masquerade as live providers.
- `INT-003` Payment integrations use authoritative server ledgers, signed webhook verification, replay protection, refund/reconciliation audit, and secret-safe admin views. Contract-only adapters remain disabled until real certification/credentials.
- `INT-004` Automatic catalog translation runs server-side, caches persisted translations, translates only missing enabled languages, enforces budget/queue limits, and never exposes API keys to the browser.
- `INV-001` Merchant order e-invoices and platform subscription/billing invoices are separate domains, sequences, permissions, reports, and provider credentials. Neither may reuse the other’s tax identity or document lifecycle implicitly.
- `INV-002` E-invoice records, preferences, provider jobs, and audit events are organization-scoped with database-enforced tenant relationships. Provider issue/void/allowance operations are idempotent, state-machine controlled, and fail closed.
- `INV-003` Local/mock e-invoice mode may validate contracts without live provider writes. Merchant setup, customer checkout, sandbox, production issue, and provider capabilities remain independently server-flagged until certification, credentials, Staging, and reconciliation evidence pass.
- `MOB-001` Merchant/Platform Admin native mobile is an additional Expo/React Native client, not a WebView replacement. Customer QR remains Web/PWA.
- `MOB-002` Native mobile reuses centralized RBAC, tenant, order, KDS, reporting, and printing contracts through versioned mobile APIs. It does not create a second authorization model.
- `MOB-003` Native authentication uses opaque server-owned credentials in SecureStore with device scope, rotation, revocation, and native CSRF/origin semantics; browser cookies are not copied as the security model.
- `MOB-004` Mobile provider writes, offline POS, hardware printing, refund, subscriptions, and high-risk Admin writes remain flagged/canary until explicitly verified.

## Cross-cutting validation and error behavior

- `X-001` Every setting form identifies invalid fields in Traditional Chinese at submit/save and, when helpful, inline. “Unable to save” without a field/action reason is insufficient.
- `X-002` Every internal API expected to return JSON returns JSON for success, validation, authorization, conflict, dependency failure, and unexpected error. Client code verifies content type before JSON parsing and shows safe user messages.
- `X-003` Loading actions disable duplicate submission, provide immediate feedback, and retain recoverable input after failure.
- `X-004` New functionality includes phone/tablet/desktop layout acceptance and role/permission acceptance in the same change.
- `X-005` Shared components MUST be regression-tested in every consuming surface touched by the contract: Customer QR, Staff, Kitchen, Merchant, and Platform Admin.
- `X-006` A UI-visible change is incomplete until localization, accessibility name/tooltip, empty/error/loading state, responsive layout, return navigation, and server authorization are evaluated together.
- `X-007` A state-machine change is incomplete until customer tracking, Staff, KDS, printing, notifications, reports, cash handoff, payment, inventory/promotion, audit, and retry/idempotency impacts are evaluated.
- `X-008` Local fixes are verified against the worktree actually serving the test URL. Evidence collected while another task is changing that worktree is stale and must be rerun after a stable revision is agreed.
