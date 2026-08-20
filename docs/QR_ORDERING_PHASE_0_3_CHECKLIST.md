# StallOrder QR 訂購 Phase 0–3 正式 Checklist

> 本文件只記錄目前工作樹可由程式、資料庫與測試證明的事實。Local、CI／Preview、Staging 與 Production 是四個不同 Gate；任一較早 Gate 通過，都不能代替後續 Gate。

## 1. 文件控制

| 欄位 | 目前值 |
| --- | --- |
| 更新日期 | 2026-08-20 |
| 分支 | **codex/mobile-ui-followups-20260812** |
| 鎖定 executable revision | **e2c012662c731894ce613bd1801077be81296835** |
| Staging 整合基準 | **origin/staging 78ff24e75d680feb1118237b798284e1263047ac** 已整合，且為 executable revision 的 ancestor |
| CodeGraph | 已以目前索引核對 QrOrderFlow、StaffOrderBoard、live resource、WorkspaceRouteContext 與 Circuit A/B 主要路徑；兩個 public entry 均為 14 行 composition boundary |
| Local DB | **BLOCKED**；Docker Desktop 4.80 無法建立 Windows Unix-socket reparse point，`127.0.0.1:54322` 不可用；目前共有 98 個 migration，尚未在鎖定 revision fresh reset |
| CI／Preview | 未執行 |
| Staging | 未執行 |
| Production | 未執行 |

工作樹仍在變動，因此下列狀態分成：

- **LOCAL STATIC PASS**：鎖定 executable revision 的 typecheck、lint、unit／contract、UI audit、Prisma validation 與 production build 已通過。
- **RUNTIME REVALIDATION BLOCKED**：需要 Local Supabase、DB／RLS／migration、Playwright 或人工 browser 證據，但目前因 Docker blocker 無法執行。
- **PARTIAL**：已有實作與部分測試，但尚未滿足完整驗收條件。
- **DORMANT FOUNDATION**：schema、RLS、service／contract、ADR 與測試基礎已完成，但功能旗標保持 OFF，沒有對外啟用。
- **BLOCKED FOR ACTIVATION**：需要 provider、產品、營運、法遵或同意治理決策，不能由本機測試自行解除。

## 2. 不可破壞條件與發布邊界

- [x] 公開 QR 訂購不進入可信裝置的 offline POS queue。
- [x] 保留 RLS／tenant scope、短效單次 session、Turnstile、rate limiting、stall／QR lock、server-side pricing 與 idempotency。
- [x] Transport error 或 5xx response-loss 重試沿用同一 logical operation ID；terminal backend code 才旋轉 session identity。
- [x] Circuit A/B 保留不同 transport 與部署故障域，但以 canonical response、token、error、audit 與 replay contract 校驗。
- [x] migration validator 對兩個既有 Staging migration 僅接受 exact SHA-256 綁定的相容性例外；其餘本輪 migration 依 additive 規則檢查。
- [ ] Staging 前仍須核對 remote migration ledger 與兩個既有 migration 的實際已套用狀態；未取得該證據前不得宣稱 remote-safe。
- [x] Phase 3 五個旗標預設 OFF；未通過 activation Gate 前不得對顧客或商家顯示。
- [ ] 同一鎖定 executable revision 的完整 Local runtime Gate；目前被 Docker／Local Supabase blocker 阻塞。
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
| Phase 0 | **LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED** | P0-01～07 source、unit／contract 與 build 通過；P0-04 blocker matrix 已納入 full Vitest | 鎖定 revision 的 QR、PREORDER、多角色、KDS 與 390×844 browser／人工流程 |
| Phase 1 | **LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED** | P1-01～06 source、migration contract、outbox 與 A/B static／unit 證據通過 | fresh DB reset、pgTAP、DB lint、concurrency、commit-loss replay 與 query budget runtime |
| Phase 2 | **LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED** | QrOrderFlow 與 StaffOrderBoard public entry 均為 14 行 composition-only boundary；P2-03～05 contract 通過 | 鎖定 revision 的 Staff／KDS／POS／offline／multi-stall browser journey |
| Phase 3 | **DORMANT FOUNDATION / BLOCKED FOR ACTIVATION AND RUNTIME** | 五項 schema／RLS／service／ADR／mock 或 contract 基礎存在，五個旗標全部 OFF | 98-migration fresh reset、RLS／RPC runtime、active UI、真實 provider、營運與同意治理、sandbox／Staging 驗證 |

## 4. Phase 0 — 正確性與立即 UX

### QR-P0-01 商家路由攤位解析

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 正式程式入口：**src/proxy.ts** → **src/app/merchant/template.tsx** → **resolveWorkspaceRouteContext** → **MerchantWorkspaceHeader**
- 測試：**src/lib/workspace-route-context.test.ts**、**src/app/merchant/template.test.tsx**、**src/components/merchant-workspace-header.test.ts**、**e2e/multi-stall.spec.ts**

- [x] server request header 帶入 canonical pathname／organization hint。
- [x] template 在 requireWorkspacePage 授權後，從已核准 workspace 集合解析 organization／stall。
- [x] route-owned stall 優先於 stale query organization。
- [x] multi-organization、unscoped null、invalid outsider 與 unauthorized render failure 有測試。
- [ ] 鎖定 revision 的 multi-stall 與完整 browser E2E；已列入 runtime rerun，因 Local Supabase blocker 未執行。

舊文件曾把 client header resolver 寫成正式安全邊界；該路徑已更正。安全 context 的真正注入點是 **src/app/merchant/template.tsx**。

### QR-P0-02 PREORDER 先選時段再顯示可售菜單

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/components/qr-order-flow.tsx**、**src/lib/public-menu.ts**
- 測試：**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/preorder-shared-link-cross-role.spec.ts**、**src/lib/public-menu-preorder.test.ts**

- [x] 未套用時段時不顯示可點菜單。
- [x] 套用後只顯示該時段可售商品。
- [x] 改選但尚未套用時，畫面保留上一個已套用菜單，避免混合狀態。
- [x] 套用新時段會移除失效品項與必選規格。
- [x] 新增真實 DB 的 PREORDER 同單跨顧客、Staff、KDS、Tracker E2E。
- [ ] 跨角色 PREORDER 規格已列入鎖定 revision 的 targeted Playwright 清單，但 runtime 未執行。

### QR-P0-03 Product Bottom Sheet 與 Cart／Checkout 分責

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/components/qr-order-flow.tsx**、**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-independent-cart-lines.spec.ts**

- [x] product configuration 使用行動版 dialog／Bottom Sheet。
- [x] Cart 與 Checkout 使用不同 step，履約及顧客欄位不混入純購物車檢視。
- [x] Escape、focus return、focus trap 與 session expiry dialog 優先序有測試。
- [x] 360 px、390 px 的 dialog／CTA／頁面 overflow assertion 已建立。
- [ ] 鎖定 revision 的 full E2E 與 390×844 bottom-sheet／CTA 人工檢查；因 runtime blocker 未重跑。

### QR-P0-04 送單 CTA 顯示精確缺少條件

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/components/qr-order-flow.tsx** 的 checkoutBlocker；**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/qr-independent-cart-lines.spec.ts**、delivery／capacity QR suites

- [x] 程式能區分 ordering unavailable、空購物車、未套用時段、session 未就緒／逾時、外送電話／地址、必選規格、等候確認及 Turnstile。
- [x] blocker 使用鄰近 Checkout 的 role=status 訊息，不只依賴 disabled button。
- [x] 時段、必選規格、等候確認與 session expiry 有直接 E2E assertion。
- [x] `resolveQrCheckoutBlocker` 單一 matrix 已覆蓋 4 種 unavailable、空購物車、PREORDER 未選時段、session 未就緒／逾時、DELIVERY 欄位、必選規格、等候確認、Turnstile 與 all-clear；focused **47/47 PASS**。
- [x] 修正 session readiness 與 ordering availability 被同一布林值綁定、導致 session-loading blocker 不可達的問題。
- [ ] 鎖定 revision 的 full E2E 最終重跑；因 runtime blocker 未執行。

### QR-P0-05 Tracker 顯示現在、下一步與協助入口

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/components/public-order-tracker.tsx**、**src/components/line-notification-controls.tsx**
- 測試：**src/components/public-order-tracker.test.tsx**、**e2e/phase0-3-role-mobile-journey.spec.ts**

- [x] 五階段 stepper、目前狀態與下一步。
- [x] 最後更新、更新中、離線與連線狀態。
- [x] 所有訂單皆可看到安全協助／重新整理／再次點餐入口。
- [x] 未核准的私人電話、LINE 或外部連結不會被揭露。
- [ ] 鎖定 revision 的跨角色 mobile journey 與人工 Tracker walkthrough；因 runtime blocker 未重跑。

### QR-P0-06 Hidden／offline 停止 polling 並取消請求

- 狀態：**LOCAL STATIC PASS**
- 程式：**src/lib/use-live-resource.ts**、**src/components/public-order-tracker.tsx**、**src/lib/public-order-client.ts**
- 測試：**src/lib/use-live-resource.test.ts**、**src/components/public-order-tracker.abort.test.tsx**、**src/components/public-order-tracker.test.tsx**

- [x] hidden 或 offline 會停止 timer 與 adapter。
- [x] 回到 visible／online 立即 refresh，再恢復單一 interval。
- [x] refresh 合併、cursor dedupe 與 stale response 防護。
- [x] AbortSignal 從 tracker load 傳入 public-order client，並貫穿 Circuit A/B timeout merge 到實際 fetch。
- [x] abort 不被誤判為 infrastructure failure，也不會因此啟動 Circuit fallback。

### QR-P0-07 秒級倒數與抽獎動畫移出 QrOrderFlow

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/components/qr-session-countdown.tsx**、**src/components/qr-session-expiry-dialog.tsx**、**src/components/qr-lottery-dialogs.tsx**、**src/lib/session-countdown.ts**、**src/lib/qr-lottery.ts**
- 測試：**src/lib/session-countdown.test.ts**、**src/lib/qr-lottery.test.ts**、QR lottery／cart E2E

- [x] countdown 與 expiry callback 在 bounded hook／view。
- [x] lottery animation／dialogs 不再由父元件每 tick 全體 rerender。
- [x] reduced-motion、抽獎上限、失敗復原與 dialog focus 有測試。
- [ ] 鎖定 revision 的 lottery／cart browser E2E；因 runtime blocker 未重跑。

## 5. Phase 1 — 低風險效能與可靠性

### QR-P1-01 includeMenu:false Session query budget

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**supabase/functions/create-order-session/index.ts**
- 測試：**supabase/functions/create-order-session/query-plan.test.ts**、**e2e/qr-local-smoke.spec.ts**

- [x] 有 SSR menu 時，輕量 refresh 使用 includeMenu:false。
- [x] 非桌位 lightweight Session 的 Circuit A DB query budget 是 **4**，不是舊文件的 6。
- [x] 回應仍有 session、capacity 與必要 context。
- [ ] 鎖定 revision 的真實 DB query budget；因 Local Supabase blocker 未重跑。

### QR-P1-02 實體 QR SSR 跳過無用 PREORDER slots

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/app/q/[qrToken]/page.tsx**、**src/lib/public-menu.ts**
- 測試：page unit、public-menu PREORDER unit、QR PREORDER E2E

- [x] 實體 QR SSR 不查 shared-link PREORDER 專用 slots。
- [x] shared-link PREORDER 仍取得 slots。
- [x] menu、ordering mode 與 cache key 不互相污染。
- [ ] 鎖定 revision 的實體 QR／shared-link PREORDER browser journey；因 runtime blocker 未重跑。

### QR-P1-03 容量狀態未改變時不重算

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- migration：**20260809161446_dedupe_stall_capacity_refresh.sql**
- 測試：capacity migration／pgTAP、**e2e/capacity-refresh-concurrency.spec.ts**

- [x] static migration／contract tests 覆蓋 unchanged snapshot 與 changed-state 後置計算分支。
- [ ] 鎖定 revision 的 warning、auto-pause／resume、manual pause 與 snapshot 等價性 pgTAP。
- [ ] 鎖定 revision 的真正多連線 lock order、同攤位序列化與 no-deadlock 測試。

### QR-P1-04 全域 schedule processor 改為 targeted catch-up

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- migration：**20260813010000_target_stall_schedule_catch_up.sql**
- 測試：targeted migration／pgTAP、**e2e/targeted-stall-schedule-concurrency.spec.ts**

- [x] 新增 stall-scoped trusted schedule catch-up RPC。
- [x] 公開 Session／Order hot path 只處理目前 stall。
- [x] 維運路徑保留全域 catch-up。
- [x] static migration／contract tests 覆蓋 stall-scoped RPC、hot path 與維運路徑。
- [ ] 鎖定 revision 的兩 stall isolation、lock order 與 no-deadlock DB／concurrency 證據。

### QR-P1-05 Circuit A/B golden parity 與共同 operation ID

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**supabase/functions/_shared/public-order-replay.ts**、兩個 Edge function、**src/server/public-order/circuit-b-service.ts**、**src/lib/public-order-client.ts**
- 測試：dual contract、replay／query-plan unit、**src/server/public-order/circuit-ab-db-replay.test.ts**

- [x] operationId 與 sessionRequestId／order idempotency key 分責。
- [x] fallback、retry、response 與 audit 保持同一 operationId。
- [x] timestamp、token 與 body 使用 canonical serialization。
- [ ] 鎖定 revision 的 Local PostgreSQL Session／Order commit-loss replay 2/2。
- [ ] 鎖定 revision 的 canonical body、token、code、time、operationId、audit correlation 與 query budget runtime evidence。

### QR-P1-06 Outbox consumer、重試與 lag 可觀測性

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- ADR：**docs/OUTBOX_DISPATCH_ADR.md**
- 程式：**20260813001731_p1_outbox_dispatch.sql**、**src/server/outbox/outbox-dispatcher.ts**、cron route
- 測試：outbox pgTAP、dispatcher unit、failure injection、cron route unit

- [x] notification outbox 使用 claim／lease、bounded retry、dead-letter outcome 與可重入 consumer。
- [x] domain outbox 在沒有正式 event contract 時保持 dormant；producer 寫入 CANCELLED，未知 pending event fail closed。
- [x] 沒有 drop／replace 已發布 status constraint；lease／retry 以 additive columns 與 RPC outcome 表示。
- [x] pending age、queue depth、dead-letter telemetry 不含 PII／secret。
- [x] crash-after-send、duplicate delivery 與 provider timeout 的 unit／static contract 通過。
- [ ] 鎖定 revision 的 outbox pgTAP、claim／lease、retry 與 lag runtime 證據。

## 6. Phase 2 — 降低耦合

### QR-P2-01 拆分 QrOrderFlow

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- public entry：**src/components/qr-order-flow.tsx，14 行**
- controller：**src/components/qr-order-flow-controller.ts，753 行**
- presentation：**src/components/qr-order-flow-presentation.tsx，420 行**
- 邊界測試：**src/components/qr-order-flow-composition.test.ts**

- [x] public entry 只保留 props type、`useQrOrderFlowController(props)` 與 `QrOrderFlowPresentation` 接線。
- [x] session application、availability、capacity、cart、checkout、fulfillment、lottery 與 dialog lifecycle 由 controller／bounded modules 負責。
- [x] customer-facing render tree 由 presentation 負責，父層不再持有 effects 或秒級 animation tick。
- [x] composition regression test 會拒絕 session start、`useEffect` 或 UI 邏輯回流 public entry。
- [ ] QR／PREORDER／delivery 的鎖定 revision browser E2E；因 runtime blocker 未重跑。

composition-only public boundary 的 Phase 2 acceptance 已滿足；controller 與 presentation 仍是大型內部模組，後續若要再拆必須另立範圍，不能在本 Gate 暗中擴張。

### QR-P2-02 拆分 StaffOrderBoard

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- public entry：**src/components/staff-order-board.tsx，14 行**
- controller：**src/components/staff-order-board-controller.ts，821 行**
- presentation：**src/components/staff-order-board-presentation.tsx，812 行**
- 邊界測試：**src/components/staff-order-board-presentation.characterization.test.ts**

- [x] public entry 只保留 props type、`useStaffOrderBoardController(props)` 與 `StaffOrderBoardPresentation` 接線。
- [x] live／offline snapshot、POS、production、fulfillment、checkout、print、pickup、cancellation 與 refresh orchestration 由 controller／bounded modules 負責。
- [x] ticket、toolbar、mobile compact layout 與 dialog render tree 由 presentation 負責。
- [x] Realtime／SSE 事件仍只觸發 authoritative snapshot reload，不直接信任 event payload。
- [x] characterization test 鎖定 composition boundary，避免 orchestration 回流 public entry。
- [ ] Staff／KDS／POS／offline 的鎖定 revision browser E2E；因 runtime blocker 未重跑。

composition-only public boundary 的 Phase 2 acceptance 已滿足；controller 與 presentation 的再細分屬後續維護範圍，不是本次 runtime Gate 的替代證據。

### QR-P2-03 共用 live resource lifecycle

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED（PublicOrderTracker＋StaffOrderBoard 範圍）**
- 程式：**src/lib/use-live-resource.ts**、**src/components/public-order-tracker.tsx**、**src/components/staff-order-board-live.ts**
- 測試：use-live-resource 7 tests、staff live 5 tests、tracker abort test

- [x] startLiveResource 統一 visibility、online/offline、timer、backoff、cursor dedupe、single-flight、abort 與 teardown。
- [x] Tracker 經 useLiveResource 使用共用引擎。
- [x] Staff Board 經 startStaffOrderLiveLifecycle／adapter 使用同一 startLiveResource 引擎。
- [x] Staff SSE／Realtime adapter 失敗會回到 authoritative polling。
- [x] React hook 與 imperative Staff wrapper 都只是共用 engine 的 bounded adapter；兩者的生命週期契約有 **13 tests PASS**。
- [x] background、雙事件來源、重連與 teardown 已納入 unit／contract tests。
- [ ] 鎖定 revision 的雙事件來源、重連與 teardown browser E2E；因 runtime blocker 未重跑。

此項 static acceptance 僅限 Tracker＋Staff；若驗收條件擴張為「全系統所有 live／polling consumer 統一」，則需另開後續範圍。

### QR-P2-04 Server-side WorkspaceRouteContext

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED**
- 程式：**src/proxy.ts**、**src/app/merchant/template.tsx**、**src/lib/workspace-route-context.ts**、MerchantWorkspaceHeader
- 測試：workspace route **18**、merchant template **6**、header **7**，共 **31 tests PASS**；另有 multi-stall browser spec

- [x] route segment 與已授權 workspace 在 server boundary 收斂成 canonical organization／stall context。
- [x] client header 不再以 pathname 或 query 猜安全 scope。
- [x] multi-org route、null scope、invalid outsider 與 unauthenticated failure 有正反 unit。
- [x] UI switcher 只在已授權 workspace 集合中切換，不擴大 RBAC。
- [ ] 鎖定 revision 的 multi-stall browser test；因 runtime blocker 未重跑。

### QR-P2-05 A/B DB preflight 收斂到相同 trusted RPC

- 狀態：**LOCAL STATIC PASS / RUNTIME REVALIDATION BLOCKED（canonical contract＋independent failure domains）**
- migration：**20260813020000_canonical_public_order_preflight.sql**
- 程式：兩個 Edge function、Circuit B service、trusted RPC repository
- ADR：**docs/adr/ADR-004-public-order-terminal-parity-observability.md**
- 測試：preflight migration／pgTAP、dual contract、Circuit A/B terminal matrix 與 DB replay

- [x] Session／Order 的 QR、ordering mode、schedule、capacity、session 與 idempotent replay preflight 使用 canonical trusted RPC。
- [x] pure contract 測試覆蓋 canonical result、audit correlation、query assertion 與 ADR-004 terminal mapping。
- [ ] 鎖定 revision 的 A/B commit-loss session／order replay、query budget 與 7 個 DB-preflight terminal cases runtime。
- [x] A/B 共用 canonical DB preflight、schema/error/token/replay、abuse behavior、RPC item mapping 與 public response contract；pure contract focused **7 files／47 tests PASS**。
- [x] HTTP／CORS／trusted IP、rate-limit 呼叫、Turnstile runtime、PostgREST／Prisma adapter 與 full-menu enrichment 刻意保持獨立故障域；不以引入 common-mode failure 的 shared async orchestrator 作為完成條件。
- [ ] ADR-004 範圍內的單一 DB-backed terminal matrix；過往 revision 證據已列為 STALE，不能替代本次 runtime rerun。

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
- [ ] 鎖定 revision 尚未執行 98-migration fresh reset、Phase 3 pgTAP、RLS／RPC 與真實雙連線 migration race；目前只有 static／unit 與安全審查證據，故維持 dormant／fail closed。

以下各項列出的 pgTAP 檔案代表測試資產已存在，不代表鎖定 revision 已在 live PostgreSQL 執行；runtime 結果統一以第 8 節為準。

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
| Revision lock | **PASS** | executable revision `e2c012662c731894ce613bd1801077be81296835`；已整合 `origin/staging@78ff24e75d680feb1118237b798284e1263047ac` |
| TypeScript | **PASS** | `npm run typecheck` |
| ESLint | **PASS** | `npm run lint` |
| Unit／contract | **PASS** | 297 files passed、2 skipped；1,851 tests passed、9 skipped，0 failed（1,860 total） |
| UI audit | **PASS** | 220 TSX files；`npm run ui:audit` |
| Prisma validator | **PASS** | `npm run prisma:validate` |
| Migration focused suite | **PASS** | 7 files／79 tests；含 Staging merge resolution、transaction wrapper、collision audit、scheduler body 與 exact migration digest checks |
| Clean production guard | **PASS** | clean clone：1,488 tracked files、98 migrations；`node scripts/production-readiness.mjs` 通過，並保留一項已人工審查的歷史 data-copy warning |
| DB health | **BLOCKED** | Docker Desktop 4.80 重複在 `dockerInference`／`docker-secrets-engine` socket reparse point 初始化失敗；`127.0.0.1:54322` 不可用 |
| DB reset | **未執行／BLOCKED** | 鎖定 revision 尚未 fresh reset 98 個 migrations |
| DB tests／RLS／RPC | **未執行／BLOCKED** | pgTAP、A/B DB replay、concurrency、outbox 與 Phase 3 hard-lock runtime 尚未重驗 |
| DB lint | **未執行／BLOCKED** | 等 Local Supabase 恢復後執行 |
| Production build | **79/79 pages PASS** | fresh production build |
| Playwright discovery | **PASS（list only）** | 8 個 targeted tests 可載入：KDS 3、Phase role journey 1、PREORDER shared-role 1、QR local smoke 3；未啟動 runtime execution |
| Targeted／full E2E | **未執行／BLOCKED** | KDS、QR、PREORDER、多角色、POS／offline 與 mobile journeys 需要 live DB |
| Dependency audit | **PASS** | `npm audit --audit-level=moderate`：0 vulnerabilities |
| Diff hygiene | **PASS** | `git diff --check origin/staging..e2c012662c731894ce613bd1801077be81296835` |
| Dangerous-pattern review | **PASS** | 新增差異中的 dynamic code、unsafe HTML、unsafe raw SQL、weak random、CSRF skip 均為 0 |
| Security diff | **0 findings／coverage partial** | sealed scan `e6cb5e3d-ed87-4ebb-a7ba-d9cacc8c78bc`；159/159 review items；snapshot `9b54b59f178bde34796687910cab8745a605851d2e5be5d1b3398d36f23d2b20`；live DB／browser surface 為 needs-follow-up |
| Manual browser QA | **未執行／BLOCKED** | 顧客、商家、店員、KDS 與 360／390 px 單頁資訊密度需在 runtime 恢復後重做 |
| Cross-role live order | **未執行／BLOCKED** | 不沿用舊 revision 的訂單或截圖作為 current-tree 證據 |

### Final Local Gate

- [x] fresh typecheck。
- [x] fresh full lint。
- [x] fresh full unit／contract：1,851 passed、9 conditional skipped、0 failed。
- [x] fresh UI audit。
- [x] fresh Prisma validation、migration focused suite 與 clean production guard。
- [x] fresh production build：79/79 pages。
- [x] dependency audit、diff hygiene 與 dangerous-pattern review。
- [x] sealed security diff scan；159/159 review items、0 reportable finding。
- [ ] Docker／Local Supabase health。
- [ ] fresh 98-migration reset、pgTAP、DB lint、RLS／RPC、concurrency 與 A/B commit-loss replay。
- [ ] KDS 3、Phase role journey、PREORDER shared-role 與 QR local smoke targeted E2E。
- [ ] fresh full Playwright；0 failed、0 unexpected skip、0 flaky。
- [ ] 360／390 px manual browser walkthrough：顧客、Tracker、Staff、KDS、Merchant；驗證單頁資訊、CTA、overflow、focus 與 loading／empty／error 狀態。
- [ ] security coverage 的 live DB／browser needs-follow-up 關閉。

**Final Local Runtime Gate：FAIL／RUNTIME BLOCKED。** 靜態程式、unit／contract、build 與 diff security 已通過；但 DB、KDS、多角色、QR／PREORDER、手機畫面與人工流程尚未在鎖定 revision 驗證，因此不能 push、部署或宣稱 Phase 0–3 已完成 QA。

## 9. Release Gate

| Gate | 狀態 | 必要證據 |
| --- | --- | --- |
| Local static | **PASS** | executable revision `e2c012662c731894ce613bd1801077be81296835` 的 typecheck、lint、unit／contract、UI audit、Prisma validation、build、audit 與 static migration checks 通過 |
| Local DB／runtime | **FAIL／BLOCKED** | Docker／Supabase health、98-migration reset、DB tests／lint、targeted＋full E2E 與人工 mobile QA 未完成 |
| Phase scope | **STATIC ACCEPTANCE PASS** | Phase 0–2 source acceptance 已滿足；Phase 3 僅按既定範圍完成 dormant foundations 並保持五旗標 hard OFF，不代表 active product complete |
| Branch integration | **PASS** | `origin/staging@78ff24e75d680feb1118237b798284e1263047ac` 已由 merge commit `e2c012662c731894ce613bd1801077be81296835` 整合，且為目前 executable revision 的 ancestor |
| Security review | **PASS（static）／FOLLOW-UP** | 0 findings；coverage partial，必須在 live DB／browser runtime 後關閉 needs-follow-up |
| CI／Preview | **未執行** | 同一 commit 的 required checks、Preview smoke |
| Staging | **未執行** | 與預計發布相同 tree；Staging accounts、DB／Edge／Vercel smoke |
| DR Plan／Apply | **未執行** | 當次 workflow IDs 與成功摘要 |
| Production Plan | **未建立** | immutable plan、revision、schema run、artifact digest |
| Production owner confirmation | **未取得** | 明確綁定當次 immutable Plan；不能沿用一般授權 |
| Production Apply | **未執行／未授權** | Plan-bound confirmation 後才能觸發 |
| Post-deploy | **未執行** | QR／service／DB smoke、rollback observability |

**Overall Release Gate：FAIL CLOSED。** 可以保留本機 commit 供測試，但不得 push 或部署。下一個可執行順序是：修復 Docker／Local Supabase → DB reset／test／lint → targeted E2E → full E2E → 360／390 px 多角色人工 QA → 若 executable tree 有變更則重跑 static／security → CI／Preview → Staging／DR → immutable Production Plan → plan-bound owner confirmation → Production Apply。

## 10. 歷史紀錄（STALE，不代表目前 Gate）

以下只保留追溯用途。它們屬於舊 revision 或舊 dirty tree，不能當作 current-tree release evidence。

| 日期 | 舊 revision／tree | 當時結果 | 目前效力 |
| --- | --- | --- | --- |
| 2026-08-09 | 388ffc04d846 + dirty | 初始 Phase checklist；僅文件檢查 | **STALE** |
| 2026-08-09 | 388ffc04d846 + dirty | L0A／L0B／L1A：typecheck、lint、1,260 unit、195 TSX、build；E2E 11 pass／1 skip，KDS timeout | **STALE；當時亦非全綠** |
| 2026-08-09 | 388ffc04d846 + dirty | P0-07 focused unit 7/7、focused E2E 8/8 | **STALE；只作 characterization 基線** |
| 2026-08-09 | 388ffc04d846 + dirty | L1B DB reset；47 files／1,062 assertions；capacity concurrency 1/1 | **STALE；只保留歷史追溯** |
| 2026-08-10 | 2aafd250dde7 + dirty | KDS 3/3、targeted 12/12、production E2E 108/108、unit 1,285、build 79 pages | **STALE；不能代替目前鎖定 executable revision** |
| 2026-08-10 | 2aafd250dde7 + dirty | 390×844 screenshots 與 mobile UI 人工檢查 | **STALE；最新 UI 差異需重做 walkthrough** |
| 2026-08-14 | 5b263bbac5d8 + dirty | DB reset／pgTAP、112 E2E、390×844 多角色人工流程與舊 security scan 曾通過 | **STALE；未包含 origin/staging@78ff24e 與 e2c0126 的最終 executable tree** |

## 11. 更新規則

- 只有所有驗收條件與同一 executable tree 的必要 runtime 證據完成，主項才能標為 **LOCAL RUNTIME PASS**；unit／static 證據只能標為 **LOCAL STATIC PASS**。
- 大型父元件只因新增 helper／module 不得標為「完成拆分」；需以責任邊界與父層 remaining orchestration 判定。
- Phase 3 schema／service／mock 完成不得寫成 active feature complete。
- 每次 executable revision 或 tracked implementation diff 改變後，build、full E2E、manual QA 與 security evidence 必須重新產生；純 checklist 文件 commit 不改變已鎖定 executable evidence。
- security scan 的 0 finding 不能取代其 coverage 中明列的 deferred runtime surface。
- Local、CI／Preview、Staging、DR、Production Plan 與 Apply 分開記錄。
- Production Apply 的 owner confirmation 必須引用該次 immutable Plan；本文不構成授權。
- 新 blocker 必須加在原 task 下，不能以「其他改善」隱藏。
