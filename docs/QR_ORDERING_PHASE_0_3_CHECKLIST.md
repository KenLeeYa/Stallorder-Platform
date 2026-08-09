# StallOrder QR 訂購與架構改善 Phase 0–3 Checklist

> 本文件是 QR 訂購、訂單追蹤、公開訂單 intake 與相關架構改善的唯一 Phase 0–3 狀態來源。它與商業帳務 Phase 1–3、商家申請 P0–P2、歷史效能 P0–P4，以及生產韌性階段無關。

## 文件狀態

- 更新日期：2026-08-09
- 基準分支：`codex/local-mobile-menu-workflow-20260808`
- 基準 revision：以包含本文件的 Git commit 為準
- 驗證環境：本機驗證後，仍須依序通過 Preview、DR 與 Production gate
- Release 狀態：以對應 GitHub PR 與 Actions Run 為唯一發布事實來源
- Production 授權：每次發布均須綁定當次不可變 Plan，本文不代表發布授權
- 範圍：QR／共享連結顧客流程、Tracker、Circuit A/B、容量與排程、outbox、Staff Board，以及 Phase 3 候選能力

本文件中的「完成」只代表目前工作樹已有對應程式與自動化測試證據，不代表已進入 CI、Staging 或 Production。每次變更 revision 後都必須重新驗證狀態。

## 狀態與本機可行性定義

狀態：

- `已完成`：所有驗收條件均已勾選，且有程式與測試證據。
- `部分完成`：已有實作，但仍有未勾選條件。
- `未完成`：尚未達到此項目的完整驗收條件。
- `未開始`：只有相鄰能力或 scaffolding，沒有本項功能。
- `阻擋`：需要外部憑證、產品決策、法遵或資料治理決策。

本機可行性：

- `A`：可直接在本機分支實作及完整測試，不需外部服務。
- `B`：可在本機實作，但必須先完成 ADR、append-only migration 或跨模組契約設計。
- `C`：本機只能完成 mock／contract／feature flag；完整驗收需要外部 sandbox、營運或治理決策。

## 不可破壞條件

- 公開 QR 訂購不得進入可信裝置的 offline POS queue。
- 必須保留 RLS／tenant scope、短效單次 session、Turnstile、rate limiting、stall／QR lock、server-side pricing 與 idempotency。
- Transport error 或 5xx response-loss 重試保留原 `sessionRequestId`；只有 terminal backend code 才旋轉。
- Circuit A/B 可保留不同 transport 與部署故障域，但成功、錯誤、冪等與資料庫交易語意必須一致。
- 資料庫修正必須新增 append-only migration；不得回頭修改已發布的歷史 migration。
- Phase 3 功能預設 fail closed，未通過 feature flag、權限、sandbox 與治理 gate 前不得對外顯示。
- 本機通過不等於可發布；Preview／Staging／Production 仍適用各自獨立的 release gate。

## Phase 摘要

| 階段 | 狀態 | 已確認現況 | 下一個本機 gate |
| --- | --- | --- | --- |
| QR Phase 0 | 已完成 | 7 項完成 | Phase 0 本機 focused gates 已通過；持續納入完整 E2E 回歸 |
| QR Phase 1 | 部分完成 | 3 項完成、2 項部分完成、1 項未完成 | 下一個本機 gate 為 Local L1C targeted schedule catch-up；另補 P1-05 golden／防重複證據 |
| QR Phase 2 | 未完成／有部分基礎 | 只有部分 trusted RPC 共用基礎 | 先建 characterization tests，再逐一拆模組 |
| QR Phase 3 | 未開始 | 只有 preorder、人工付款、QR rotation 等相鄰能力 | 先完成產品、provider、安全與同意治理決策 |

## QR Phase 0：正確性與立即 UX

### QR-P0-01 商家路由攤位解析

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/components/merchant-workspace-header.tsx` 的 `resolveMerchantRouteContext`
- 測試證據：`src/components/merchant-workspace-header.test.ts`

驗收條件：

- [x] `/merchant/stalls/:stallId` 與其巢狀頁面能解析正確攤位。
- [x] path scope 優先於舊 query／fallback context。
- [x] 無攤位或無效路徑不會誤選其他攤位。

### QR-P0-02 PREORDER 先選時段再顯示可售菜單

- 狀態：`已完成`
- 本機可行性：`A`
- 程式證據：`src/components/qr-order-flow.tsx`、`src/lib/public-menu.ts`
- 測試證據：`e2e/qr-preorder-menu-availability.spec.ts`、`src/lib/public-menu-preorder.test.ts`

驗收條件：

- [x] 時段選擇器顯示在商品導覽與菜單之前。
- [x] 套用時段後只顯示該時段可售商品，並移除失效購物車項目。
- [x] 新進 PREORDER 不自動套用第一個時段；有效的既有草稿可明確標示為已恢復。
- [x] 尚未套用時段時不顯示可點菜單，改顯示清楚的選時段引導。
- [x] 變更未套用時段時，菜單與購物車仍維持上一個已套用時段，不產生混合狀態。

### QR-P0-03 商品 Bottom Sheet 與 Cart／Checkout 分責

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/components/qr-order-flow.tsx`
- 測試證據：`e2e/qr-independent-cart-lines.spec.ts`

驗收條件：

- [x] 商品規格在行動版 Bottom Sheet／dialog 中完成。
- [x] Cart 只處理品項檢視與編輯；Checkout 才顯示履約、顧客資料及送單控制。
- [x] Dialog 開關、焦點返回及 Escape 行為有測試。
- [x] 360 px 與 390 px 不出現水平溢位或被底部 CTA 遮蔽。

### QR-P0-04 送單 CTA 顯示缺少條件

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/components/qr-order-flow.tsx` 的 checkout blocker
- 測試證據：`e2e/qr-independent-cart-lines.spec.ts`

驗收條件：

- [x] CTA 能區分 session、時段、地址／電話、必選規格、等待確認與 Turnstile 缺口。
- [x] 錯誤訊息鄰近 Checkout 並可被輔助科技辨識。
- [x] 不以停用按鈕取代必要的錯誤說明。

### QR-P0-05 Tracker 顯示現在、下一步及協助入口

- 狀態：`已完成`
- 本機可行性：`A`
- 程式證據：`src/components/public-order-tracker.tsx`、`src/components/line-notification-controls.tsx`
- 測試證據：`src/components/public-order-tracker.test.tsx`

驗收條件：

- [x] 五階段 stepper 正確反映訂單與履約狀態。
- [x] 顯示「目前」與「下一步」。
- [x] 顯示最後更新、更新中與離線狀態。
- [x] 提供所有訂單都看得到的「需要協助」入口。
- [x] 協助入口至少提供安全的重新整理／再次點餐動作；只有公開且已核准的聯絡方式才能顯示電話、LINE 或外部連結。
- [x] 協助操作不洩漏私人聯絡資料，也不繞過訂單授權。

### QR-P0-06 Hidden／offline 停止 polling

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/components/public-order-tracker.tsx` 的 `startVisibilityAwareOrderPolling`、`src/components/qr-order-flow.tsx`
- 測試證據：`src/components/public-order-tracker.test.tsx`

驗收條件：

- [x] hidden 或 offline 時停止 interval polling。
- [x] 回到 visible／online 時立即刷新並恢復單一 interval。
- [x] in-flight refresh 合併，不產生重疊請求或 stale response 覆蓋。

### QR-P0-07 秒級倒數與抽獎動畫移出 QrOrderFlow

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/components/qr-session-countdown.tsx`、`src/components/qr-session-expiry-dialog.tsx`、`src/components/qr-lottery-dialogs.tsx`、`src/lib/session-countdown.ts`、`src/lib/qr-lottery.ts`
- 測試證據：`src/lib/session-countdown.test.ts`、`src/lib/qr-lottery.test.ts`、`e2e/qr-independent-cart-lines.spec.ts`、`e2e/qr-lottery-recommendation.spec.ts`

驗收條件：

- [x] session countdown 移至獨立 hook／view，並保留 visible／hidden 行為與 expiry callback。
- [x] lottery animation 與 dialogs 移至獨立模組，父元件不因每個動畫 tick 全體 rerender。
- [x] `prefers-reduced-motion` 行為不退化。
- [x] 倒數到期、dialog focus、抽獎上限及失敗復原均有 unit／E2E 覆蓋。

## QR Phase 1：低風險效能與可靠性

### QR-P1-01 `includeMenu:false` 降低 Session query budget

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`supabase/functions/create-order-session/index.ts`
- 測試證據：`supabase/functions/create-order-session/query-plan.test.ts`、`e2e/qr-local-smoke.spec.ts`

驗收條件：

- [x] 有 SSR initial menu 時以 `includeMenu:false` 跳過菜單相關查詢。
- [x] 非桌位 Session DB query budget 由 8 降至 6。
- [x] 回應仍包含 session、capacity 與必要 context，且 A/B fallback 不退化。

### QR-P1-02 實體 QR SSR 跳過無用 preorder slots

- 狀態：`已完成`
- 本機可行性：已完成
- 程式證據：`src/app/q/[qrToken]/page.tsx`、`src/lib/public-menu.ts`
- 測試證據：`src/app/q/[qrToken]/page.test.tsx`、`src/lib/public-menu-preorder.test.ts`

驗收條件：

- [x] 實體 QR SSR 不查詢只供 shared-link PREORDER 使用的時段。
- [x] shared-link PREORDER 仍可取得完整時段。
- [x] 菜單、ordering mode 與 cache key 不互相污染。

### QR-P1-03 容量狀態未改變時不重算第二次

- 狀態：`已完成`
- 本機可行性：已完成（Local L1B）
- 程式證據：`supabase/migrations/20260809161446_dedupe_stall_capacity_refresh.sql`
- 測試證據：`supabase/tests/capacity-refresh-dedupe-migration.test.ts`、`supabase/tests/database/capacity_wait_time.test.sql`、`e2e/capacity-refresh-concurrency.spec.ts`

驗收條件：

- [x] 先以測試固定目前成功、警告、自動暫停及自動恢復語意。
- [x] 未改變 ordering state／capacity settings 時直接回傳同一份權威 snapshot。
- [x] 有狀態變更時只做必要的一次後置計算，不能回傳變更前資料。
- [x] 以新的 append-only migration 取代函式，不修改歷史 migration。
- [x] pgTAP 覆蓋 warning、auto-pause／resume、manual pause 及 snapshot 等價性。
- [x] 獨立多連線資料庫 E2E 覆蓋同攤位 concurrent refresh、固定 lock order、no-deadlock 及權威 snapshot 等價性。

### QR-P1-04 全域 schedule processor 改為 targeted catch-up

- 狀態：`未完成`
- 本機可行性：`B`
- 現況證據：Session RPC 仍呼叫 `app_private.process_stall_schedules(now())`；該函式掃描所有到期行程。

驗收條件：

- [ ] 新增以 `stall_id`／QR context 為範圍的 trusted schedule catch-up RPC。
- [ ] 公開 Session／Order hot path 只處理目前攤位。
- [ ] Cron／維運路徑仍保留可恢復全域積欠排程的能力。
- [ ] 兩攤以上 pgTAP 證明 targeted 呼叫不會變更其他攤位。
- [ ] 鎖順序與現有 session／capacity lock 相容，無新增 deadlock。

### QR-P1-05 Circuit A/B golden parity 與共同 operation ID

- 狀態：`部分完成`
- 本機可行性：`A`
- 程式證據：`supabase/functions/_shared/dual-order-contract.test.ts`、`src/lib/public-order-client.ts`、`src/server/public-order/trusted-rpc-repository.ts`

驗收條件：

- [x] 兩條 Circuit 已共用主要 idempotency payload、session token 與部分 trusted RPC。
- [x] 每次邏輯操作只建立一個 `operationId`，並在 A→B fallback、transport／5xx retry、log 與 response 中保持一致。
- [x] `operationId` 與 `sessionRequestId`／訂單 idempotency key 的用途分離且有格式驗證。
- [ ] golden suite 比對成功 response、每個公開錯誤碼、冪等 replay、query budget 與 audit correlation。
- [ ] Circuit A 故障後切換 B 不會建立第二張訂單或第二個有效 session。

### QR-P1-06 Outbox consumer、重試與 lag 可觀測性

- 狀態：`部分完成`
- 本機可行性：`B`
- 現況證據：`notification_outbox` 已有 schema／writer 但找不到 consumer；`domain_outbox` 有 schema／測試但找不到可驗證 producer 或 consumer。現有 `notification-job-processor` 處理的是另一個 `notification_jobs` 模型。

驗收條件：

- [x] 完成現況 audit，確認兩張 outbox 沒有可驗證 consumer，且 `domain_outbox` 沒有已確認 producer contract。
- [ ] 以 ADR 分別決定每張 outbox 要保留並 dispatch、維持 dormant，或停止 writer／安全退場；不得讓待處理資料無限累積。
- [ ] 若保留 `notification_outbox`：使用 claim／lease、idempotency、bounded retry、dead-letter 與可重入 consumer。
- [ ] 若 `domain_outbox` 維持 dormant：禁止無契約 event writer，並對未知 pending event fail closed／告警。
- [ ] 若保留 consumer：加入 pending age／queue depth／dead-letter 告警，且 log 不含 PII／secret。
- [ ] pgTAP／unit／failure-injection 覆蓋 crash-after-send、重複投遞與 provider timeout。

## QR Phase 2：降低耦合

### QR-P2-01 拆分 QrOrderFlow

- 狀態：`未完成`
- 本機可行性：`B`
- 現況證據：`src/components/qr-order-flow.tsx` 仍同時持有 session、menu、product、cart、checkout、fulfillment、timer 與 lottery concerns。

驗收條件：

- [ ] 先建立現有流程的 characterization tests，不以重構同時改變產品行為。
- [ ] session、menu、product、cart、checkout、fulfillment state／views 有明確邊界。
- [ ] session／idempotency／cart recovery 不變條件集中測試。
- [ ] 父元件只負責組合流程，不持有秒級動畫 state。
- [ ] QR、shared-link PREORDER 與 delivery E2E 全數通過。

### QR-P2-02 拆分 StaffOrderBoard

- 狀態：`未完成`
- 本機可行性：`B`
- 現況證據：`src/components/staff-order-board.tsx` 仍同時處理 intake、POS、payment、production 與 offline concerns。

驗收條件：

- [ ] 先補 Staff Board characterization tests。
- [ ] intake、POS、payment、production、offline 各有獨立模組與契約。
- [ ] Realtime／SSE／polling 事件只觸發權威資料重讀，不直接信任事件 payload。
- [ ] offline queue、payment reconciliation 與 production transition 行為不退化。

### QR-P2-03 共用 `useLiveResource`

- 狀態：`未完成`
- 本機可行性：`B`

驗收條件：

- [ ] 統一 SSE、Realtime、polling fallback、visibility、online/offline、abort、backoff 與 cursor dedupe。
- [ ] 單一 resource 同時只允許一個 refresh；stale response 不得覆蓋新資料。
- [ ] 各 consumer 可設定 refresh interval，但不可自行重寫 lifecycle。
- [ ] fake-timer 與 E2E 覆蓋 background、重連、事件暴增與 teardown。

### QR-P2-04 Server-side WorkspaceRouteContext

- 狀態：`未完成`
- 本機可行性：`B`
- 現況證據：目前攤位 context 仍由 client header 解析 pathname。

驗收條件：

- [ ] Route segment 與授權 principal 在 server 端解析成 canonical organization／stall context。
- [ ] client 不再由 pathname 或 query 猜測安全 scope。
- [ ] 無權限、跨 tenant、無效 stall 與 fallback 行為有正反測試。
- [ ] UI switcher 只消費 server 已核准 context，不擴大 RBAC 權限。

### QR-P2-05 A/B DB preflight 收斂到相同 trusted RPC

- 狀態：`部分完成`
- 本機可行性：`B`
- 現況證據：A/B 已呼叫部分同名 trusted RPC，但 Edge 與 Next.js 仍各自編排 preflight。

驗收條件：

- [x] Session／建單的主要交易 RPC 已有共用基礎。
- [ ] QR、ordering mode、schedule context、capacity 與 resumable order preflight 由同一 trusted RPC 回傳 canonical 結果。
- [ ] A/B 只保留 transport、rate-limit adapter 與部署故障域差異。
- [ ] golden tests 證明 error code、transaction、audit 與 query budget 一致。

## QR Phase 3：新功能

Phase 3 不得作為單一大型變更。每項都必須有獨立 ADR、feature flag、schema／RLS review、資料保存規則、mock E2E 與明確商家驗證。

### QR-P3-01 Digital waitlist

- 狀態：`未開始`
- 本機可行性：`B`

驗收條件：

- [ ] 定義 waitlist entry、party、position、estimate、notify、seated、cancelled、expired 狀態機。
- [ ] 決定聯絡管道、重複排隊、no-show、保留時間與個資保存期限。
- [ ] 建立 tenant-scoped schema、RLS、audit、rate limit 及 mock notification。
- [ ] 入座後換發新的 dine-in session，不沿用公開 waitlist token 建單。

### QR-P3-02 線上付款與 reconciliation

- 狀態：`未開始／阻擋`
- 本機可行性：`C`
- 阻擋：供應商選擇、sandbox 憑證、商務／退款／對帳規則及 webhook 安全決策

驗收條件：

- [ ] 先核准 provider、付款時點、退款、手續費、timeout 與 fallback 規則。
- [ ] 本機使用 provider mock 驗證 authorize／capture／fail／timeout／duplicate webhook。
- [ ] webhook 驗簽、replay 防護、冪等、金額／幣別比對及 audit 全數通過。
- [ ] provider 狀態不可直接覆寫訂單；以 reconciliation state machine 收斂。
- [ ] 無 provider 或 provider 故障時維持現金／人工付款且不得顯示假成功。

### QR-P3-03 訂位加預點

- 狀態：`未開始`
- 本機可行性：`B`

驗收條件：

- [ ] 定義 reservation、capacity、deposit、late／no-show、修改與取消規則。
- [ ] Reservation 與 PREORDER 使用明確關聯，不以同一欄位混用兩種生命週期。
- [ ] 時區、跨日、容量競爭、訂單截止與退款行為有測試。
- [ ] 沒有有效訂位時，不得取得受保留桌位／時段的訂單 session。

### QR-P3-04 高風險內用 dynamic QR

- 狀態：`未開始／阻擋`
- 本機可行性：`B/C`
- 阻擋：ServicePoint／桌位營運模型、token TTL、斷網 fallback 與印刷 QR 相容策略

驗收條件：

- [ ] 定義 static entry QR 與短效 dynamic ordering credential 的責任邊界。
- [ ] token 綁定 organization、stall、service point、session、expiry 與 nonce。
- [ ] replay、截圖分享、換桌、結帳後失效與緊急 pause／rotate 有測試。
- [ ] 不使既有印刷 QR 無預警失效，且無 JavaScript 時仍有安全復原指引。

### QR-P3-05 經同意治理的 CRM／loyalty

- 狀態：`未開始／阻擋`
- 本機可行性：`C`
- 阻擋：明示同意文字、使用目的、保存／刪除、退訂、資料匯出及營運 owner

驗收條件：

- [ ] 點餐與 CRM 同意分離；拒絕行銷不得阻止下單。
- [ ] consent purpose、version、source、timestamp、withdrawal 與 retention 可稽核。
- [ ] loyalty account、points ledger、調整、到期與 reversal 不直接依訂單現值回算。
- [ ] RLS、RBAC、資料匯出／刪除、退訂與最小揭露測試通過。
- [ ] 未經同意不得把訂單聯絡資料轉成 CRM profile。

## 建議本機實作批次

不得將 Phase 0–3 合併成一次大型修改。建議依序執行：

1. `Local L0A`：完成 QR-P0-02、QR-P0-05；不含 database migration。
2. `Local L0B`：完成 QR-P0-07 的 countdown hook 與 lottery 子元件，和產品 UX 變更分開驗證。
3. `Local L1A`：完成 QR-P1-05 的 operation ID 與 golden parity tests，先建立後端變更的比較基線。
4. `Local L1B`（已完成）：以獨立 append-only migration 完成 QR-P1-03 capacity dedupe，並通過 pgTAP 與真正多連線 concurrency E2E。
5. `Local L1C`：再以另一個 append-only migration 完成 QR-P1-04 targeted schedule catch-up。
6. `Local L1D`：先核准 outbox ADR；優先處理有 producer 的 `notification_outbox`，`domain_outbox` 在沒有 event contract 前維持 dormant。
7. `Local L2A`：先建 `useLiveResource` 與 characterization tests，再拆 QrOrderFlow。
8. `Local L2B`：拆 StaffOrderBoard，建立 server WorkspaceRouteContext，最後收斂 DB preflight。
9. `Local L3.x`：每個 Phase 3 功能各自一批；先做 ADR／mock／feature flag，不和核心 QR 重構混在一起。

已更新到本機供測試的是 `Local L0A`、`L0B`、`L1A`、`L1B`；其中 QR-P0-07 與 QR-P1-03 已達成本機驗收。下一個 migration 批次為 `Local L1C` targeted schedule catch-up。Phase 2 也能純本機逐批完成，但必須維持 Phase 0／1 行為與效能基線。Phase 3 只能先做受 feature flag 保護的本機基礎；沒有外部與治理 gate 時不能標為完整完成。

## 每批共用驗收 Gate

開始前：

- [x] 記錄 branch、revision、dirty worktree 與本批允許修改的檔案。
- [x] 先跑受影響的 characterization／focused tests，建立變更前基線。
- [x] Local L1B 僅新增 append-only migration，未修改歷史 migration；`npm run db:reset` 已驗證可從空資料庫重建。

程式與資料庫：

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run ui:audit`（UI 批次）
- [x] `npm run db:reset`（Local L1B migration）
- [x] `npm run db:test`（47 files／1,062 assertions）
- [ ] `npm run test:e2e`
- [x] `npm run build`（以 webpack production build 驗證）

QR／安全專項：

- [x] `e2e/qr-degraded-mode.spec.ts` 保持通過。
- [x] `e2e/qr-preorder-menu-availability.spec.ts` 保持通過。
- [x] `e2e/qr-independent-cart-lines.spec.ts` 保持通過。
- [x] `e2e/capacity-refresh-concurrency.spec.ts` 通過（1 passed）：確認同攤位真正多連線 refresh、固定 lock order、無 deadlock 及權威 snapshot 等價性。
- [ ] `e2e/qr-local-smoke.spec.ts` 的 query budget 保持通過。
- [ ] Circuit A/B golden、terminal error、transport／5xx retry 與 stale response 測試通過。
- [ ] 360 px、390 px、768 px、1280 px 無阻擋性視覺／操作回歸。
- [ ] 無 secret、PII、測試 dump、`.env*` 或 `.vercel` 檔案進入差異。

效能門檻：

- [x] hidden 分頁不持續 polling。
- [ ] Session query budget 不高於目前已驗收基準。
- [ ] `scan → menu visible`、`scan → session ready`、`checkout → submit` 沒有統計顯著退化。
- [ ] 真實使用者目標維持 LCP ≤ 2.5 s、INP ≤ 200 ms、CLS ≤ 0.1；本機數據只作 regression baseline，不宣稱 Production RUM。

## Release 狀態

| Gate | 狀態 | 證據 |
| --- | --- | --- |
| Local | 部分完成 | L0A／L0B／L1A／L1B 已更新；P0-07 focused gates、`db:reset`、`db:test` 47 files／1,062 assertions，以及 capacity concurrency 1／1 均通過；完整 E2E 結果與最終數量待補 |
| CI／Preview | 未執行 | 不得以本機結果代替 |
| Staging | 未執行 | 必須驗證與預計發布相同的 tree |
| Production Plan | 未建立 | 需要 immutable plan 與明確核准 |
| Production Apply | 未授權 | 本文件不構成部署授權 |

## 驗證紀錄

| 日期 | Revision | 範圍 | 結果 |
| --- | --- | --- | --- |
| 2026-08-09 | `388ffc04d846` + dirty local tree | 以 CodeGraph、目前程式、測試檔與 Git 狀態建立初始 checklist；檢查 23 個唯一 task ID、文件連結、trailing whitespace 與文件差異 | 通過；本輪只有文件變更，沒有重跑程式測試 |
| 2026-08-09 | `388ffc04d846` + dirty local tree | Local L0A／L0B／L1A：PREORDER 明確套用、Tracker 協助入口、countdown／lottery 拆分、Circuit A/B 共用 `operationId` | `typecheck`、lint、1,260 tests、195 TSX UI audit、webpack production build 通過；本批 E2E 11 passed／1 skipped。完整 E2E 尚未完成全綠；重跑仍有 `e2e/kds-production-board.spec.ts:175` 等待工作站 PATCH 逾時，因此未勾選全量 E2E gate；未執行 migration、CI／Preview、Staging 或 Production。 |
| 2026-08-09 | `388ffc04d846` + dirty local tree | QR-P0-07 closeout：countdown、expiry dialog、lottery dialogs、reduced-motion、抽獎上限與失敗復原 | focused unit 7／7 與 focused E2E 8／8 通過；P0-07 所有驗收條件完成。 |
| 2026-08-09 | `388ffc04d846` + dirty local tree | Local L1B／QR-P1-03：append-only capacity dedupe、權威 snapshot 與同攤位並行鎖定 | `db:reset` 通過；`db:test` 47 files／1,062 assertions 通過；capacity concurrency 1 passed。 |

## 更新規則

- 每個主項只有所有子條件完成後才能改成 `已完成`。
- 更新狀態時必須同時記錄測試、日期與 revision；只有程式存在不足以勾選。
- 本機、CI／Preview、Staging、Production 證據分開記錄。
- 新發現的 blocker 應加在原項目下，不新增含糊的「其他改善」。
- 若產品範圍改變，先更新本文件與 ADR，再修改程式。
