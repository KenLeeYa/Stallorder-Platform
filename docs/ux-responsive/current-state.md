# 跨裝置改版：現況與設計審閱入口

日期：2026-09-30（Asia/Taipei）。本節保留當時的設計／改造前盤點：**Design approved；當時尚未進入產品實作**。後續本機實作與 B3 合併候選狀態見 [B3 證據索引](b3-final-qa-evidence.md)；不可把這份早期盤點當作目前未實作的結論。

## 本輪依據與版本

完整閱讀 `StallOrder_Responsive_Cross_Device_UI_UX_Codex_Prompt_20260929.md`，原檔位於使用者 Downloads；SHA256 `3f3e98b05fcec9bb0dde1b8a1f93a4359d849936464b5db5e812c3d39c32dcbf`。本資料夾是本輪設計，並非新版已完成的證明。第 13 節要求先完成唯讀盤點、書面設計與相應 Gate，再實作。

| 範圍 | 2026-09-30 讀回事實 | 證據用途 |
|---|---|---|
| 原專案 | `C:/Users/KY/Documents/Codex projects/Stallorder-Platform`；detached `d506ff58e538bcca72045302ddca291ec85ab91b`，有既有未提交修改 | 保留；不在此混入改版 |
| 候選程式／本文件 | `C:/Users/KY/.codex/worktrees/line-miniapp-pay/Stallorder-Platform`；`codex/line-platform-oa-v2-20260927`；`fb3974155a4cec2288168711acdc6306d8350fd2` | 本輪原始碼事實；PR #365 尚為 Draft/Open |
| 正在服務的 3023 | `C:/Users/KY/Documents/Codex projects/Stallorder-Platform-ui-ux-redesign-20260923`；`codex/ui-ux-redesign-20260923`；HEAD `766df1e217f9418739f6f907e9f4113fd02e3436` 加既有 dirty 修改 | 本輪改造前瀏覽器畫面；**不是 fb397415 候選驗證** |
| 本機服務 | listener PID 49312 → Next PID 31984 → launcher PID 15756；DB `supabase_db_stallorder-catalog-ops-20260907`，55722 | 使用者保留的人工 QA 環境；本輪未啟停服務、未重置資料 |
| 正式站唯讀基線 | Primary project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`；deployment `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`；SHA `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`；`app.qidaigo.com` verified | `/login`、`/staff/login`、`/store/viet-food-yc` 200；health 匿名 401；availability PRIMARY；不等於登入後訂單流程驗證 |

正式基線收據：`../../artifacts/ux-responsive-20260930/production-baseline.json`。候選與 3023 工作樹均無 `.codegraph`，使用直接原始碼盤點；原專案的索引不能替代候選程式，不重新建立索引。

現有技術：Next.js 16.3.4、React 19.2.4、TypeScript、Tailwind 4、Prisma 6.19、Supabase、Lucide。保留現有元件及資料層；不為本輪引入新 UI framework。

## 審閱順序與推薦決策

1. [角色／裝置方案比較](device-role-matrix.md)：建議 B，共用訂單與任務模型，組合角色介面；保留平板／桌機三欄預設。
2. [互動規格](interaction-spec.md)：主動作、焦點、返回、衝突與未知付款。
3. [共用元件](design-tokens-and-components.md)、[跨裝置狀態契約](cross-device-state-contract.md)。
4. [無障礙／效能](accessibility-and-performance.md)、[驗收矩陣](verification-matrix.md)、[發布／回退](release-rollback.md)。

使用者於 2026-09-30 回覆「核准」，本份設計 Gate 已完成。當時依 `writing-plans` 整理[兩份分批實作計畫](../superpowers/plans/2026-09-30-responsive-cross-device.md)，尚待審閱與選擇執行方式；後續實作與 QA 依本頁末段的 B3 收據為準。未把未完成測試填成通過。

## 真實入口盤點

下列路徑相對候選工作樹；行號對應上述 SHA。`SOURCE_OBSERVED` 為原始碼盤點；`BROWSER_BASELINE` 是 3023 現況，不是候選完成證據。

| 入口／任務 | 權威資料／權限與元件 | 現況與斷點 | 狀態 |
|---|---|---|---|
| `/q/[qrToken]` 掃碼點餐 | `src/app/q/[qrToken]/page.tsx:43`；cached public menu → LazyQrOrderFlow；安全 QR/session/device 契約 | 共用 controller/presentation；不是另一套下單核心 | SOURCE_OBSERVED；本輪有效 QR 完整任務待測 |
| `/store/[identifier]?view=menu/pickup/delivery` | `src/app/store/[identifier]/storefront-page.tsx:157` PublicMenuView／QrOrderFlow | 公開 Menu 僅菜單；外帶／外送才進原點餐流程；不能把只讀菜單當購物車 QA | Menu BROWSER_BASELINE；外帶切換一次未完成導航，未判定根因 |
| 客製／購物車／結帳 | `qr-order-flow-presentation.tsx:351,481,498`；`qr-order-menu.tsx:103,175,201,233` | 768 起菜單＋340px 購物車；手機 88dvh sheet、底部份數總額、safe area；客製已有 focus lifecycle | SOURCE_OBSERVED；金額／重送／錯誤恢復待新候選實測 |
| 一般訂單追蹤 | `public-order-tracker.tsx:651`、public tracking API；長 token＋device hash | 3 秒輪詢、AbortSignal、429 Retry-After；付款／製作狀態分離 | SOURCE_OBSERVED |
| `/mini`、`/mini/orders`、會員／協助／訂單 | 平台會員 owner + environment；`member-service.ts:22,83` | 既有 MINI 殼層；訂單每 15 秒可見時 refresh；不是 SSE | SOURCE_OBSERVED；Preview 已清理，不重用歷史實機 PASS |
| `/staff/[stallSlug]` 接單／搜尋／交付 | page `VIEW_ORDERS`；StaffOrderBoard controller/presentation；命令 `UPDATE_ORDERS`＋CSRF＋stall scope | 768 起三欄獨立捲動；手機篩選可收合／完整訂單卡片；搜尋在上方功能列 | BROWSER_BASELINE；原始碼 SOURCE_OBSERVED |
| Staff 新工作台 flag | staff page:80 → `getStaffWorkspaceRedesignEnabled`；`feature-flag-service.ts:143` 預設 false；rollout:7–13 fail closed 回 legacy | 不能看見新工作台原始碼就推定啟用；3023 只確認三欄外觀，未獨立讀回 flag 值 | 兩條 renderer 都列入回歸；flag 實值 UNKNOWN |
| Staff POS | `CREATE_ORDERS`；`staff-order-composer.tsx:871,937,1069,1146` | 768 起商品＋360px 訂單；手機有總額底列；折扣／快捷實收同列；多個手寫 role=dialog | BROWSER_BASELINE；空草稿開關，未建單／收款 |
| `/kitchen?stall=…` | page:20–37 `VIEW_KDS`；task API `UPDATE_PRODUCTION_TASKS`；安全 DTO 不含電話／付款金額 | 訂單模式 768 起三欄；品項模式 640 起兩欄、1280 起三欄 | BROWSER_BASELINE；未更新製作任務 |
| `/staff/[stallSlug]/print`、cash、floor | 既有對應 server permission；列印、開櫃、重印與付款是分開任務 | 保留裝置能力提示；原生 Star transport 不等於一般 Chrome 可列印 | SOURCE_OBSERVED；硬體 NOT_RUN |
| `/merchant/dashboard` | requireWorkspacePage/org；VIEW_REPORTS；getDashboardOverview | MultiStallDashboard；依門市授權彙總，不由 CSS 篩權限 | SOURCE_OBSERVED；瀏覽器基線見收據 |
| `/merchant/[stallSlug]`、`/merchant/catalog` | MerchantProducts；workspace/org scope；SharedCatalogManager | 商品管理 768 起 340px 設定＋商品；手機 dialog；匯入預覽仍有寬表格 | SOURCE_OBSERVED |
| `/merchant/stalls/[stallId]`、products、schedule、capacity | `MANAGE_STALL` 及分項權限；原門市設定／庫存服務 | 售罄、營業、門市範圍可見；長設定不再層層 accordion | SOURCE_OBSERVED；儲存／跨裝置同步未測 |
| `/merchant/team` | requireWorkspacePage/org、MANAGE_STAFF；OrganizationMembership/InvitationManager | 單攤／多攤 scope 不同，保留 server 校驗與邀請流程 | SOURCE_OBSERVED；不調整員工權限 |
| `/merchant/reports/*` | requireReportScope；Prisma／report-data；時區、日期範圍與五筆分頁 | 多處已有手機 metric cards／篩選；不能整套重寫 | SOURCE_OBSERVED |
| `/merchant/stalls/[stallId]/line` | MANAGE_LINE_INTEGRATION；舊 LineIntegrationManager | 舊店家設定頁存在；**不代表平台 v2 改回各店 OA 發訊** | SOURCE_OBSERVED；不得擅自重啟舊通知 |
| `/merchant/payments` | MANAGE_PAYMENT_INTEGRATIONS＋module visibility；PaymentIntegrationManager／LinePlatformPaymentOperations | 各店獨立 connection；LINE v2 adapter 只允許 local/preview Sandbox | SOURCE_OBSERVED；正式 Pay 未啟用 |
| `/admin/*`、merchant-applications、plan-versions、e-invoice | `admin/layout.tsx:16` 平台管理權限；各 service 再驗證 | 1280 起搜尋側欄；手機已有多處卡片；部分表格最小寬 1320／1740px | SOURCE_OBSERVED；不得把藏按鈕當授權 |
| `/admin/health`、`/admin/line-platform` | 各 page 明確 requirePlatformAdminPage；health snapshot／notification dashboard | 僅診斷／通知真實狀態；不改 DR 獨立維運登入 | SOURCE_OBSERVED；正式診斷匿名401讀回 |

## 已觀察差距

| ID | 嚴重度／證據 | 影響與最小修正方向 |
|---|---|---|
| RSP-01 | P1，3023 手機 360／390：查看明細與完成訂單高 36px，取消約42px | 提升命中區；不縮小文字來塞入同列 |
| RSP-02 | P1，3023 空 POS 在關閉按鈕上按 Escape，dialog 仍1個；點關閉後0個 | 共用 dialog 生命週期、焦點進入／返回／Tab邊界；不改結帳邏輯 |
| RSP-03 | P1，768×1024 三欄約 211／294／200px；整頁寬753，沒有頁面溢位 | 三欄保留；明細可展開專注檢视；200%重排另驗，不能以沒有 overflow 當可讀性通過 |
| RSP-04 | P1，SOURCE_OBSERVED：KDS 每次 fetch 直接 setData，12秒輪詢與SSE並行 | 先重現慢舊請求覆蓋／門市切換，再復用 lifecycle guard；未證明已發生資料錯誤 |
| RSP-05 | P2，SOURCE_OBSERVED：商品 dialog Escape 不走焦點返回路徑、無Tab循環 | 統一close path；新增鍵盤回歸 |
| RSP-06 | P2，SOURCE_OBSERVED：管理表格從768切換但1320／1740最小寬 | 保留卡片至內容能容納；每張卡有明細與所有原操作 |
| RSP-07 | P2，3023 公開 Menu 點外帶一次後 URL 仍menu；本輪未診斷 | 先在固定候選重現導航，區分hydration／route／環境；不得宣稱顧客閉環已通過 |

瀏覽器為 Windows Chrome 桌面 viewport override，非 iPad／iPhone／Android 實機。第三方瀏覽器擴充浮層存在於截圖右侧；不把擴充元素算成產品控制項。已保存公開菜單、Staff、POS空草稿、KDS、Merchant、Admin各五尺寸，共30張改造前截圖：[截圖與收據索引](../../artifacts/ux-responsive-20260930/README.md)。原圖尺寸及CSS要求尺寸分別記錄；首次批次畫面重排時序問題已重新擷取，不作產品缺陷。只保存測試商品、測試單與本機測試帳務摘要，沒有真實付款、個人 token 或會員識別截圖。

## 待補的基準

此輪沒有執行完整交易，因此 task completion time、完整任務點擊數、誤觸率、API p95、LCP／INP／CLS、bundle 前後比較均 **NOT_RUN**。3023資料含143筆歷史測試單；逾時分鐘數不是營業表現。新候選需固定 fixture/time 建立可比較基準，不修改既有手測資料。

採用 skills：brainstorming（設計Gate）、Matt Pocock codebase-design（沿用共用資料/元件邊界）、product-release-qa 與 stallorder-product-qa（證據／角色／回歸）、瀏覽器提供的 local-web-development/viewport 能力。兩個實際只讀 agent 分別盤點UI與狀態；未授權其改檔或部署。writing-plans、TDD、systematic-debugging、verification-before-completion 於各自階段再使用；不因技能名稱而更換 UI library。

設計已完成兩個只讀角色審閱並修正來源路徑、未實作undo的錯誤承諾、pending付款關閉界線、stream ready補快照、旋轉測試入口及400% reflow案例。文件引用存在性檢查通過；這些都不是新版功能QA。候選 `src/prisma/package` 無未提交差異。正式站結束前匿名入口／PRIMARY狀態仍與基線一致；未操作登入後正式交易。

## B3 本機候選狀態（2026-10-01）

B3.1 完成具體 UI/焦點/原生 zoom 修正；B3.2 配對效能全部 11 項預先登記的時間目標未達成。B3.3 完整同序 129 案最後一輪為 `9d6d926`／build `2_SDNG-0WPqKN2eo0RvJE` 的 128 PASS／1 pretest FAIL；唯一下游來源收據工具已在 `951da26`／build `JkhAOmjpcVnrPc59NHe-l` 以真 Edge #84 與六個受影響消費者聚焦通過，並未另跑 129 案整批。結果與原始 110/16/3、95/8/26 失敗歷史以[合併 QA 索引](b3-final-qa-evidence.md)為準。原始 3023／55722 與本機 3026／56822 是不同服務與資料集。此本機證據不代表 Staging／Production、實體裝置、輔助科技、真 LINE／Pay 或人工時間已驗收。
