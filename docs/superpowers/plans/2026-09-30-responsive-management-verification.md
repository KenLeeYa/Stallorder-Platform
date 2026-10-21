# Responsive Management and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Merchant／Admin 在手機、平板與桌機保留完整授權任務，完成整體跨裝置回歸及可比較證據。

**Architecture:** 沿用 MerchantWorkspaceHeader、WorkspaceFunctionNavigation、現有卡片／表格和 server 權限；每頁按內容容納能力組合介面。B1、B2 各自可交付；共用 A1 的隔離環境及 A2 的 Dialog，最後 B3 驗整條候選分支。

**Tech Stack:** 現有 Next.js 16.3.4／React 19.2.4／Tailwind 4、Prisma／Supabase、Vitest／Playwright／axe；不新增框架或套件。

**Spec:** [核准設計入口](../../ux-responsive/current-state.md)、[裝置矩陣](../../ux-responsive/device-role-matrix.md)、[效能／AA](../../ux-responsive/accessibility-and-performance.md)、[回退](../../ux-responsive/release-rollback.md)。先完成 [A 計畫](2026-09-30-responsive-order-workflows.md)；A1 的目標 guard 與唯一 writer 同樣適用。

## Global Constraints

- 全部 API、RBAC、org/stall scope、step-up、操作理由與 audit 契約不變；CSS 隱藏不是授權。不存在的 provider 操作不因改 UI 被啟用。
- 320、360、390、768、820、1024、1280、1440 CSS px；200%實際zoom、200%文字與320等效reflow分別記錄；明暗、繁中＋至少一個現有非中文。
- Merchant 平板／桌機完整圖示列，手機主要圖示＋所有功能；Admin ≥1280 搜尋側欄，窄版保留全部功能可到達。主要操作不得必須橫捲才找得到。
- 命中區 ≥44×44；現場主動作48px；不複製新token系統，不新增裝飾圖表，不憑空算未知報表指標。
- 設定清楚顯示組織／門市、狀態與儲存結果；平台單一 OA、各店Pay連線分開。API接受通知不等於装置收到；正式Pay仍依既有 gate。
- 改造前後使用同環境、fixture與樣本方法；沒有實機／人工作業測量就標NOT_RUN，不以桌機emulation冒充。
- 本機 scope；既有3023/55722保持不動。完成後依服務lifecycle停止不用的本輪程序，保留資料；無新排程、Production或LINE設定異動。

## Review Focus

1. 商品 editor 開著時旋轉，草稿、焦點與close路徑要保留；不可兩份 editor 同時寫設定：B1。
2. 暫停／售罄後切門市，新頁不能沿用上一店成功提示或草稿：B1。
3. 方案版本1740px表與申請審核1320px表在平板，操作及所有欄位仍可到達：B2。
4. 手機深連結與無step-up的敏感操作不能靠新卡片繞過原權限：B2。
5. 100+單、長店名／越文與200%zoom下，稽核計算可見命中區，不能把隱藏節點或擴充套件算產品缺陷：B3。

---

## 檔案與責任

| 任務 | 修改來源 | 新增／既有測試 |
|---|---|---|
| B1 Merchant | `src/components/merchant-products.tsx`、`merchant-workspace-header.tsx`、`workspace-function-navigation.tsx`、`shared-catalog-manager.tsx`；報表現況未過時才改 `multi-stall-dashboard.tsx`／`src/app/merchant/reports/overview/page.tsx` | 新 `e2e/responsive-merchant-workflows.spec.ts`；既有 merchant navigation／report tests |
| B2 Admin | `src/app/admin/merchant-applications/page.tsx`、`plan-versions/page.tsx`、`e-invoice/page.tsx`、必要的 `src/components/admin-billing-header.tsx`／`globals.css`容器規則 | 新 `e2e/responsive-admin-workflows.spec.ts`；原授權負例 |
| B3 整體驗證 | `e2e/responsive-route-matrix.spec.ts`；新 `e2e/responsive-accessibility.spec.ts`；八份 `docs/ux-responsive/*.md`、changelog、service lifecycle | 所有A/B測試；實機checklist與效能收據 |

新增文字依現有 `src/lib/messages/merchant.ts`、`admin.ts`、`reports.ts`、`workspace-navigation.ts`、`management-experience.ts` 補各語系。不要另建新的翻譯提供者。

### Task 1: B1：Merchant 完整功能與可恢復的管理流程

**Interfaces:** `MerchantWorkspaceHeader` 繼續使用 `workspaces/displayName/routeContext/showBilling/showGrowth?/showPayments?/showSupply?`；`WorkspaceFunctionNavigation` 消費 `readonly WorkspaceFunction[]`，每項既有 `href/label/icon/group/primary?`。授權 destinations 在原上層過濾。`MerchantProducts(props: Props)` 現有 `requestOrderingUpdate(body)` 与 `closeCatalogDialog(): void` 保留；editor只掛載一次，不以換view重建草稿。返回沿用 `resolveMerchantBackNavigation(BackNavigationInput): MerchantBackNavigation | null`，不能新增任意外部return URL。

- [ ] **寫 red E2E。** `responsive-merchant-workflows.spec.ts` 測 `tablet shows all authorized functions without directory button`、`mobile editor traps focus and restores trigger`、`rotation preserves unsaved catalog selection`、`sold-out scope survives refresh and rejects stale customer cart`、`report filters and export preserve scope`。
  ```ts
  await expect(allFunctionsButton).toBeHidden(); // 768/820/1024/1440
  await expect(allFunctionsButton).toBeVisible(); // 390
  await page.keyboard.press("Escape");
  await expect(catalogTrigger).toBeFocused();
  expect(exportedStallIds).toEqual([authorizedStallId]);
  expect(exportPeriod).toEqual(selectedPeriod);
  ```
  開editor修改尚未儲存→390→1024→390不丟draft；Tab只在active dialog；子視窗Escape不關父。切店清掉上一店提示；純員工MANAGE_STALL不足，直接PATCH仍403。LINE／Pay頁呈現真實capability，不能顯示「正式已啟用」。
- [ ] **跑 red。** `npx playwright test -c playwright.responsive.config.ts e2e/responsive-merchant-workflows.spec.ts --workers=1`。報表現有資料期間／更新時間若已正確，保留；不要單憑來源未看見某字就改。
- [ ] **實作最小差異。** header沿既有responsive navigation，全圖示時仍有文字替代／鍵盤；長label可讀。MerchantProducts統一close path、visible controls Tab循環與頂層Escape；跨768清除modal鎖但同一StallCatalogSettings instance不卸載；背景非dialog控制在modal期間不可取得焦點，關閉恢復。商品匯入預覽加可讀錯誤/列詳情與固定可到達提交，不複製匯入業務。報表只補實際欠缺的期間／時區／更新與資料定義／缺值說明；數字及匯出依原server結果，不製造出餐時間或失敗率資料。
- [ ] **驗 green與相依面。** 上述E2E＋`e2e/merchant-stall-settings-navigation.spec.ts`、`e2e/operations-report-filter-responsive.spec.ts`。`npx vitest run src/components/merchant-workspace-header.test.ts src/components/merchant-workspace-header.layout.test.tsx src/lib/merchant-back-navigation.test.ts src/components/merchant-report-layout.test.ts src/components/merchant-report-behavior.contract.test.tsx`。檢查新儲存後讀回與另一顧客端，不只toast。
- [ ] **提交。** 逐檔stage B1實際修改，commit `feat: preserve merchant workflows across device layouts`；記錄before/after與授權负例。

### Task 2: B2：Admin 寬表可讀與安全應急操作

**Interfaces:** 現有 `listMerchantApplications(parseFilters(query))`、`getAdminPlanCatalog()`、`getAdminEInvoiceData()` 回傳及 `searchParams` 不變。使用同一資料陣列產生table/card，卡片明細含所有欄位；現有detail route／callback／step-up及理由原封沿用，不新開管理API。頁面內呈現小函式即可，不為三種不同資料型別造泛用table框架。

- [ ] **寫 red。** `responsive-admin-workflows.spec.ts`：`application review action stays visible at tablet width`、`plan version details retain all billing fields`、`invoice monitor remains read-only`、`direct admin URL and sensitive action reject lower roles`。至少768／820／1024／1440＋390：
  ```ts
  expect(actionRect.right).toBeLessThanOrEqual(viewportWidth);
  await expect(recordDetails).toContainText(expectedTaxTreatment);
  await expect(recordDetails).toContainText(expectedContractHashPrefix);
  expect(nonAdminResponse.status()).toBe(403);
  expect(auditAfterDenied).toEqual(auditBeforeDenied);
  ```
  依實際原安全入口401/403/404選固定預期，不把任意非200都算通過。篩選、資料期間、分頁與返回維持；不存在的sort/export不新增，但現有操作不得在卡片丟失。敏感讀／匯出依原step-up測缺證據→拒絕、有合法本機fixture→原允許與audit；不測真退款。
- [ ] **跑 red。** `npx playwright test -c playwright.responsive.config.ts e2e/responsive-admin-workflows.spec.ts --workers=1`；先量**內容容器**而非整個viewport。現有max-w-7xl即使大螢幕也不夠1740px，不能只把md改xl。
- [ ] **最小實作。** 申請列表／方案版本保留原cards，補缺欄位的可展開詳細資料；內容不足時卡片為預設。可保留明示的完整比較表（局部二維scroll），但審核主動作和金額summary留在可見範圍；不得用全頁橫滑。電子發票連線表補手機key/value且保持LOCAL_MOCK_READY/唯讀真實狀態。Admin側欄／breadcrumb使用既有元件；手機不繞過任何安全門檻。新語句同時翻譯。
- [ ] **green。** 上述E2E和A6 tenant negative皆PASS；keyboard可展開／關閉／返回；200%文字放大時敏感確認完整可讀。若觸及共用Navigation再跑Staff/Merchant主要入口；不能因新視圖讓低角色收到更多DTO欄位。
- [ ] **提交。** 只 stage B2，commit `fix: keep admin record details and actions accessible on narrow screens`。

### Task 3: B3：整合、效能、無障礙與人工測試入口

**Interfaces:** 沿用 A1 `assertResponsiveQaTarget`、fixture及單worker runner；`responsive-route-matrix.spec.ts` 擴到八寬度及必要Admin/MINI合成入口。測量输出沿 `artifacts/ux-responsive-20260930/` receipt結構，加候選SHA、patch hash、fixture/runId、實際方法、樣本及pass/failed/blocked/not_run/skipped。不新增遠端telemetry或外部服務。

- [ ] **新增可失敗的驗收案例。** `responsive-accessibility.spec.ts` 覆蓋核心6角色、明暗、繁中／英文或越文、100+合成訂單、長品名／備註、空／部分成功、keyboard/reduced motion與axe。八尺寸先確認操作可達，再量可見且未遮擋rect，不只scrollWidth。
  ```ts
  expect(documentWidth).toBeLessThanOrEqual(clientWidth + 1);
  expect(visiblePrimaryRect.height).toBeGreaterThanOrEqual(48);
  expect(visibleIconRect.width).toBeGreaterThanOrEqual(44);
  expect(axeResults.violations.filter(v => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  expect(canReachLastErrorAndSubmit).toBe(true);
  ```
  無嚴重axe並不自動等於AA合規，還要人工對比、焦點、zoom與screen-reader。不可把隱藏popover、devtools／第三方擴充浮層納入命中區統計。
- [ ] **同候選完整跑驗收。** `npm run typecheck`、`npm run lint`、`npm test -- --exclude=artifacts/**`（不設定LINE database opt-in，真DB五檔另跑）、本輪Playwright config全部列入suite、A6 realDB integration與lab `test db`；每一個exit code和skip理由記錄。先停本輪dev／確認無同`.next`consumer，再`npm run build`與`npm run performance:bundles`，不能在3023工作樹build。失敗用systematic-debugging回到責任任務；修後重跑受影響面，不反覆重跑已穩定無關suite。
- [ ] **做真實瀏覽器及可比較量測。** 使用本輪production-mode build啟動3026，env仍local mock且無外部金鑰。與A1未改版候選使用相同seed快照／time、機器及network；不要把3023的dirty歷史截圖當效能before。既有 `scripts/measure-response-time.mjs` 設 `PERFORMANCE_BASE_URL=http://127.0.0.1:3026`、`PERFORMANCE_RUNS=30`、本機測試帳號、生成的QR與staff/kitchen/report路径、獨立output路徑；執行前確認腳本實際指標，沒有INP就不能以response time替代。冷／暖可互動及API各30筆，LCP/INP/CLS lab互動各5輪，raw樣本、中位/p95/錯誤率與bundle列before/after。首次基準後在`accessibility-and-performance.md`記資料導出的改善目標，不倒填通過門檻。性能差異小於測量噪音就報無可判定改善。
- [ ] **人工能力分項驗證。** Chrome與Edge实际200%zoom、200%文字、1280桌面400%zoom的320等效reflow；不是單純改viewport或deviceScaleFactor。每角色主要任務5輪的人工作業時間／點擊／回退／誤觸另記，automation時間不能冒充。可用實機測iPhone/iPad Safari及Android Chrome的旋轉、鍵盤、safe-area和觸控；NVDA/VoiceOver做讀序、錯誤與dialog smoke。取得不到的環境維持NOT_RUN，集中提供待驗清單及測試步驟，不阻止已可驗證項目。
- [ ] **收尾、回退與交付。** 每批保留commit；發現回歸只回退該批檔案／commit，保留原單/付款/printjob與audit，不還原DB。更新八份文件、changelog（依真實QA進度變更狀態）、服務清單、未測外部項目及前後截圖。保留一個人工測試入口3026及本輪DB若使用者持續手測，其餘本輪runner/functions/mock按相依關係停止並讀回；不刪容器/volume。原3023/55722不受本次清理。查核既有正式站匿名登入／健康／Primary狀態，與開始時read-only收據分開報告；未做正式交易不要宣稱完整prod驗證。
- [ ] **提交與完成報告。** 逐檔stage B3測試／docs，commit `test: record cross-device accessibility and workflow verification`。報告分列 LOCAL_VERIFIED、STAGING_VERIFIED、PRODUCTION_APPROVED、PRODUCTION_OBSERVED；必要本機案例未通過不可標整體完成；實機、LINE真訊息、PaySandbox與紙本／錢櫃獨立標示，既有歷史實測不算新版PASS。
