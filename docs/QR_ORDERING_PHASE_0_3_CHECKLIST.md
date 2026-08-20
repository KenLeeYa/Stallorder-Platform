# StallOrder QR 訂購 Phase 0–3 正式 Checklist

> 本文件只記錄目前工作樹可由程式、資料庫與測試證明的事實。Local、CI／Preview、Staging 與 Production 是四個不同 Gate；任一較早 Gate 通過，都不能代替後續 Gate。

## 1. 文件控制

| 欄位 | 目前值 |
| --- | --- |
| 更新日期 | 2026-08-14 |
| 分支 | **codex/mobile-ui-followups-20260812** |
| Git 基準 | **5b263bbac5d8** + 尚未 commit 的 Phase 0–3 local tree |
| Remote 漂移 | **origin/main 97a7c8fab964**（本機落後 38 commits）；**origin/staging 9e4e13f827d2**（本機落後 37 commits），均非本機基準，發布前必須重新整合與重驗 |
| CodeGraph | 已以目前索引核對 QrOrderFlow、StaffOrderBoard、live resource、WorkspaceRouteContext 與 Circuit A/B 主要路徑 |
| Local DB | 隔離 Supabase runtime；94 個 migration 可由空資料庫重建 |
| CI／Preview | 未執行 |
| Staging | 未執行 |
| Production | 未執行 |

工作樹仍在變動，因此下列狀態分成：

- **LOCAL PASS**：目前實作與該項專屬測試已有通過證據。
- **PARTIAL**：已有實作與部分測試，但尚未滿足完整驗收條件。
- **DORMANT FOUNDATION**：schema、RLS、service／contract、ADR 與測試基礎已完成，但功能旗標保持 OFF，沒有對外啟用。
- **BLOCKED FOR ACTIVATION**：需要 provider、產品、營運、法遵或同意治理決策，不能由本機測試自行解除。

## 2. 不可破壞條件與發布邊界

- [x] 公開 QR 訂購不進入可信裝置的 offline POS queue。
- [x] 保留 RLS／tenant scope、短效單次 session、Turnstile、rate limiting、stall／QR lock、server-side pricing 與 idempotency。
- [x] Transport error 或 5xx response-loss 重試沿用同一 logical operation ID；terminal backend code 才旋轉 session identity。
- [x] Circuit A/B 保留不同 transport 與部署故障域，但以 canonical response、token、error、audit 與 replay contract 校驗。
- [x] 所有本輪 DB 變更皆為新的 append-only migration；未回寫歷史 migration。
- [x] Phase 3 五個旗標預設 OFF；未通過 activation Gate 前不得對顧客或商家顯示。
- [x] 同一最終可執行 tree 的完整 Local runtime Gate；其後只更新本 checklist。
- [ ] CI／Preview Gate。
- [ ] 與預計發布相同 tree 的 Staging Gate。
- [ ] Production DR Plan／Apply。
- [ ] Production immutable Plan。
- [ ] 綁定該 Plan ID、run ID、revision 與環境摘要的明確 owner confirmation。
- [ ] Production Apply 與部署後 smoke。

即使有「途中不需核准」的一般授權，Production Apply 仍須綁定當次不可變 Plan 的明確確認；歷史確認、本文或 blanket approval 都不能替代。

## 3. Phase 摘要

| Phase | 正式狀態 | 已證明範圍 | 尚未關閉 |
| --- | --- | --- | --- |
| Phase 0 | **LOCAL PASS** | P0-01～07 已有 local code/test；P0-04 blocker matrix 47/47；112 項 E2E 與 390×844 人工流程通過 | CI／Preview、Staging 與發布 Gate |
| Phase 1 | **LOCAL PASS** | P1-01～06 已本機實作；DB、migration、concurrency、outbox 與 A/B commit-loss replay 有證據 | CI／Preview、Staging 與發布 Gate |
| Phase 2 | **PARTIAL** | P2-03（Tracker＋Staff 範圍）、P2-04 與 P2-05 已達 local contract；完整 E2E 通過 | P2-01、P2-02 經第二輪 bounded extraction 後仍尚非 composition-only |
| Phase 3 | **DORMANT FOUNDATION / BLOCKED FOR ACTIVATION** | 五項 schema／RLS／service／ADR／mock 或 contract 基礎在本機，五個旗標全部 OFF | active UI、真實 provider、營運與同意治理、sandbox／Staging 驗證 |

## 4. Phase 0 — 正確性與立即 UX

### QR-P0-01 商家路由攤位解析

- 狀態：**LOCAL PASS**
- 正式程式入口：**src/proxy.ts** → **src/app/merchant/template.tsx** → **resolveWorkspaceRouteContext** → **MerchantWorkspaceHeader**
- 測試：**src/lib/workspace-route-context.test.ts**、**src/app/merchant/template.test.tsx**、**src/components/merchant-workspace-header.test.ts**、**e2e/multi-stall.spec.ts**

- [x] server request header 帶入 canonical pathname／organization hint。
- [x] template 在 requireWorkspacePage 授權後，從已核准 workspace 集合解析 organization／stall。
- [x] route-owned stall 優先於 stale query organization。
- [x] multi-organization、unscoped null、invalid outsider 與 unauthorized render failure 有測試。
- [x] current-tree multi-stall 與完整 browser E2E 通過。

舊文件曾把 client header resolver 寫成正式安全邊界；該路徑已更正。安全 context 的真正注入點是 **src/app/merchant/template.tsx**。

### QR-P0-02 PREORDER 先選時段再顯示可售菜單

- 狀態：**LOCAL PASS**
- 程式：**src/components/qr-order-flow.tsx**、**src/lib/public-menu.ts**
- 測試：**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/preorder-shared-link-cross-role.spec.ts**、**src/lib/public-menu-preorder.test.ts**

- [x] 未套用時段時不顯示可點菜單。
- [x] 套用後只顯示該時段可售商品。
- [x] 改選但尚未套用時，畫面保留上一個已套用菜單，避免混合狀態。
- [x] 套用新時段會移除失效品項與必選規格。
- [x] 新增真實 DB 的 PREORDER 同單跨顧客、Staff、KDS、Tracker E2E。
- [x] 跨角色 PREORDER 規格已納入 current-tree full E2E 並通過。

### QR-P0-03 Product Bottom Sheet 與 Cart／Checkout 分責

- 狀態：**LOCAL PASS**
- 程式：**src/components/qr-order-flow.tsx**、**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-independent-cart-lines.spec.ts**

- [x] product configuration 使用行動版 dialog／Bottom Sheet。
- [x] Cart 與 Checkout 使用不同 step，履約及顧客欄位不混入純購物車檢視。
- [x] Escape、focus return、focus trap 與 session expiry dialog 優先序有測試。
- [x] 360 px、390 px 的 dialog／CTA／頁面 overflow assertion 已建立。
- [x] current-tree full E2E 與 390×844 bottom-sheet／CTA 人工檢查通過。

### QR-P0-04 送單 CTA 顯示精確缺少條件

- 狀態：**LOCAL PASS**
- 程式：**src/components/qr-order-flow.tsx** 的 checkoutBlocker；**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/qr-independent-cart-lines.spec.ts**、delivery／capacity QR suites

- [x] 程式能區分 ordering unavailable、空購物車、未套用時段、session 未就緒／逾時、外送電話／地址、必選規格、等候確認及 Turnstile。
- [x] blocker 使用鄰近 Checkout 的 role=status 訊息，不只依賴 disabled button。
- [x] 時段、必選規格、等候確認與 session expiry 有直接 E2E assertion。
- [x] `resolveQrCheckoutBlocker` 單一 matrix 已覆蓋 4 種 unavailable、空購物車、PREORDER 未選時段、session 未就緒／逾時、DELIVERY 欄位、必選規格、等候確認、Turnstile 與 all-clear；focused **47/47 PASS**。
- [x] 修正 session readiness 與 ordering availability 被同一布林值綁定、導致 session-loading blocker 不可達的問題。
- [x] current-tree full E2E 最終重跑通過。

### QR-P0-05 Tracker 顯示現在、下一步與協助入口

- 狀態：**LOCAL PASS**
- 程式：**src/components/public-order-tracker.tsx**、**src/components/line-notification-controls.tsx**
- 測試：**src/components/public-order-tracker.test.tsx**、**e2e/phase0-3-role-mobile-journey.spec.ts**

- [x] 五階段 stepper、目前狀態與下一步。
- [x] 最後更新、更新中、離線與連線狀態。
- [x] 所有訂單皆可看到安全協助／重新整理／再次點餐入口。
- [x] 未核准的私人電話、LINE 或外部連結不會被揭露。
- [x] current-tree 跨角色 mobile journey 與人工 Tracker walkthrough 通過。

### QR-P0-06 Hidden／offline 停止 polling 並取消請求

- 狀態：**LOCAL PASS**
- 程式：**src/lib/use-live-resource.ts**、**src/components/public-order-tracker.tsx**、**src/lib/public-order-client.ts**
- 測試：**src/lib/use-live-resource.test.ts**、**src/components/public-order-tracker.abort.test.tsx**、**src/components/public-order-tracker.test.tsx**

- [x] hidden 或 offline 會停止 timer 與 adapter。
- [x] 回到 visible／online 立即 refresh，再恢復單一 interval。
- [x] refresh 合併、cursor dedupe 與 stale response 防護。
- [x] AbortSignal 從 tracker load 傳入 public-order client，並貫穿 Circuit A/B timeout merge 到實際 fetch。
- [x] abort 不被誤判為 infrastructure failure，也不會因此啟動 Circuit fallback。

### QR-P0-07 秒級倒數與抽獎動畫移出 QrOrderFlow

- 狀態：**LOCAL PASS**
- 程式：**src/components/qr-session-countdown.tsx**、**src/components/qr-session-expiry-dialog.tsx**、**src/components/qr-lottery-dialogs.tsx**、**src/lib/session-countdown.ts**、**src/lib/qr-lottery.ts**
- 測試：**src/lib/session-countdown.test.ts**、**src/lib/qr-lottery.test.ts**、QR lottery／cart E2E

- [x] countdown 與 expiry callback 在 bounded hook／view。
- [x] lottery animation／dialogs 不再由父元件每 tick 全體 rerender。
- [x] reduced-motion、抽獎上限、失敗復原與 dialog focus 有測試。
- [x] current-tree full E2E 最終重跑通過。

## 5. Phase 1 — 低風險效能與可靠性

### QR-P1-01 includeMenu:false Session query budget

- 狀態：**LOCAL PASS**
- 程式：**supabase/functions/create-order-session/index.ts**
- 測試：**supabase/functions/create-order-session/query-plan.test.ts**、**e2e/qr-local-smoke.spec.ts**

- [x] 有 SSR menu 時，輕量 refresh 使用 includeMenu:false。
- [x] 非桌位 lightweight Session 的 Circuit A DB query budget 是 **4**，不是舊文件的 6。
- [x] 回應仍有 session、capacity 與必要 context。

### QR-P1-02 實體 QR SSR 跳過無用 PREORDER slots

- 狀態：**LOCAL PASS**
- 程式：**src/app/q/[qrToken]/page.tsx**、**src/lib/public-menu.ts**
- 測試：page unit、public-menu PREORDER unit、QR PREORDER E2E

- [x] 實體 QR SSR 不查 shared-link PREORDER 專用 slots。
- [x] shared-link PREORDER 仍取得 slots。
- [x] menu、ordering mode 與 cache key 不互相污染。

### QR-P1-03 容量狀態未改變時不重算

- 狀態：**LOCAL PASS**
- migration：**20260809161446_dedupe_stall_capacity_refresh.sql**
- 測試：capacity migration／pgTAP、**e2e/capacity-refresh-concurrency.spec.ts**

- [x] unchanged state 回傳同一份 authoritative snapshot。
- [x] changed state 只做必要後置計算。
- [x] warning、auto-pause／resume、manual pause 與 snapshot 等價性有 pgTAP。
- [x] 真正多連線測試固定 lock order、同攤位序列化、無 deadlock。

### QR-P1-04 全域 schedule processor 改為 targeted catch-up

- 狀態：**LOCAL PASS**
- migration：**20260813010000_target_stall_schedule_catch_up.sql**
- 測試：targeted migration／pgTAP、**e2e/targeted-stall-schedule-concurrency.spec.ts**

- [x] 新增 stall-scoped trusted schedule catch-up RPC。
- [x] 公開 Session／Order hot path 只處理目前 stall。
- [x] 維運路徑保留全域 catch-up。
- [x] 兩 stall isolation、lock order 與 no-deadlock 有 DB／concurrency 證據。

### QR-P1-05 Circuit A/B golden parity 與共同 operation ID

- 狀態：**LOCAL PASS**
- 程式：**supabase/functions/_shared/public-order-replay.ts**、兩個 Edge function、**src/server/public-order/circuit-b-service.ts**、**src/lib/public-order-client.ts**
- 測試：dual contract、replay／query-plan unit、**src/server/public-order/circuit-ab-db-replay.test.ts**

- [x] operationId 與 sessionRequestId／order idempotency key 分責。
- [x] fallback、retry、response 與 audit 保持同一 operationId。
- [x] timestamp、token 與 body 使用 canonical serialization。
- [x] 真實 Local PostgreSQL Session commit-loss replay：Circuit A commit 後丟失 response，再由 B replay；只有一個 ACTIVE session。
- [x] 真實 Local PostgreSQL Order commit-loss replay：Circuit A commit 後丟失 response，再由 B replay；只有一張 order。
- [x] DB-backed replay **2/2 PASS**；canonical body、token、code、time、operationId 與 audit correlation 一致。
- [x] query evidence：Circuit A Session **4**、Circuit A Order **6**、Circuit B replay **5**。

### QR-P1-06 Outbox consumer、重試與 lag 可觀測性

- 狀態：**LOCAL PASS**
- ADR：**docs/OUTBOX_DISPATCH_ADR.md**
- 程式：**20260813001731_p1_outbox_dispatch.sql**、**src/server/outbox/outbox-dispatcher.ts**、cron route
- 測試：outbox pgTAP、dispatcher unit、failure injection、cron route unit

- [x] notification outbox 使用 claim／lease、bounded retry、dead-letter outcome 與可重入 consumer。
- [x] domain outbox 在沒有正式 event contract 時保持 dormant；producer 寫入 CANCELLED，未知 pending event fail closed。
- [x] 沒有 drop／replace 已發布 status constraint；lease／retry 以 additive columns 與 RPC outcome 表示。
- [x] pending age、queue depth、dead-letter telemetry 不含 PII／secret。
- [x] crash-after-send、duplicate delivery 與 provider timeout 有 pgTAP／unit。

## 6. Phase 2 — 降低耦合

### QR-P2-01 拆分 QrOrderFlow

- 狀態：**PARTIAL**
- 目前父元件：**src/components/qr-order-flow.tsx，935 行**
- 已接線 bounded modules：orchestration、availability、capacity、cart panel／persistence、checkout、dialog lifecycle、fulfillment、lottery、menu、product、session application／controller，以及 countdown／expiry view
- 測試：**14 files／86 tests PASS**，另有完整 QR browser suites

- [x] session identity、cart recovery、product configuration、cart view、countdown／lottery 已有明確 bounded module。
- [x] product controller 將 3 個 product state 與相關 handler 移出父元件；availability、capacity 與 checkout contract 亦已拆出。
- [x] cart／product dialog 的 scroll lock、focus、Escape、Tab trap 與 desktop breakpoint lifecycle 已抽為 bounded controller。
- [x] session controller result 到 UI/application state 的 STALE、RESUME、error、cart recovery、locale、countdown、availability 與 PREORDER transition 已抽成 pure contract。
- [x] 父元件不再承擔秒級動畫 tick。
- [ ] 父元件約第 236–462 行仍直接負責 session start／application，以及 availability／capacity lifecycle 與 effects；雖已顯著縮小，仍非 composition-only。
- [x] QR／PREORDER／delivery 的 current-tree full E2E 通過。

因此「有拆分」成立；「QrOrderFlow 已完成拆分」不成立。

### QR-P2-02 拆分 StaffOrderBoard

- 狀態：**PARTIAL**
- 目前父元件：**src/components/staff-order-board.tsx，603 行**
- 已接線 bounded modules：batch、cancellation、checkout／checkout lifecycle、fulfillment／time、live、manual pickup、offline、POS、presentation、production／lifecycle、refresh、selectors、time proposal
- 測試：**18 files／85 tests PASS**，另有 characterization 與完整 browser suites

- [x] checkout state 使用 reducer／model，不再由多個平行 setter 管理。
- [x] live snapshot、offline intake、POS configuration、production transition、fulfillment 與 refresh helper 已成獨立契約並由父元件呼叫。
- [x] Realtime／SSE 事件只觸發 authoritative snapshot reload，不直接信任 event payload。
- [x] 取消訂單與人工取餐核對的 state、authoritative reconcile、Escape busy guard、success-only dismiss 與 alertdialog JSX 已抽離。
- [ ] 父元件仍協調 live／offline snapshot、POS config、fulfillment／table checkout／print／pickup、alert timers 與 view-model derivation，尚非 composition-only。
- [x] current-tree Staff／KDS／POS／offline full E2E 通過。

因此「bounded modules 已接線」成立；「StaffOrderBoard 已完成拆分」不成立。

### QR-P2-03 共用 live resource lifecycle

- 狀態：**LOCAL PASS（PublicOrderTracker＋StaffOrderBoard 範圍）**
- 程式：**src/lib/use-live-resource.ts**、**src/components/public-order-tracker.tsx**、**src/components/staff-order-board-live.ts**
- 測試：use-live-resource 7 tests、staff live 5 tests、tracker abort test

- [x] startLiveResource 統一 visibility、online/offline、timer、backoff、cursor dedupe、single-flight、abort 與 teardown。
- [x] Tracker 經 useLiveResource 使用共用引擎。
- [x] Staff Board 經 startStaffOrderLiveLifecycle／adapter 使用同一 startLiveResource 引擎。
- [x] Staff SSE／Realtime adapter 失敗會回到 authoritative polling。
- [x] React hook 與 imperative Staff wrapper 都只是共用 engine 的 bounded adapter；兩者的生命週期契約有 **13 tests PASS**。
- [x] background、雙事件來源、重連與 teardown 已納入 current-tree 測試與完整 browser E2E。

此項 LOCAL PASS 僅限 Tracker＋Staff；若驗收條件擴張為「全系統所有 live／polling consumer 統一」，則需另開後續範圍。

### QR-P2-04 Server-side WorkspaceRouteContext

- 狀態：**LOCAL PASS**
- 程式：**src/proxy.ts**、**src/app/merchant/template.tsx**、**src/lib/workspace-route-context.ts**、MerchantWorkspaceHeader
- 測試：workspace route **18**、merchant template **6**、header **7**，共 **31 tests PASS**；另有 multi-stall browser spec

- [x] route segment 與已授權 workspace 在 server boundary 收斂成 canonical organization／stall context。
- [x] client header 不再以 pathname 或 query 猜安全 scope。
- [x] multi-org route、null scope、invalid outsider 與 unauthenticated failure 有正反 unit。
- [x] UI switcher 只在已授權 workspace 集合中切換，不擴大 RBAC。
- [x] current-tree multi-stall browser test 最終重跑通過。

### QR-P2-05 A/B DB preflight 收斂到相同 trusted RPC

- 狀態：**LOCAL PASS（canonical contract＋independent failure domains）**
- migration：**20260813020000_canonical_public_order_preflight.sql**
- 程式：兩個 Edge function、Circuit B service、trusted RPC repository
- ADR：**docs/adr/ADR-004-public-order-terminal-parity-observability.md**
- 測試：preflight migration／pgTAP、dual contract、Circuit A/B terminal matrix 與 DB replay

- [x] Session／Order 的 QR、ordering mode、schedule、capacity、session 與 idempotent replay preflight 使用 canonical trusted RPC。
- [x] A/B commit-loss session／order replay 已由真實 DB 證明 canonical result 與 audit correlation。
- [x] query budget 已明確量測與 assertion。
- [x] ADR-004 定義的 7 個 canonical DB-preflight terminal cases 已以真實 DB 比對完整 body、status、operation ID、獨立 request ID 與 audit；**7/7 PASS**。
- [x] terminal matrix 7/7 加上 commit-loss replay 2/2，條件式 DB runtime 共 **9/9 PASS**。
- [x] A/B 共用 canonical DB preflight、schema/error/token/replay、abuse behavior、RPC item mapping 與 public response contract；pure contract focused **7 files／47 tests PASS**。
- [x] HTTP／CORS／trusted IP、rate-limit 呼叫、Turnstile runtime、PostgREST／Prisma adapter 與 full-menu enrichment 刻意保持獨立故障域；不以引入 common-mode failure 的 shared async orchestrator 作為完成條件。
- [x] ADR-004 範圍內的 canonical terminal error 已由單一 DB-backed matrix 證明；此結論不外推至所有 network、Turnstile 或 infrastructure errors。

## 7. Phase 3 — 僅 dormant foundations

共同狀態：

- [x] 五個 feature flag code 已加入且 default 全部為 false：
  - **DIGITAL_WAITLIST_FOUNDATION_ENABLED**
  - **ONLINE_ORDER_PAYMENT_ENABLED**
  - **RESERVATION_PREORDER_ENABLED**
  - **DYNAMIC_ORDERING_QR_FOUNDATION_ENABLED**
  - **CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED**
- [x] migration、RLS／trusted RPC、service／contract、ADR 與本機測試基礎已建立。
- [ ] 沒有任何一項可標為 active product complete。
- [ ] 未經產品、provider、營運、安全與治理 Gate，不得把旗標打開。
- [x] Server-side activation lock 會拒絕五個 Phase 3 flag 的 enabled override，且 evaluator 即使讀到舊的 enabled override 也固定回傳 OFF；disabled override 仍可建立。
- [x] PostgreSQL trigger／constraint 會在資料庫邊界拒絕五個旗標的 enabled INSERT／UPDATE；guard 先安裝再清理舊值，避免 migration 期間出現反向 lock window。
- [x] `20260813070000_phase_three_feature_flag_hard_lock.sql` 已納入 additive validator；正規化 digest 為 `2592e2e05074e2d4170e69160c0c05f9ab351c3743d617f10536efc76d901f28`。
- [ ] 尚無真實雙連線 migration race 自動測試；目前證據為 PostgreSQL transactional DDL／lock 行為、fresh reset、pgTAP 與安全審查，故仍維持 dormant／fail closed。

### QR-P3-01 Digital waitlist

- 狀態：**DORMANT FOUNDATION / BLOCKED FOR ACTIVATION**
- migration：**20260813030000_digital_waitlist_foundation.sql**
- 程式：waitlist service／repository／public status、join、seating-session 與 staff transition APIs
- 測試：waitlist pgTAP、static migration、service／route unit

- [x] tenant-scoped entry、position、status transition、hold、token、rate limit、audit 與 seating-session 基礎。
- [x] 入座換發新的 dine-in session，不沿用公開 waitlist token 建單。
- [ ] 顧客／商家正式 UI、通知 provider、no-show／retention 營運規則。
- [ ] sandbox／Staging journey 與營運 owner 驗收。

### QR-P3-02 線上付款與 reconciliation

- 狀態：**DORMANT FOUNDATION / BLOCKED FOR ACTIVATION**
- migration：**20260813040000_online_order_payment_reconciliation.sql**
- 程式：online payment service／repository；僅 **LOCAL_MOCK**
- 測試：payment pgTAP、static migration、webhook／reconciliation unit

- [x] intent、event、reconciliation state machine 與 idempotency foundation。
- [x] LOCAL_MOCK 驗證 authorize／capture／fail／timeout、signature、timestamp、duplicate event、amount／currency。
- [x] LOCAL_MOCK 在 production runtime 強制拒絕。
- [ ] 真實 provider、sandbox credential、merchant UI、refund／fee／settlement 規則。
- [ ] provider webhook endpoint、secret rotation、sandbox replay 與財務對帳驗收。

### QR-P3-03 訂位加預點

- 狀態：**DORMANT FOUNDATION / BLOCKED FOR ACTIVATION**
- migration：**20260813011804_reservation_preorder_foundation.sql**
- 程式：reservation service／repository
- 測試：reservation pgTAP、static migration、service unit

- [x] reservation 與 PREORDER 使用明確關聯與獨立生命週期。
- [x] tenant scope、idempotency、capacity hold、expiry 與 audit foundation。
- [ ] 顧客／商家正式 UI、deposit／refund、late／no-show 與修改取消政策。
- [ ] 跨時區／跨日／容量競爭的完整 active-product E2E。

### QR-P3-04 Dynamic ordering QR

- 狀態：**DORMANT FOUNDATION / BLOCKED FOR ACTIVATION**
- migration：**20260813050000_dynamic_ordering_qr_foundation.sql**
- 程式：dynamic QR credential service／repository
- 測試：dynamic QR pgTAP、static migration、credential service unit

- [x] credential 綁定 tenant、stall、service point、device、expiry、nonce 與 redemption audit。
- [x] replay、device mismatch、revocation／rotation fail-closed contract。
- [ ] static entry QR 與短效 credential 的正式 UI／營運流程。
- [ ] 桌位換桌、截圖分享、結帳失效、斷網 fallback 與既有印刷 QR 相容驗收。

### QR-P3-05 Consent-governed CRM／loyalty

- 狀態：**DORMANT FOUNDATION / BLOCKED FOR ACTIVATION**
- migration：**20260813060000_crm_loyalty_consent_foundation.sql**
- 程式：CRM／loyalty contract、repository
- 測試：CRM pgTAP、static migration、contract unit

- [x] consent purpose／version／source／timestamp／withdrawal、profile 與 points ledger foundation。
- [x] points event、reversal、export、erase、unsubscribe 與 idempotency contract。
- [x] 點餐資料不會因 dormant foundation 自動建立 CRM profile。
- [ ] 經核准的 consent copy、lawful basis、retention、DSAR owner 與行銷退訂流程。
- [ ] 顧客／商家正式 UI、權限與 active-product E2E。

## 8. Current-tree QA 證據

| Gate | 結果 | 證據強度／限制 |
| --- | --- | --- |
| TypeScript | **PASS** | `npm run typecheck`；同一最終可執行 tree |
| ESLint | **PASS** | `npm run lint`；同一最終可執行 tree |
| Unit | **257 files／545 suites；1,610 passed、0 failed、9 conditional pending** | 1,619 total；結果保存於 `artifacts/phase0-3-final-vitest.json` |
| Conditional DB runtime | **2 files／9 tests PASS** | 設定 `PUBLIC_ORDER_DB_REPLAY=1`；terminal matrix 7/7、commit-loss replay 2/2 |
| UI audit | **207 TSX PASS** | `npm run ui:audit` |
| Prisma validator | **PASS** | `npm run prisma:validate` |
| Migration focused suite | **9 files／87 tests PASS** | 本輪 9 個新 migration 的 additive-only validator、foundation／preflight／targeted／hard-lock contracts |
| DB reset | **PASS** | fresh isolated local DB 重播 94 個 migration 與 seed；本輪曾多次由空資料庫重建 |
| DB tests | **56 files／1,365 assertions PASS** | pgTAP；zero failures |
| DB lint | PASS | warning level zero findings |
| Production build | **79/79 pages PASS** | fresh production build |
| Full production E2E | **50 files／112 passed** | 0 failed、0 skipped、0 flaky；約 4.4 分鐘 |
| Dependency audit | **PASS** | `npm audit --omit=dev --audit-level=high`：0 vulnerabilities |
| Diff hygiene | **PASS** | `git diff --check`；僅 Windows CRLF 提示 |
| Security diff | **PASS（完整差異範圍）** | Codex Security scan `3d37896c-5ed7-4b03-a641-135ecb40bdb5`；9/9 surfaces complete、0 finding；snapshot digest `9433bb8a708172ca05acc9ab1a5d8a27bd23727b7a64de43b272c519e1f104e3` |
| Manual browser QA | **PASS** | 390×844：顧客 QR、product／cart／checkout、Tracker、Merchant、Staff、KDS；無橫向 overflow，主要 CTA 可見 |
| Cross-role live order | **PASS** | 本機訂單 `260814-033`：顧客建立 → Staff 確認 → KDS 製作／完成 → Staff 取餐碼 860／LINE Pay 結帳 → Tracker 已完成／已付款／已出餐 |

### Final Local Gate

- [x] fresh typecheck。
- [x] fresh full lint。
- [x] fresh full unit；9 個條件式 DB tests 已另以 DB runtime 9/9 補齊。
- [x] fresh UI audit。
- [x] fresh DB reset／56 files、1,365 pgTAP assertions。
- [x] DB lint zero findings。
- [x] Session／Order commit-loss DB replay 2/2。
- [x] fresh production build：79/79 pages。
- [x] fresh full Playwright：50 files／112 tests，0 failed、0 skipped、0 flaky。
- [x] 390×844 manual browser walkthrough：顧客、Tracker、Staff、KDS、Merchant。
- [x] manual tracked diff secret／PII／test dump scan；未發現 live credential，並保留缺少專用掃描器的限制。
- [x] sealed security diff scan 與 validation；完整 9/9 surfaces、0 reportable finding；Phase 3 五旗標在 TypeScript 與 PostgreSQL 邊界雙重 hard lock。

**Final Local Runtime Gate：PASS。** 這只證明目前本機可執行 tree 的功能與畫面；不代表 Phase 2 全面完成、Phase 3 可啟用，也不取代 CI／Preview、Staging、DR 與 Production Plan Gate。

## 9. Release Gate

| Gate | 狀態 | 必要證據 |
| --- | --- | --- |
| Local runtime | **PASS** | Final Local Gate 已全勾選；文件更新未改變 executable tree |
| Phase scope | **FAIL** | Phase 2 的 P2-01／02 尚非 composition-only；Phase 3 雖已 hard lock，但仍只有 dormant foundation，未具備 active-product provider／UI／治理驗收 |
| Branch integration | **FAIL** | 本機基準 5b263bbac5d8 與 origin/main 97a7c8fab964（落後 38）、origin/staging 9e4e13f827d2（落後 37）已漂移，尚未整合重驗 |
| CI／Preview | **未執行** | 同一 commit 的 required checks、Preview smoke |
| Staging | **未執行** | 與預計發布相同 tree；Staging accounts、DB／Edge／Vercel smoke |
| DR Plan／Apply | **未執行** | 當次 workflow IDs 與成功摘要 |
| Production Plan | **未建立** | immutable plan、revision、schema run、artifact digest |
| Production owner confirmation | **未取得** | 明確綁定當次 immutable Plan；不能沿用一般授權 |
| Production Apply | **未執行／未授權** | Plan-bound confirmation 後才能觸發 |
| Post-deploy | **未執行** | QR／service／DB smoke、rollback observability |

**Overall Release Gate：FAIL CLOSED。** 本輪不得 stage、commit、push 或部署 Production；必須先完成／重新定義 Phase 2 acceptance、保持 Phase 3 dormant hard lock、整合最新 Staging tree，並依序完成 CI／Preview、Staging、DR、immutable Production Plan 與 plan-bound owner confirmation。

## 10. 歷史紀錄（STALE，不代表目前 Gate）

以下只保留追溯用途。它們屬於舊 revision 或舊 dirty tree，不能當作 current-tree release evidence。

| 日期 | 舊 revision／tree | 當時結果 | 目前效力 |
| --- | --- | --- | --- |
| 2026-08-09 | 388ffc04d846 + dirty | 初始 Phase checklist；僅文件檢查 | **STALE** |
| 2026-08-09 | 388ffc04d846 + dirty | L0A／L0B／L1A：typecheck、lint、1,260 unit、195 TSX、build；E2E 11 pass／1 skip，KDS timeout | **STALE；當時亦非全綠** |
| 2026-08-09 | 388ffc04d846 + dirty | P0-07 focused unit 7/7、focused E2E 8/8 | **STALE；只作 characterization 基線** |
| 2026-08-09 | 388ffc04d846 + dirty | L1B DB reset；47 files／1,062 assertions；capacity concurrency 1/1 | **STALE；已由 56／1,365 新證據取代** |
| 2026-08-10 | 2aafd250dde7 + dirty | KDS 3/3、targeted 12/12、production E2E 108/108、unit 1,285、build 79 pages | **STALE；不能代替目前 112-test tree** |
| 2026-08-10 | 2aafd250dde7 + dirty | 390×844 screenshots 與 mobile UI 人工檢查 | **STALE；最新 UI 差異需重做 walkthrough** |

## 11. 更新規則

- 只有所有驗收條件與同一 tree 的必要 runtime 證據完成，主項才能標為 LOCAL PASS。
- 大型父元件只因新增 helper／module 不得標為「完成拆分」；需以責任邊界與父層 remaining orchestration 判定。
- Phase 3 schema／service／mock 完成不得寫成 active feature complete。
- 每次 revision 或 dirty diff 改變後，build、full E2E、manual QA 與 security evidence 必須重新產生。
- Local、CI／Preview、Staging、DR、Production Plan 與 Apply 分開記錄。
- Production Apply 的 owner confirmation 必須引用該次 immutable Plan；本文不構成授權。
- 新 blocker 必須加在原 task 下，不能以「其他改善」隱藏。
