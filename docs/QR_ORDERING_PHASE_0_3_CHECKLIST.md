# StallOrder QR 訂購 Phase 0–3 正式 Checklist

> 本文件只記錄目前工作樹可由程式、資料庫與測試證明的事實。Local、CI／Preview、Staging 與 Production 是四個不同 Gate；任一較早 Gate 通過，都不能代替後續 Gate。

## 1. 文件控制

| 欄位 | 目前值 |
| --- | --- |
| 更新日期 | 2026-08-20 |
| 分支 | **codex/mobile-ui-followups-20260812** |
| 本機實測 executable snapshot | **8a1cf624cf7f19ceea7252dbf12b7b363b5c5974**；4 個必要程式／測試修正已獨立 commit，目前 tracked 差異僅為本 checklist，既有 untracked 本機資料與 QA artifacts 明確排除於 executable snapshot |
| Staging 整合基準 | **origin/staging@ba378d9eea57e0328bf9c45d975aadde9a766853** 已合併，且為目前 HEAD ancestor；合併後 static、DB 與完整 browser QA 已重驗 |
| CodeGraph | 已以目前索引核對 QrOrderFlow、StaffOrderBoard、live resource、WorkspaceRouteContext、Circuit A/B 與 additive migration Plan／Apply 主要路徑；兩個 public entry 均為 14 行 composition boundary，ALTER TABLE positive allowlist 位於 Plan digest 之前且保留 provenance checks |
| Local DB | **PASS**；Docker Desktop **4.87.0.236836** 恢復後，隔離 L1B Supabase runtime 健康；98 個 migration fresh reset／hash 核對、58 個 pgTAP 檔／1,373 assertions 與 DB lint 通過 |
| CI／Preview | 未執行 |
| Staging | 未執行 |
| Production | 未執行 |

工作樹含既有 untracked 本機資料與本 checklist 的文件差異，因此下列狀態只以上述已 commit 的 executable snapshot 為界；後續純 checklist commit 不改變 executable evidence：

- **LOCAL STATIC PASS**：上述 executable snapshot 的 typecheck、lint、unit／contract、UI audit、Prisma validation 與 production build 已通過。
- **LOCAL RUNTIME PASS**：同一 executable snapshot 已通過 Local Supabase、DB／RLS／migration、Playwright 與 mobile visual QA。
- **PARTIAL**：已有實作與部分測試，但尚未滿足完整驗收條件。
- **DORMANT FOUNDATION**：schema、RLS、service／contract、ADR 與測試基礎已完成，但功能旗標保持 OFF，沒有對外啟用。
- **BLOCKED FOR ACTIVATION**：需要 provider、產品、營運、法遵或同意治理決策，不能由本機測試自行解除。

## 2. 不可破壞條件與發布邊界

- [x] 公開 QR 訂購不進入可信裝置的 offline POS queue。
- [x] 保留 RLS／tenant scope、短效單次 session、Turnstile、rate limiting、stall／QR lock、server-side pricing 與 idempotency。
- [x] Transport error 或 5xx response-loss 重試沿用同一 logical operation ID；terminal backend code 才旋轉 session identity。
- [x] Circuit A/B 保留不同 transport 與部署故障域，但以 canonical response、token、error、audit 與 replay contract 校驗。
- [x] migration validator 對兩個既有 Staging migration 僅接受 exact SHA-256 綁定的相容性例外；其餘 migration 的 `ALTER TABLE` action 逐項比對 positive allowlist，unknown syntax 以 `ALTER_TABLE_ACTION_FORBIDDEN` fail closed，並保留 replacement／OWNER／RLS／trigger provenance checks。
- [ ] Staging 前仍須核對 remote migration ledger 與兩個既有 migration 的實際已套用狀態；未取得該證據前不得宣稱 remote-safe。
- [x] Phase 3 五個旗標預設 OFF；未通過 activation Gate 前不得對顧客或商家顯示。
- [x] 同一 executable snapshot 的完整 Local runtime Gate；Docker／Local Supabase blocker 已排除。
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
| Phase 0 | **LOCAL RUNTIME PASS** | P0-01～07 source、unit／contract、QR／PREORDER、多角色、KDS、390×844 跨角色與 360×740 顧客入口實測通過 | CI／Preview、遠端 Staging；尚無鎖定流量的 latency benchmark |
| Phase 1 | **LOCAL RUNTIME PASS** | 98-migration reset、58 個 pgTAP／1,373 assertions、DB lint、query budget、concurrency、outbox、commit-loss replay 與 A/B terminal matrix 通過 | CI／Preview、遠端 Staging migration ledger／lint 與負載量測 |
| Phase 2 | **LOCAL RUNTIME PASS** | QrOrderFlow 與 StaffOrderBoard public entry 均為 14 行 composition-only boundary；Staff／KDS／POS／offline／multi-stall browser journey 通過 | controller／presentation 仍大型，但屬後續維護範圍；遠端 Staging 尚待驗證 |
| Phase 3 | **DORMANT FOUNDATION / LOCAL DB RUNTIME PASS / BLOCKED FOR ACTIVATION** | 五項 schema／RLS／service／ADR／mock 或 contract 基礎已通過 fresh reset 與 pgTAP，五個旗標保持 hard OFF | 真實 migration-window 雙連線 race 尚無獨立自動化證據；active UI、真實 provider、營運／同意治理、sandbox／Staging 激活驗證 |

## 4. Phase 0 — 正確性與立即 UX

### QR-P0-01 商家路由攤位解析

- 狀態：**LOCAL RUNTIME PASS**
- 正式程式入口：**src/proxy.ts** → **src/app/merchant/template.tsx** → **resolveWorkspaceRouteContext** → **MerchantWorkspaceHeader**
- 測試：**src/lib/workspace-route-context.test.ts**、**src/app/merchant/template.test.tsx**、**src/components/merchant-workspace-header.test.ts**、**e2e/multi-stall.spec.ts**

- [x] server request header 帶入 canonical pathname／organization hint。
- [x] template 在 requireWorkspacePage 授權後，從已核准 workspace 集合解析 organization／stall。
- [x] route-owned stall 優先於 stale query organization。
- [x] multi-organization、unscoped null、invalid outsider 與 unauthorized render failure 有測試。
- [x] executable snapshot 的 multi-stall 與完整 browser E2E 已通過。

舊文件曾把 client header resolver 寫成正式安全邊界；該路徑已更正。安全 context 的真正注入點是 **src/app/merchant/template.tsx**。

### QR-P0-02 PREORDER 先選時段再顯示可售菜單

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/components/qr-order-flow.tsx**、**src/lib/public-menu.ts**
- 測試：**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/preorder-shared-link-cross-role.spec.ts**、**src/lib/public-menu-preorder.test.ts**

- [x] 未套用時段時不顯示可點菜單。
- [x] 套用後只顯示該時段可售商品。
- [x] 改選但尚未套用時，畫面保留上一個已套用菜單，避免混合狀態。
- [x] 套用新時段會移除失效品項與必選規格。
- [x] 新增真實 DB 的 PREORDER 同單跨顧客、Staff、KDS、Tracker E2E。
- [x] 跨角色 PREORDER targeted Playwright 與 full E2E 已通過。

### QR-P0-03 Product Bottom Sheet 與 Cart／Checkout 分責

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/components/qr-order-flow.tsx**、**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-independent-cart-lines.spec.ts**

- [x] product configuration 使用行動版 dialog／Bottom Sheet。
- [x] Cart 與 Checkout 使用不同 step，履約及顧客欄位不混入純購物車檢視。
- [x] Escape、focus return、focus trap 與 session expiry dialog 優先序有測試。
- [x] 360 px、390 px 的 dialog／CTA／頁面 overflow assertion 已建立。
- [x] executable snapshot 的 full E2E 與 390×844 bottom-sheet／CTA trace 畫面檢查已通過。

### QR-P0-04 送單 CTA 顯示精確缺少條件

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/components/qr-order-flow.tsx** 的 checkoutBlocker；**src/components/qr-order-cart-panel.tsx**
- 測試：**src/components/qr-order-cart-panel.test.tsx**、**e2e/qr-preorder-menu-availability.spec.ts**、**e2e/qr-independent-cart-lines.spec.ts**、delivery／capacity QR suites

- [x] 程式能區分 ordering unavailable、空購物車、未套用時段、session 未就緒／逾時、外送電話／地址、必選規格、等候確認及 Turnstile。
- [x] blocker 使用鄰近 Checkout 的 role=status 訊息，不只依賴 disabled button。
- [x] 時段、必選規格、等候確認與 session expiry 有直接 E2E assertion。
- [x] `resolveQrCheckoutBlocker` 單一 matrix 已覆蓋 4 種 unavailable、空購物車、PREORDER 未選時段、session 未就緒／逾時、DELIVERY 欄位、必選規格、等候確認、Turnstile 與 all-clear；focused **47/47 PASS**。
- [x] 修正 session readiness 與 ordering availability 被同一布林值綁定、導致 session-loading blocker 不可達的問題。
- [x] executable snapshot 的 full E2E 最終重跑：**112 passed、1 expected skip、0 failed**。

### QR-P0-05 Tracker 顯示現在、下一步與協助入口

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/components/public-order-tracker.tsx**、**src/components/line-notification-controls.tsx**
- 測試：**src/components/public-order-tracker.test.tsx**、**e2e/phase0-3-role-mobile-journey.spec.ts**

- [x] 五階段 stepper、目前狀態與下一步。
- [x] 最後更新、更新中、離線與連線狀態。
- [x] 所有訂單皆可看到安全協助／重新整理／再次點餐入口。
- [x] 未核准的私人電話、LINE 或外部連結不會被揭露。
- [x] executable snapshot 的 390×844 跨角色 mobile journey／Tracker trace 通過；waiting 與 preparing 畫面、狀態、下一步與協助入口均可見。

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

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/components/qr-session-countdown.tsx**、**src/components/qr-session-expiry-dialog.tsx**、**src/components/qr-lottery-dialogs.tsx**、**src/lib/session-countdown.ts**、**src/lib/qr-lottery.ts**
- 測試：**src/lib/session-countdown.test.ts**、**src/lib/qr-lottery.test.ts**、QR lottery／cart E2E

- [x] countdown 與 expiry callback 在 bounded hook／view。
- [x] lottery animation／dialogs 不再由父元件每 tick 全體 rerender。
- [x] reduced-motion、抽獎上限、失敗復原與 dialog focus 有測試。
- [x] executable snapshot 的 lottery／cart browser E2E 已通過。

## 5. Phase 1 — 低風險效能與可靠性

### QR-P1-01 includeMenu:false Session query budget

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**supabase/functions/create-order-session/index.ts**
- 測試：**supabase/functions/create-order-session/query-plan.test.ts**、**e2e/qr-local-smoke.spec.ts**

- [x] 有 SSR menu 時，輕量 refresh 使用 includeMenu:false。
- [x] 非桌位 lightweight Session 的 Circuit A DB query budget 是 **4**，不是舊文件的 6。
- [x] 回應仍有 session、capacity 與必要 context。
- [x] executable snapshot 的 Local PostgreSQL／Edge query budget runtime 已通過。

### QR-P1-02 實體 QR SSR 跳過無用 PREORDER slots

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/app/q/[qrToken]/page.tsx**、**src/lib/public-menu.ts**
- 測試：page unit、public-menu PREORDER unit、QR PREORDER E2E

- [x] 實體 QR SSR 不查 shared-link PREORDER 專用 slots。
- [x] shared-link PREORDER 仍取得 slots。
- [x] menu、ordering mode 與 cache key 不互相污染。
- [x] executable snapshot 的實體 QR／shared-link PREORDER browser journey 已通過。

### QR-P1-03 容量狀態未改變時不重算

- 狀態：**LOCAL RUNTIME PASS**
- migration：**20260809161446_dedupe_stall_capacity_refresh.sql**
- 測試：capacity migration／pgTAP、**e2e/capacity-refresh-concurrency.spec.ts**

- [x] static migration／contract tests 覆蓋 unchanged snapshot 與 changed-state 後置計算分支。
- [x] executable snapshot 的 warning、auto-pause／resume、manual pause 與 snapshot 等價性 pgTAP 已通過。
- [x] capacity-refresh-concurrency 的多連線 lock order、同攤位序列化與 no-deadlock 測試已通過。

### QR-P1-04 全域 schedule processor 改為 targeted catch-up

- 狀態：**LOCAL RUNTIME PASS**
- migration：**20260813010000_target_stall_schedule_catch_up.sql**
- 測試：targeted migration／pgTAP、**e2e/targeted-stall-schedule-concurrency.spec.ts**

- [x] 新增 stall-scoped trusted schedule catch-up RPC。
- [x] 公開 Session／Order hot path 只處理目前 stall。
- [x] 維運路徑保留全域 catch-up。
- [x] static migration／contract tests 覆蓋 stall-scoped RPC、hot path 與維運路徑。
- [x] targeted-stall-schedule-concurrency 的兩 stall isolation、lock order 與 no-deadlock DB 證據已通過。

### QR-P1-05 Circuit A/B golden parity 與共同 operation ID

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**supabase/functions/_shared/public-order-replay.ts**、兩個 Edge function、**src/server/public-order/circuit-b-service.ts**、**src/lib/public-order-client.ts**
- 測試：dual contract、replay／query-plan unit、**src/server/public-order/circuit-ab-db-replay.test.ts**

- [x] operationId 與 sessionRequestId／order idempotency key 分責。
- [x] fallback、retry、response 與 audit 保持同一 operationId。
- [x] timestamp、token 與 body 使用 canonical serialization。
- [x] executable snapshot 的 Local PostgreSQL Session／Order commit-loss replay **2/2 PASS**。
- [x] canonical body、token、code、time、operationId、audit correlation 與 query budget runtime evidence 已通過。

### QR-P1-06 Outbox consumer、重試與 lag 可觀測性

- 狀態：**LOCAL RUNTIME PASS**
- ADR：**docs/OUTBOX_DISPATCH_ADR.md**
- 程式：**20260813001731_p1_outbox_dispatch.sql**、**src/server/outbox/outbox-dispatcher.ts**、cron route
- 測試：outbox pgTAP、dispatcher unit、failure injection、cron route unit

- [x] notification outbox 使用 claim／lease、bounded retry、dead-letter outcome 與可重入 consumer。
- [x] domain outbox 在沒有正式 event contract 時保持 dormant；producer 寫入 CANCELLED，未知 pending event fail closed。
- [x] 沒有 drop／replace 已發布 status constraint；lease／retry 以 additive columns 與 RPC outcome 表示。
- [x] pending age、queue depth、dead-letter telemetry 不含 PII／secret。
- [x] crash-after-send、duplicate delivery 與 provider timeout 的 unit／static contract 通過。
- [x] executable snapshot 的 outbox pgTAP、claim／lease、retry 與 lag runtime 證據已通過。

## 6. Phase 2 — 降低耦合

### QR-P2-01 拆分 QrOrderFlow

- 狀態：**LOCAL RUNTIME PASS**
- public entry：**src/components/qr-order-flow.tsx，14 行**
- controller：**src/components/qr-order-flow-controller.ts，753 行**
- presentation：**src/components/qr-order-flow-presentation.tsx，420 行**
- 邊界測試：**src/components/qr-order-flow-composition.test.ts**

- [x] public entry 只保留 props type、`useQrOrderFlowController(props)` 與 `QrOrderFlowPresentation` 接線。
- [x] session application、availability、capacity、cart、checkout、fulfillment、lottery 與 dialog lifecycle 由 controller／bounded modules 負責。
- [x] customer-facing render tree 由 presentation 負責，父層不再持有 effects 或秒級 animation tick。
- [x] composition regression test 會拒絕 session start、`useEffect` 或 UI 邏輯回流 public entry。
- [x] QR／PREORDER／delivery 的 executable snapshot browser E2E 已通過。

composition-only public boundary 的 Phase 2 acceptance 已滿足；controller 與 presentation 仍是大型內部模組，後續若要再拆必須另立範圍，不能在本 Gate 暗中擴張。

### QR-P2-02 拆分 StaffOrderBoard

- 狀態：**LOCAL RUNTIME PASS**
- public entry：**src/components/staff-order-board.tsx，14 行**
- controller：**src/components/staff-order-board-controller.ts，821 行**
- presentation：**src/components/staff-order-board-presentation.tsx，812 行**
- 邊界測試：**src/components/staff-order-board-presentation.characterization.test.ts**

- [x] public entry 只保留 props type、`useStaffOrderBoardController(props)` 與 `StaffOrderBoardPresentation` 接線。
- [x] live／offline snapshot、POS、production、fulfillment、checkout、print、pickup、cancellation 與 refresh orchestration 由 controller／bounded modules 負責。
- [x] ticket、toolbar、mobile compact layout 與 dialog render tree 由 presentation 負責。
- [x] Realtime／SSE 事件仍只觸發 authoritative snapshot reload，不直接信任 event payload。
- [x] characterization test 鎖定 composition boundary，避免 orchestration 回流 public entry。
- [x] Staff／KDS／POS／offline 的 executable snapshot browser E2E 已通過。

composition-only public boundary 的 Phase 2 acceptance 已滿足；controller 與 presentation 的再細分屬後續維護範圍，不是本次 runtime Gate 的替代證據。

### QR-P2-03 共用 live resource lifecycle

- 狀態：**LOCAL RUNTIME PASS（PublicOrderTracker＋StaffOrderBoard 範圍）**
- 程式：**src/lib/use-live-resource.ts**、**src/components/public-order-tracker.tsx**、**src/components/staff-order-board-live.ts**
- 測試：use-live-resource 7 tests、staff live 5 tests、tracker abort test

- [x] startLiveResource 統一 visibility、online/offline、timer、backoff、cursor dedupe、single-flight、abort 與 teardown。
- [x] Tracker 經 useLiveResource 使用共用引擎。
- [x] Staff Board 經 startStaffOrderLiveLifecycle／adapter 使用同一 startLiveResource 引擎。
- [x] Staff SSE／Realtime adapter 失敗會回到 authoritative polling。
- [x] React hook 與 imperative Staff wrapper 都只是共用 engine 的 bounded adapter；兩者的生命週期契約有 **13 tests PASS**。
- [x] background、雙事件來源、重連與 teardown 已納入 unit／contract tests。
- [x] executable snapshot 的雙事件來源、重連與 teardown browser E2E 已通過。

此項 static acceptance 僅限 Tracker＋Staff；若驗收條件擴張為「全系統所有 live／polling consumer 統一」，則需另開後續範圍。

### QR-P2-04 Server-side WorkspaceRouteContext

- 狀態：**LOCAL RUNTIME PASS**
- 程式：**src/proxy.ts**、**src/app/merchant/template.tsx**、**src/lib/workspace-route-context.ts**、MerchantWorkspaceHeader
- 測試：workspace route **18**、merchant template **6**、header **7**，共 **31 tests PASS**；另有 multi-stall browser spec

- [x] route segment 與已授權 workspace 在 server boundary 收斂成 canonical organization／stall context。
- [x] client header 不再以 pathname 或 query 猜安全 scope。
- [x] multi-org route、null scope、invalid outsider 與 unauthenticated failure 有正反 unit。
- [x] UI switcher 只在已授權 workspace 集合中切換，不擴大 RBAC。
- [x] executable snapshot 的 multi-stall browser test 已通過。

### QR-P2-05 A/B DB preflight 收斂到相同 trusted RPC

- 狀態：**LOCAL RUNTIME PASS（canonical contract＋independent failure domains）**
- migration：**20260813020000_canonical_public_order_preflight.sql**
- 程式：兩個 Edge function、Circuit B service、trusted RPC repository
- ADR：**docs/adr/ADR-004-public-order-terminal-parity-observability.md**
- 測試：preflight migration／pgTAP、dual contract、Circuit A/B terminal matrix 與 DB replay

- [x] Session／Order 的 QR、ordering mode、schedule、capacity、session 與 idempotent replay preflight 使用 canonical trusted RPC。
- [x] pure contract 測試覆蓋 canonical result、audit correlation、query assertion 與 ADR-004 terminal mapping。
- [x] executable snapshot 的 A/B commit-loss session／order replay、query budget 與 7 個 DB-preflight terminal cases runtime 已通過。
- [x] A/B 共用 canonical DB preflight、schema/error/token/replay、abuse behavior、RPC item mapping 與 public response contract；pure contract focused **7 files／47 tests PASS**。
- [x] HTTP／CORS／trusted IP、rate-limit 呼叫、Turnstile runtime、PostgREST／Prisma adapter 與 full-menu enrichment 刻意保持獨立故障域；不以引入 common-mode failure 的 shared async orchestrator 作為完成條件。
- [x] ADR-004 範圍內的單一 DB-backed terminal matrix 已以本次 Local L1B runtime 重跑通過。

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
- [x] executable snapshot 已執行 98-migration fresh reset、Phase 3 pgTAP 與 RLS／RPC runtime；五個旗標在 TypeScript 與 PostgreSQL 邊界均保持 hard OFF。
- [ ] 真實 migration-window 雙連線 race 尚無獨立自動化證據；這不影響 dormant foundation 的 Local DB runtime 結果，但在 activation 或發布前仍維持 fail closed。

以下各項列出的 pgTAP 檔案已在本次 Local PostgreSQL 執行；runtime 結果統一以第 8 節為準。

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
| Local snapshot lock | **PASS（local only）** | executable commit `8a1cf624cf7f19ceea7252dbf12b7b363b5c5974`；`origin/staging@ba378d9eea57e0328bf9c45d975aadde9a766853` 為 ancestor；目前 tracked 差異僅為本 checklist，既有 untracked 本機資料不納入發布 |
| TypeScript | **PASS** | `npm run typecheck` |
| ESLint | **PASS** | `npm run lint` |
| Unit／contract | **PASS** | 298 files passed、2 skipped；1,863 tests passed、9 skipped，0 failed |
| UI audit | **PASS** | 220 TSX files；`npm run ui:audit` |
| Prisma validator | **PASS** | `npm run prisma:validate` |
| Migration／security focused suite | **PASS** | remediation 後 7 files／103 tests；sealed rescan 前再跑 migration classifier＋4 個 migration contract，共 5 files／77 tests；unknown ALTER TABLE actions 全數 fail closed，合法 additive column／constraint 與既有 exact-digest migration 保持通過 |
| Production guard | **PASS** | exact executable commit `8a1cf624cf7f19ceea7252dbf12b7b363b5c5974` 的 detached clean worktree：1,489 tracked files、98 migrations；production guard 通過，一項歷史 data-copy warning 保留人工審查 |
| DB health | **PASS** | Docker Desktop 4.87.0.236836／Engine 29.7.2；Local QA 期間 11 個 L1B 容器 running、核心 Supabase 容器 healthy；測試結束後 Edge Functions 測試容器已停止，Vector 依隔離 QA 設定停止 |
| DB reset | **PASS** | fresh reset 98 個 migrations；runtime ledger 與 repository migration hash **98/98 match** |
| DB tests／RLS／RPC | **PASS** | 58 個 pgTAP 檔／1,373 assertions；A/B DB replay、terminal matrix、capacity／schedule concurrency、outbox 與 Phase 3 hard-lock runtime 通過 |
| DB lint | **PASS** | Local PostgreSQL schema lint 通過 |
| Production build | **79/79 pages PASS** | fresh production build |
| Targeted E2E | **PASS** | wait-ack／PREORDER／product-note 組合 **9/9**；production-mode KDS **3/3**；跨角色 390×844 trace 單檔 **1/1** |
| Full E2E | **PASS** | **112 passed、1 expected skip、0 failed**，11.6 分鐘；skip 僅為非 production-server 模式下的 Service Worker 導覽快取案例 |
| Dependency audit | **PASS** | `npm audit --audit-level=moderate`：0 vulnerabilities |
| Diff hygiene | **PASS** | executable snapshot 的 `git diff --check` |
| Dangerous-pattern review | **PASS** | 新增差異中的 dynamic code、unsafe HTML、unsafe raw SQL、weak random、CSRF skip 均為 0 |
| Security diff | **PASS（current executable commit）** | 首輪 sealed scan `b000dc52-0c96-4698-a24c-460757d02190` 確認 1 個 Medium/P2 finding（blanket ALTER TABLE allow）；修正後 sealed scan `2279cee3-922c-4ae2-9204-1126b0dd0ca0` 鎖定 `3600372..8a1cf62`，4/4 review items、coverage complete、0 findings |
| Mobile visual QA | **PASS** | 390×844 商家、顧客菜單／結帳、Tracker、Staff、KDS trace；360×740 顧客 QR 入口；無水平 overflow，主要 CTA 可見／可操作 |
| Visual artifacts | **PASS** | `artifacts/phase0-3-mobile-visual-20260820/`；390 trace SHA-256 `54EA27CD707E05094CBC466F5FB4B9CE43356D02C199388AE4DBADFE6ACE804D` |
| Cross-role live order | **PASS** | 同一張 Local DB 外帶單完成商家→顧客→Tracker→Staff 接單→KDS 開始製作→Tracker 製作中；E2E 測試資料於 afterAll 清理 |

### Final Local Gate

- [x] fresh typecheck。
- [x] fresh full lint。
- [x] fresh full unit／contract：1,863 passed、9 conditional skipped、0 failed。
- [x] fresh UI audit。
- [x] fresh Prisma validation、migration focused suite 與 clean production guard。
- [x] fresh production build：79/79 pages。
- [x] dependency audit、diff hygiene 與 dangerous-pattern review。
- [x] 最新 executable commit 的 sealed security diff scan：`2279cee3-922c-4ae2-9204-1126b0dd0ca0`，4/4 review items、coverage complete、0 findings。
- [x] Docker／Local Supabase health。
- [x] fresh 98-migration reset、pgTAP、DB lint、RLS／RPC、concurrency 與 A/B commit-loss replay。
- [x] KDS 3、Phase role journey、PREORDER shared-role、QR local smoke 與 wait-ack targeted E2E。
- [x] fresh full Playwright；112 passed、1 expected skip、0 failed、0 flaky。
- [x] 390×844 跨角色／360×740 顧客 QR mobile walkthrough；驗證單頁首要資訊、CTA、overflow、focus 與 loading／status 轉換。
- [x] 最終 executable diff security scan 已 sealed；原 Medium/P2 migration validator finding 已修復並由第二次 scan 關閉。

**Final Local Runtime Gate：PASS（LOCAL ONLY）。** Docker、DB、KDS、多角色、QR／PREORDER、手機畫面、完整 Playwright 與 current executable security seal 已在最新 Staging 整合後的同一 executable snapshot 驗證。此結果不能跳過 CI／Preview、遠端 Staging 與發布 Gate。

## 9. Release Gate

| Gate | 狀態 | 必要證據 |
| --- | --- | --- |
| Local static | **PASS** | executable snapshot 的 typecheck、lint、unit／contract、UI audit、Prisma validation、build、audit 與 static migration checks 通過 |
| Local DB／runtime | **PASS** | Docker／Supabase health、98-migration reset、58 個 pgTAP／1,373 assertions、DB lint、targeted＋full E2E 與 mobile visual QA 完成 |
| Phase scope | **LOCAL ACCEPTANCE PASS** | Phase 0–2 已滿足目前 Local acceptance；Phase 3 僅按既定範圍完成 dormant foundations 並保持五旗標 hard OFF，不代表 active product complete |
| Branch integration | **PASS（LOCAL）** | `origin/staging@ba378d9eea57e0328bf9c45d975aadde9a766853` 已合併且為 executable commit `8a1cf624cf7f19ceea7252dbf12b7b363b5c5974` 的 ancestor；合併後 local static、DB、browser QA 與 security review 已重跑 |
| Security review | **PASS（LOCAL CURRENT EXECUTABLE COMMIT）** | sealed scan `2279cee3-922c-4ae2-9204-1126b0dd0ca0` 為 4/4 review items、coverage complete、0 findings；掃描 revision 為 `8a1cf624cf7f19ceea7252dbf12b7b363b5c5974` |
| CI／Preview | **未執行** | 同一 commit 的 required checks、Preview smoke |
| Staging | **未執行** | 與預計發布相同 tree；Staging accounts、DB／Edge／Vercel smoke |
| DR Plan／Apply | **未執行** | 當次 workflow IDs 與成功摘要 |
| Production Plan | **未建立** | immutable plan、revision、schema run、artifact digest |
| Production owner confirmation | **未取得** | 明確綁定當次 immutable Plan；不能沿用一般授權 |
| Production Apply | **未執行／未授權** | Plan-bound confirmation 後才能觸發 |
| Post-deploy | **未執行** | QR／service／DB smoke、rollback observability |

**Overall Release Gate：FAIL CLOSED。** 最新 Staging 已在本機整合，local static、DB、完整 browser QA 與 current executable security seal 已通過；CI／Preview、遠端 Staging、DR 與 Production gates 仍未執行。下一個可執行順序是：checklist commit → CI／Preview → Staging DB／Edge／Vercel smoke → DR → immutable Production Plan → plan-bound owner confirmation → Production Apply。在此之前不得部署或宣稱 Production-ready。

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
