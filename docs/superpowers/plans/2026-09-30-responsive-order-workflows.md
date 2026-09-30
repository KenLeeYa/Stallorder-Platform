# Responsive Order Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在隔離本機完成可觸控、可鍵盤操作且保持同單一致性的顧客手機→Staff 平板→KDS→追蹤／交付流程。

**Architecture:** 保留既有 controller、訂單服務、權限、付款與列印契約，只組合角色視圖。復用 `ExperienceDialog` 與 `startLiveResource`；KDS 加上自己的薄 adapter，不引入第二套交易或即時狀態架構。

**Tech Stack:** 現有 Next.js 16.3.4、React 19.2.4、Tailwind 4、TypeScript、Prisma 6.19、Supabase、Vitest、Playwright、axe；Node 24／npm 11.16.0。不新增依賴。

**Spec:** [需求原檔](../../../StallOrder_Responsive_Cross_Device_UI_UX_Codex_Prompt_20260929.md)、[核准設計](../../ux-responsive/current-state.md)、[互動](../../ux-responsive/interaction-spec.md)、[狀態契約](../../ux-responsive/cross-device-state-contract.md)。總順序與版本見[計畫入口](2026-09-30-responsive-cross-device.md)。

## Global Constraints

- 平板／桌機 Staff 預設三欄；768 為目前切換基準；320–767 使用手機任務檢視。窄直向可主動展開明細，不能移除唯一操作。
- 可操作命中區至少 44×44 CSS px；現場主動作選 48px 高、顧客主要提交選 48–56px。正文 16px；不得靠縮字填滿畫面。
- 八寬度 320、360、390、768、820、1024、1280、1440；繁中與既有非中文、明暗、safe area、鍵盤及 reduced motion。
- 品牌僅「攤點通」；不新增 Email／Password 登入策略，不改訂單／付款／交付授權或冪等核心；沒有全域 `orderVersion` 可假設。
- 訂單、付款、列印與通知狀態分開；未知付款查原 attempt；POS busy 不能關閉卸載；不把 SSE 的本機序號當 server version。
- 本輪只寫獨立本機測試專案，無正式發布、外部控制台、真實交易／訊息／紙本出單。禁止 DB reset、prune、清除既有容器或資料。
- 開始產品修改前依AGENTS重新取得Primary唯讀project／deployment／alias／commit／backend／登入入口基線；歷史9月30日收據不當成當下事實。沒有remote write就不做回退或變更設定；本機env只從新lab狀態建立，不複製任何正式／DR／LINE密鑰，子程序明確只使用local mock。
- 每任務先跑新增案例確認失敗的行為，不以環境錯誤作 red；若現況已通過，記為保留回歸，只修實際失敗。逐檔 stage；不 `git add .`。

## Review Focus

1. Escape 在巢狀商品視窗或送單 pending 時觸發，不能一起關閉 POS 或丟失 attempt：A2／A4。
2. 768↔1024 旋轉時選中單已由另一端完成，保留篩選但不得保留失效操作：A4／A5。
3. 第一個快照與 SSE ready 之間更新、HTTP 回應晚於切店，必須補快照且不污染新店：A5。
4. 同鍵重送／收到非 JSON／429 時，總額與訂單唯一性不變，重試受限且保留安全草稿：A3／A6。
5. 已收款而列印失敗或店員被撤權時，不重收款、不遺留前一使用者資料：A4／A6。

---

## 檔案與責任

| 任務 | 產品檔案 | 新增或擴充的驗證面 |
|---|---|---|
| A1 | 不改產品；建立隔離執行前置 | `scripts/responsive-qa-target.mjs`、同名 `.test.mjs`、`playwright.responsive.config.ts`、`e2e/helpers/responsive-order-fixture.ts`、`e2e/responsive-order-roundtrip.spec.ts` |
| A2 | `src/components/experience-dialog.tsx`、`src/components/staff-order-composer.tsx`、`src/app/globals.css` 的既有 token 區 | `e2e/responsive-dialog-keyboard.spec.ts` |
| A3 | `src/components/qr-order-flow-presentation.tsx`、`qr-order-menu.tsx`、`public-order-tracker.tsx`、`src/app/store/[identifier]/public-menu-view.tsx`，僅重現問題處 | `e2e/responsive-customer-checkout.spec.ts`；沿用既有 QR／tracker unit |
| A4 | `staff-order-board-presentation.tsx`、`staff-order-composer.tsx`、`cash-change-summary.tsx`、必要的 controller presentation 欄位 | `e2e/staff-orders-print-runtime-responsive.spec.ts`、`e2e/responsive-pos-checkout.spec.ts` |
| A5 | 新增 `src/components/kitchen-board-live.ts`、修改 `kitchen-board.tsx`；`src/lib/use-live-resource.ts` 僅在新增失敗例證明共用缺陷時改 | `kitchen-board-live.test.ts`、`use-live-resource.test.ts`、`e2e/kds-production-board.spec.ts` |
| A6 | 只修整合案例證明受影響的上述檔案；不預先改 backend | `e2e/responsive-order-roundtrip.spec.ts`、`e2e/responsive-state-recovery.spec.ts`、既有隔離交易與 RLS suites |

各任務新增字串同批更新其現有語系檔：`src/lib/messages/operations.ts`、`operations-errors.ts`、`public-order.ts`、`ordering-experience.ts`，不用散落硬編中文。既有 tests 與 messages 只在對應變動時修改。

### Task 1: A1：建立可重現的候選與第一筆同單流程

**Files:** 上表 A1；`docs/LOCAL_TEST_SERVICE_LIFECYCLE.md`、`docs/ux-responsive/verification-matrix.md` 記錄執行收據；本輪 runtime config 放repo 外的 `C:/Users/KY/.codex/local-labs/stallorder-responsive-20260930/supabase/`，不改正式 config。

**Interfaces:**
- `assertResponsiveQaTarget(environment: Record<string, string | undefined>): void`（JS JSDoc），位於 `scripts/responsive-qa-target.mjs`。需 `RESPONSIVE_QA_RUN=true`、APP origin `http://127.0.0.1:3026`、DB host `127.0.0.1`/`localhost`、port `56822`、database `postgres`、Primary API `http://127.0.0.1:56821`。缺值或遠端一律 throw；不列印憑證。
- `createResponsiveOrderFixture(prisma: PrismaClient): Promise<{ runId: string; qrToken: string; productId: string; stallId: string; stallSlug: string; organizationId: string; baselineTotal: number }>`，放 e2e helper；使用新建隔離專案內的合成 demo 店、固定價 50 的商品、必選加料 10、可選加料 5，兩份合計 130。記錄本輪建立 ID，只處理本輪 fixture。
- `playwright.responsive.config.ts` 沿用既有 config，先執行目標 guard；單 worker、`testMatch` 明列本輪／相關 suite；不會偷偷啟用 LINE 舊 runner。

- [ ] **建立隔離工作樹與 runner 前置。** 按 using-git-worktrees／AGENTS 查活躍 checkout，以候選 HEAD 建立／復用合適隔離 checkout，分支 `codex/responsive-cross-device-20260930`；不切正在服務的分支。讀本機 Next 16 文件及 product-release-qa。比較 3023 被觸及的 dirty 檔案，把既有需求列為回歸，不整份複製其 dirty patch。
- [ ] **測試目標 guard。** 寫 Node 測試 `accepts exact local responsive lab`、`rejects retained 55722/3023`、`rejects remote host even with local flag`、`rejects missing flag or mismatched primary API`；斷言如下，先 `node --test scripts/responsive-qa-target.test.mjs` 得到缺函式 red，再實作並 PASS。
  ```js
  assert.doesNotThrow(() => assertResponsiveQaTarget(exactLocalLab));
  assert.throws(() => assertResponsiveQaTarget({ ...exactLocalLab, DATABASE_URL: retainedDbUrl }));
  assert.throws(() => assertResponsiveQaTarget({ ...exactLocalLab, RESPONSIVE_QA_RUN: undefined }));
  ```
  測試中的 URL 全是合成字串，不能從真實 env 印出或放 snapshot。
- [ ] **啟動最小必要本機 stack。** 先檢查 project labels／程序與所有占用埠，複製候選 `supabase` 的 config、migration、seed、functions 到本輪 lab（排除私有 env／`.temp`）。只在複本設定 project `stallorder-responsive-20260930`；API56821、DB56822、shadow56820、studio56823、mail56824、analytics56827、edge inspector56883。auth origin3026。`npx supabase --workdir C:/Users/KY/.codex/local-labs/stallorder-responsive-20260930 start`；由 local status 安全寫入此 checkout 專用 env，DB／auth／realtime／functions 均指同一 stack，付款 mock、通知禁止。不連 55722，不 dump/copy 既有資料，不執行 reset。衝突時只挑一組已確認空埠並同步修改 guard、config、收據；不關他人的服務。若 fresh migrations 失敗，保留錯誤並診斷，不能改用共享 DB 逃過。
- [ ] **固定 baseline 並建立真實 roundtrip 測試。** 驗證 seed 合成角色與 demo IDs；新增 A1 fixture，瀏覽器用顧客390、Staff1024、KDS1024、桌機1440四個隔離 context。使用真實本機 API／DB，從 UI 客製→下單→接單→製作→追蹤／交付；記錄同一 orderId、金額及事件，不能以 `page.route().fulfill()` 假裝閉環。基準執行前先保存候選的 before 截圖與固定 fixture/time 收據；在任何產品修改前依 B3 的同一方法完成 production-mode 基準量測，無法取得的人工作業／實機數值記 NOT_RUN。停止本輪 dev 才 build，不在服務中的 `.next` 同時建置。lab 放在 repo 外，避免複製的 Deno functions 被 TypeScript／Vitest 納入。
- [ ] **執行並記錄基準。** 安全 env 下設 `PLAYWRIGHT_APP_URL=http://127.0.0.1:3026`、`PLAYWRIGHT_OAUTH_MOCK_PORT=56831`；config 可管理自己的 Next/OAuth mock（`PLAYWRIGHT_REUSE_EXISTING_SERVER=false`），需 functions 的 suite 另起精確 lab functions。`npx playwright test -c playwright.responsive.config.ts e2e/responsive-order-roundtrip.spec.ts --workers=1`。預期同單功能可完成；失敗分給 A3–A6，產品缺陷與環境錯誤分開。不能把未完成流程宣称已驗證。
- [ ] **提交隔離 runner、fixture 與基準描述。** `git add scripts/responsive-qa-target.mjs scripts/responsive-qa-target.test.mjs playwright.responsive.config.ts e2e/helpers/responsive-order-fixture.ts e2e/responsive-order-roundtrip.spec.ts`；`git commit -m "test: isolate responsive order workflow QA"`。私有 env、runtime stack、原始 token 不提交。

### Task 2: A2：POS 與共用 Dialog 的安全鍵盤操作

**Files:** A2 檔案；驗證所有 `ExperienceDialog` 現有消費面，不順手改其業務。

**Interfaces:** 保留 `ExperienceDialog({ open, onClose, title, closeLabel?, children })`，只新增 `closeDisabled?: boolean`（預設 false）、`size?: "default" | "workspace"`（預設 default）。`StaffOrderComposer(props: Props)` 既有 `onCreated(order)`、`onClose()`、idempotencyKeyRef 不變。native `cancel` 在禁止關閉時必須 `preventDefault()`，不能只忽略 callback 而讓瀏覽器自行 close。

- [ ] **寫 red E2E。** 在 `responsive-dialog-keyboard.spec.ts` 定義 `empty POS closes once and restores trigger`、`nested modifier Escape closes only top layer`、`pending submission rejects Escape and close`、`Tab never leaves active dialog`。明確驗證：
  ```ts
  await page.keyboard.press("Escape");
  await expect(posDialog).toBeHidden();
  await expect(posTrigger).toBeFocused();
  // pending case uses a held local request; no payment provider is called.
  await expect(pendingDialog).toBeVisible();
  expect(submitRequests).toBe(1);
  ```
- [ ] **確認 red。** `npx playwright test -c playwright.responsive.config.ts e2e/responsive-dialog-keyboard.spec.ts --workers=1`；須因 Escape／focus／pending 行為失敗，不能只是 login fixture 錯誤。
- [ ] **最小實作。** POS 主視窗及其客製／備註等 overlay 用 native modal 生命週期；保持同一 composer controller，不將 business state 搬入可卸載 view。closeDisabled 接現有 busy，dirty close 沿原確認政策。workspace 尺寸有 100dvh／safe-area／可捲內容，default 外觀不变。保留焦點返回與僅頂層處理 Escape，避免 onCancel/onClose 重複呼叫。只補既有 token 必需尺寸，禁止全域 button selector 覆蓋。
- [ ] **驗證 green＋回歸。** 同 E2E PASS；`npx vitest run src/components/qr-order-dialog-lifecycle.test.ts src/components/staff-order-board-checkout.test.ts` PASS。另瀏覽 Staff 搜尋、所有功能與 QR 客製 dialog，確認既有消費面沒有重複標題／雙 close／失焦。
- [ ] **提交。** 只 stage A2 實際變動，commit `fix: preserve focus and pending state in staff dialogs`。

### Task 3: A3：顧客手機選餐到追蹤的可恢復介面

**Files:** A3；`src/components/qr-order-dialog-lifecycle.ts` 只有旋轉重現失敗時改；controller/API 呼叫契約不變。

**Interfaces:** `QrOrderFlowPresentation` 继续消费现有 presentation props／cart controller；POST `/api/public/orders` 的 clientOrderId、idempotencyKey、session/device proof 不變。fixture 同 A1。追蹤 response 不新增欄位或把 PAID 當 READY。

- [ ] **寫測試。** `responsive-customer-checkout.spec.ts`：`guest customizations keep server total through rotation`、`menu pickup navigation reaches usable cart`、`last item and validation stay above sticky footer`、`stale sold-out item preserves remaining cart`。390選兩份50＋10＋5餐點：
  ```ts
  await expect(cartSummary).toContainText("130");
  expect(storedOrder.total).toBe(130);
  expect(storedOrder.items.reduce((n, item) => n + item.quantity, 0)).toBe(2);
  expect(new Set(createdOrderIds).size).toBe(1);
  ```
  320／360／390測必選未選不能提交；無可用session、401、422、HTML500各有對應恢復，不統一成未知錯誤；已成立單返回／刷新仍到原追蹤。只故障注入使用攔截，正常閉環不攔。
- [ ] **跑 red／baseline。** `npx playwright test -c playwright.responsive.config.ts e2e/responsive-customer-checkout.spec.ts --workers=1`；公開 Menu 的 RSP-07 必須先在候選重現，未重現就只留回歸，不猜根因。
- [ ] **實作失敗項。** 調整菜單／摘要分欄容納、最後內容 padding、error summary 與控制尺寸；客製上下限／差額清楚；既有分類、搜尋、Session 與安全保存仍共用。768 窄版容纳不下時單 pane 切換而不縮字，controller 不重建。變更 breakpoint 時同改 dialog matchMedia 並加跨界测试，不留 CSS／JS 不一致。
- [ ] **驗證 green。** 同 E2E；`npx vitest run src/lib/qr-cart.test.ts src/lib/qr-order-recovery.test.ts src/components/qr-order-dialog-lifecycle.test.ts src/components/public-order-tracker.test.tsx src/components/public-order-tracker.abort.test.tsx`。回歸匿名、會員入口與 tracking owner 拒絕；不新增會員才能點餐限制。
- [ ] **提交。** 只 stage A3 變動，commit `fix: make customer checkout usable across viewport changes`。

### Task 4: A4：Staff 三欄與手機明細、POS 金額及工具列

**Files:** A4；`src/lib/messages/operations.ts`／`src/lib/messages/workspace-navigation.ts`；已有 renderer flag 保留。

**Interfaces:** `StaffOrderBoardPresentation(props)` 原命令 callbacks、`StaffOrderDto` 與 `StaffOrderPosSnapshot` 不變。新增呈現 state `focusedOrderId: string | null`，存 orderId，從目前有權的集合取最新 object；不保存另一份訂單。沿用 `ExperienceDialog` workspace 及現有 `CashChangeSummary`，不另寫找零算法。

- [ ] **寫 red。** 擴充 responsive spec：`all authorized toolbar actions remain reachable`、`portrait defaults to three panes with explicit detail focus`、`rotation preserves queue and current order`、`mobile detail returns to original list position`；新增 POS spec：`count and total before confirmation`、`cash controls fit and change is prominent`、`printing failure does not resubmit payment`。
  ```ts
  await expect(masterDetail.getByTestId("staff-order-list-pane")).toBeVisible();
  await expect(masterDetail.getByTestId("staff-order-items-pane")).toBeVisible();
  await expect(masterDetail.getByTestId("staff-order-actions-pane")).toBeVisible();
  expect(primaryBox.height).toBeGreaterThanOrEqual(48);
  expect(iconBox.width).toBeGreaterThanOrEqual(44);
  expect(iconBox.height).toBeGreaterThanOrEqual(44);
  expect(paymentRequests).toBe(1);
  ```
  以現有三個 testId 實測可見 rect，不為方便測試增加無用途 DOM；不得把隱藏重複控制算可見。768→1024→390→768保留filter/selected/draft；另一端已完成單時不顯示舊的下一步。新舊 Staff flag 在獨立 fixture 各跑一次。
- [ ] **確認 red。** `npx playwright test -c playwright.responsive.config.ts e2e/staff-orders-print-runtime-responsive.spec.ts e2e/responsive-pos-checkout.spec.ts --workers=1`；先用 A1 runner 精確目標 guard 再跑既有 suite。
- [ ] **實作最小視圖變更。** 左欄識別／狀態、中欄品項、右欄動作，保留三欄滾動；窄直向增展開明細，手機同一明細內容用 sheet。回列表定位到原單、若單消失則安全落點。手機角色／聲音／喚醒／列印在 SSE 左側，主列移除theme/提醒；平板桌機全功能。搜尋緊鄰產能，QR在取餐碼右方。份數旁總額；現有折扣、200/500/1000、短實收欄有空間一排，手機可折行；輸入10000也不能截斷或硬加maxlength4。應找零／尚差用明確標籤、大數字与独立背景。state更新不清掉 pending attempt；硬體 capability 失敗不能導向再次收款。
- [ ] **green 與金額回歸。** 上述 E2E；`npx vitest run src/lib/checkout.test.ts src/lib/staff-checkout.test.ts src/components/staff-order-board-checkout.test.ts src/components/staff-order-board-refresh.test.ts src/components/staff-order-board-production.test.ts src/server/resilience/staff-workspace-rollout.test.ts`。模擬重印只驗 queue不驗真印；四組 KDS／print 開關完成案例留 A6。
- [ ] **提交。** 只 stage A4 變動，commit `feat: adapt staff order details and compact checkout controls`。

### Task 5: A5：KDS 防過期快照、重連與撤權呈現

**Files:** A5；不變動 `src/lib/kitchen.ts` safe DTO 或資料庫狀態機。

**Interfaces:** 新 `startKitchenBoardLiveLifecycle<T>({ stallSlug, environment, load, onData, onError, onConnectionChange }): LiveResourceController`。load `(signal: AbortSignal) => Promise<T>`，onData `(value: T) => void`；connection `"CONNECTING" | "CONNECTED" | "FALLBACK"`。environment 延伸 `LiveResourceEnvironment` 並提供 `createEventSource(url)`、`supportsEventSource()`；source 有 `addEventListener("ready" | "kitchen", listener)`、`onerror`、`close()`。復用 `startLiveResource` 的 coalesce／AbortSignal／hidden/offline cleanup；12,000ms fallback不加第二個 interval。`ready`／`kitchen` 只做 invalidation，本機sequence只排序請求。

- [ ] **寫 red unit。** `kitchen-board-live.test.ts` 用 fake environment/deferred Promise：`ready closes initial snapshot gap`、`burst invalidations coalesce`、`stopped old store cannot publish`、`offline aborts and online refreshes`、`retry-after bounds new fetches`。
  ```ts
  expect(maxConcurrentLoads).toBe(1);
  expect(applied).toEqual([latestSnapshot]);
  controller.stop();
  expect(activeListeners).toBe(0);
  expect(oldRequestSignal.aborted).toBe(true);
  ```
  另加 browser 撤權 case：先見餐點，下一次board GET403，舊卡／命令消失；恢復必須經授權新快照。
- [ ] **確認 red。** `npx vitest run src/components/kitchen-board-live.test.ts src/lib/use-live-resource.test.ts`；首次缺module可red，接入後再以browser觀察舊response覆寫復現與修正，不只測空wrapper。
- [ ] **實作 adapter 與接入。** KitchenBoard每個stall一個lifecycle，卸載／切店立即stop；load傳signal，401/403清除資料並停可寫操作，429轉`LiveResourceRetryError`，非JSON顯示本地化錯誤。stream失敗保留polling，ready補讀snapshot，visibility回來更新。只有確實套用的新snapshot才呼叫既有alert reconcile，避免重複音效；時鐘interval可保留但不是狀態version。manual refresh／mutate後refresh走同一controller。
- [ ] **green。** 上述 unit；`npx playwright test -c playwright.responsive.config.ts e2e/kds-production-board.spec.ts --workers=1`，追加桌機與平板state測試；確認KDS-only角色仍不能拿Staff stream或顧客電話／付款DTO。若共用resource要改，同批跑Staff live、public tracker regression。
- [ ] **提交。** 精確 stage A5，commit `fix: reconcile kitchen snapshots through guarded live lifecycle`。

### Task 6: A6：同單閉環、失敗恢復及安全回歸

**Files:** A6；修改 `e2e/catalog-operations-local.spec.ts`、`e2e/customer-order-functional-qa-local.spec.ts` 及下面列明的五個LINE integration檔之測試目標guard；沿用 `scripts/responsive-qa-target.mjs`。原CI／其他lab防護不變。

**Interfaces:** 消費 A1 fixture、A5 lifecycle；所有測試使用真實本機API與DB。失敗注入專門suite只控制時序／錯誤，與無mock正常閉環證據分開。舊LINE database/browser runner不呼叫：它固定55722/3024且屬另一lab。

- [ ] **補 red 整合案例。** `responsive-state-recovery.spec.ts` 覆蓋：(1) same idempotencyKey首次201／重送200同ID且一筆payment/usage，(2) server PAID回應遺失→查原attempt→列印失敗只重印，(3) desktop售罄→手機舊cart422仍保留有效項目，(4) 401/403撤權與換人不可讀前會員／門市，(5) 409衝突讀回新快照，(6) 429 obey Retry-After、HTML500與timeout安全恢復。
  ```ts
  expect(replay.orderId).toBe(created.orderId);
  expect(await prisma.order.count({ where: { idempotencyKey } })).toBe(1);
  expect(afterRetry.paymentCount).toBe(beforeRetry.paymentCount);
  expect(afterRetry.usageEventCount).toBe(beforeRetry.usageEventCount);
  ```
  LINE owner/pickup在獨立fixture合成測：雙店owner、失效／已用／cancel-race、preview不redeem、原子只交付一次；不傳真訊息。服務 integration 使用下列五個既有檔案：`src/server/line-platform/member.integration.test.ts`、`pickup.integration.test.ts`、`notification.integration.test.ts`、`fulfillment-event.integration.test.ts`、`src/server/payment-providers/line-platform-payment.integration.test.ts`。其原有55722／指定DB guard全部保留；只加 `RESPONSIVE_QA_RUN=true` 分支，调用 A1 guard，並額外要求 `LINE_PLATFORM_TEST_DATABASE_URL === DATABASE_URL`。先測遠端、55722或URL不一致即拒絕，再用56822執行；絕不把 guard 改成任意 localhost 都可。以 `npx vitest run --maxWorkers=1` 明列這五檔，skip數須0，不能設定URL後盲跑其他硬編不同lab的suite。provider HTTP仍為mock，通知只在stub邊界接受，不能接真OA。
- [ ] **執行 red。** 先以上新spec及A1 roundtrip；再選原 `catalog-operations-local.spec.ts`、`customer-order-functional-qa-local.spec.ts` 固定埠guard加本輪exact mode branch，原模式完全保留。大範圍delete setup只有獨立DB可執行。不要直接跑全部test:e2e讓config誤指原lab。
- [ ] **只修證明的前端缺陷。** 不改價格、交易權威、租戶或新版schema；若證據表明缺backend contract，列明blocked case與影響，继续無關本機項目，不用前端補丁冒充一致性。
- [ ] **驗證完整切片。** `npx playwright test -c playwright.responsive.config.ts e2e/responsive-order-roundtrip.spec.ts e2e/responsive-state-recovery.spec.ts e2e/customer-order-functional-qa-local.spec.ts e2e/catalog-operations-local.spec.ts e2e/staff-kds-print-closure-flow.spec.ts e2e/multi-stall.spec.ts --workers=1`。包括四組KDS／print flag、外帶／外送確認前改項、跨租戶與同org不同店；視case timeout合理拆批，不把skip算PASS。`npx supabase --workdir C:/Users/KY/.codex/local-labs/stallorder-responsive-20260930 test db` 必須連本輪project並涵蓋multi_stall_rls、operational_realtime、kds_production_board。DBtests可查回滾，不更動正式schema。
- [ ] **記錄與提交。** 同orderId跨四端狀態、原單/付款/用量count、測試總數與skip、資料庫target、候選SHA＋patch hash、截圖脫敏。stage受影響tests／修正／`verification-matrix.md`，commit `test: verify responsive order recovery and tenant boundaries`；轉 B 計畫，尚不宣稱整體改版完成。
