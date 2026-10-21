# UI/UX 本機驗收紀錄

日期：2026-09-23，Asia/Taipei。基準 `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`，候選分支 `codex/ui-ux-redesign-20260923`。下載需求全文 SHA-256：`7E5E4AF39E50C80640EC5BB38A8196CFAF68B99CC28FFCE73C9D85B24DE7956D`。

## 結論與邊界

本輪優先實作的訂單清單、商品供應、顧客欄位、導覽、長者模式與儀表板恢復流程已通過本機驗證。沒有發布或修改正式環境；這不是 111 頁、所有外部服務與實機的完整認證。Phase 00–15 的實作、沿用、設計提案及缺口分列於 [交付對照](phase-delivery-map.md)。

來源保留在獨立 worktree；原工作樹的既有修改未被覆寫。沒有資料庫 migration、交易 API、付款／列印權限或 DR writer 變更；全面續作只為 StaffOrderDto 加入既有 origin 的唯讀相容欄位。只新增開發用 axe 依賴，沒有 runtime UI framework。

本輪完整證據目錄：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/ui-ux-redesign-20260923`。以下檔名均相對於該目錄；截圖精選另隨 Git 保存在 `docs/ui-ux/screenshots`。

## 全面續作：本次最終驗證

續作以首輪候選 `896ab68` 為起點；範圍與原因見 [完整續作](full-redesign-continuation.md)。本節為本次交付結果，較下方首輪紀錄保留為歷史。證據位於前述目錄的 `full-redesign/`。

### 靜態、單元與建置

| 命令 | 最新結果／artifact |
|---|---|
| `npx tsc --noEmit --incremental false` | exit 0，typecheck-complete.log；最後搜尋長度屬性亦由 build TypeScript 再驗 |
| `npm run lint` | exit 0；0 errors、5 個既有 warnings，lint-final.log；均在未修改的 public-order-tracker／reorder-review／session-keep-alive |
| `npm test -- --maxWorkers=2 --reporter=json --outputFile= "<evidence>/unit-final.json"` | **3,340 passed、0 failed、9 skipped**；unit-final.json/log。九個 A/B runtime 案例仍未列為通過 |
| `npm run ui:audit` | 337 TSX 檔案通過；初跑發現三個新搜尋框缺少 maxLength，補 160 字上限後通過；ui-audit-before-input-limit.log、ui-audit-final.log |
| `npm run build` | exit 0，含 TypeScript 與靜態頁建置；build-final.log |
| `npm run performance:bundles` | 八個 route entry 預算全部通過；bundles-final.log |
| `git diff --check` | 無 whitespace error |

### 最新瀏覽器流程

共同環境為 `UI_UX_QA=true`、`PLAYWRIGHT_APP_URL=http://127.0.0.1:3023`、`PLAYWRIGHT_REUSE_EXISTING_SERVER=true`；命令為 `npx playwright test <spec> --workers=1 --reporter=list,json`。供應套件另設 `LOCAL_CATALOG_AMENDMENTS_QA=true`；截圖另設 `UI_UX_CAPTURE=true` 與 `UI_UX_ARTIFACT_DIR`。每份 JSON config 保留實際檔案及 grep。

最新按檔名／案例去重後 **33 passed、0 unresolved failed、0 skipped、0 flaky**，見 `browser-case-index.json`。這是本次受影響案例，不是全站所有功能認證；不把同一案例重跑相加。

| 套件及證據 | 覆蓋 |
|---|---|
| ui-ux-navigation-local、operational-switcher-permissions、report-overview-mobile；navigation-ready.json＋flows-final.json 的目錄重測 | 九例：分組搜尋／無結果／Escape／tenant context；平台側欄、訂閱卡片／表格分頁；篩選重整；禁止 Storage 仍能登入操作；聲音首次開關；實際 CSV 下載及範圍／取消確認；三介面明暗 axe |
| ui-ux-accessibility-local、ui-ux-authorization-local、ui-ux-baseline-local、ui-ux-recovery-local、ui-ux-workflows-local；core-ready.json＋flows-final.json＋kds-capture-final.json | 九例：五頁明暗、六語 dialog、撤權及 401/403/404、35 張截圖、重入／429／500／離線、查詢亂序、105+ 訂單分頁／來源／長者／列印範圍、商品儲存及 409 |
| catalog-availability-amendments-local；flows-final.json | 六例：跨日／期限／永久下架與庫存、原單增刪／價格／冪等、列印中及失敗可改單、製作／庫存不足整筆 rollback、三裝置供應設定、QR 舊購物車、含必選客製改單 |
| product-note-groups 的「QR 註記選擇會」、qr-edit-local-flow；flows-final.json | 三例：搜尋／必選群組定位、真實客製下單價格 90、追蹤與店員核對；QR 原單修改／取消；外帶錯誤聚焦、保留姓名電話餐具與取消結果 |
| staff-kds-print-closure-flow；kds-capture-final.json＋closure-hydration-final.json | 五例：無 KDS／列印可結帳、外帶完成可取餐、成功列印自動結單、失敗／重印復原且不重複收款、公休公告及阻擋 QR |
| ui-ux-rollout-local；flows-final.json | 一例：管理者 STALL 啟用／回退、匿名／店員拒絕、訂單及付款狀態不變、audit；最後保留示範攤位啟用，全域 false |

初次失敗保留：core-ready 為 7 passed／2 failed；navigation-ready 為 8 passed／1 failed。來源常數改用真實 LINE_DELIVERY 後通過；撤權／目錄冷編譯逾時重測並核對實際回應。flows-final 為 13 passed／1 failed／4 not run：舊 KDS 測試需先展開「所有功能」才能切模式，調整入口後保留全部交易斷言再驗。

kds-capture-final 為 5 passed／1 failed，公休 SSR 首次點擊被丟棄。延後 Next JS 的確定性重現 `closure-hydration-repro.json` 先因按鈕仍 enabled 失敗；產品改為 clientReady 前 disabled 後，`closure-hydration-final.json` 完整通過新增、公休公告、禁止下單及刪除。測試自身路由清理的 Route already handled 另存 closure-hydration-before，不算產品修復證據。

沒有以 sleep／重複點擊掩蓋問題，亦未移除交易／列印／權限斷言。最後原生搜尋 maxLength 由控制項稽核及建置核對，不改搜尋條件或 API。CUA 附加既有分頁遇 Debugger unattached；UI 證據來自專案 Playwright，未冒稱人工 CUA 驗證。

### 最新成對效能與無障礙

功能 QA 增加保留資料後，以基準 3024 再拍一次（baseline-capture-final.json 通過）。基準／候選皆為 **130 筆在案訂單、95 個商品**，同一訂單 id/status SHA-256 `94ec10c22345cd298fe3b993e8f60f3b1fb18d12eae3180e99b84e545423ed30`。五頁 × 七寬度（320／360／390／768／1024／1280／1440）各 35 張；候選無 pageerror、無整頁水平溢出；dashboard 等資料完成才截圖。

| 1280px | DOM 前 → 後 | 變化 | 按鈕前 → 後 |
|---|---|---|---|
| 店員工作台 | 5,072 → 554 | −89.08% | 592 → 47 |
| 共用商品 | 3,550 → 2,103 | −40.76% | 602 → 246 |
| 商家儀表板 | 392 → 292 | −25.51% | 12 → 14 |
| 平台帳務 | 370 → 448 | +21.08% | 11 → 12 |
| 公開 Menu | 1,702 → 1,704 | +0.12% | 4 → 4 |

平台節點增加來自分組側欄與可操作待辦，不以節點數單獨判斷體驗。五頁明暗十狀態、六語供應 dialog，另加三個管理介面明暗掃描均通過 axe WCAG tags；鍵盤／焦點另外驗證，詳見 accessibility-report。這不是 AA 認證。

Production JS 總量 **5,414,225 → 5,282,284 bytes（−2.44%）**，140 → 139 chunks；八路由 entry 預算通過。dashboard entry 113,361 bytes，預算 150,000。這是未壓縮靜態產物，非單次傳輸量；沒有正式 field CWV 或真人任務時間改善宣告。詳見 build-size-comparison.json、visual-comparison.json 與 README 的可切換前後畫面。

### 環境結束及發布界線

DB 最終 239 筆訂單，測試 STAFF 角色 isActive=true；KDS／print 模組恢復原始 false；示範攤位新工作台 true、全域 false。3023／3024／55722 已停止，PostgreSQL 正常 shutdown、exit 0；13 個其他工作區容器集合未改變。容器／volume／資料保留，見 db-final-readback.json、service-stop-receipt.json 及 README 恢復指令。

正式只讀 provider：Primary `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`、`dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`、main `5cc15c6` READY。登入／店員登入／connectivity 200；health 尾斜線 308 正規化後 401。protected backend 未讀回，未做正式訂單操作；無遠端寫入，未發布 Staging／Production。入口讀取不等於完整正式流程 QA。

## 首輪歷史紀錄（896ab68）

以下保留首輪的環境、結果及限制；續作交付以上方新證據為準。

## 首輪環境

- 改造版 Next：3023；基準 Next：3024，分開啟動。
- PostgreSQL：既有 `stallorder-catalog-ops-20260907`，55722，local disposable demo DB；Node Circuit B 真實建單／改單，付款 mock、報表寄送 simulate。
- Edge Gateway 55721 未啟動。本輪沒有用模擬成功代替實機印表機、LINE／第三方支付或 Web Push。
- 實際登入使用既有本機示範角色按鈕或示範帳號。payment-workflow 的既有 test-session helper 是局部證據，不是第三方登入驗收。
- 多次執行保留具 QA 標示的商品／訂單；final DB 共 232 筆訂單。成對量測時有 125 筆在案訂單、91 個商品；沒有複製正式顧客資料。

## 首輪候選 896ab68：靜態、單元、建置

| 命令 | 結果／證據 |
|---|---|
| `npm run typecheck` | exit 0，typecheck-rollout.log |
| `npm run lint` | exit 0；0 errors，5 個既有 `no-location-assign-relative-destination` warnings，lint-rollout-final.log。對應 public-order-tracker、reorder-review、session-keep-alive 未修改區 |
| `npm test -- --maxWorkers=4 --reporter=json --outputFile=<evidence>/vitest-rollout-final.json` | exit 0；3,331 passed，0 failed，9 skipped，556 個結果檔；skip 說明見下 |
| `npx vitest run src/components/staff-order-board-presentation.characterization.test.ts src/components/staff-order-queue.test.ts --maxWorkers=2` | 10 passed；分頁、狀態、優先順序、夾限頁碼、列印與來源／一小時邊界 |
| `npm run ui:audit` | 335 TSX 控制項檔案通過 |
| `npm run build` | 基準與候選均 exit 0，Next 16.3.4 Turbopack production build；build-baseline-final.log、build-rollout-final.log |
| `npm run performance:bundles` | 基準及候選各 8 路由預算全通過；bundles-before.log、bundles-rollout-final.log |
| `git diff --check` | 無 whitespace error |

首輪完整單元測試有一項 characterization 仍要求 `orders.map` 全量渲染；改為驗證正常分頁、browser print 仍全量的契約後，聚焦及完整測試均通過。沒有刪除斷言或把該測試改成 skip。

9 個既有 runtime 測試在 `circuit-ab-db-replay.test.ts`、`circuit-ab-terminal-matrix.test.ts`，需 `PUBLIC_ORDER_DB_REPLAY=1` 及獨立 A/B runtime。預設未啟用，本次沒有計為通過。

基準首次 build 因借用 node_modules junction 超出 Turbopack filesystem root 而失敗；為基準安裝自己的 lockfile 依賴後，原始基準程式碼建置通過。沒有為測試放寬產品安全規則。

## 本輪新增／加強的瀏覽器驗收

先執行 `UI_UX_QA=true` 的 `e2e/ui-ux-rollout-local.spec.ts`，以真實管理者啟用本機示範攤位，其他攤位預設關閉；再執行下列套件。

共同前置：

```powershell
$env:UI_UX_QA='true'
$env:UI_UX_CAPTURE='true'
$env:PLAYWRIGHT_APP_URL='http://127.0.0.1:3023'
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER='true'
$env:UI_UX_ARTIFACT_DIR='<evidence>/paired-after'
npx playwright test e2e/ui-ux-accessibility-local.spec.ts e2e/ui-ux-authorization-local.spec.ts e2e/ui-ux-baseline-local.spec.ts e2e/ui-ux-recovery-local.spec.ts e2e/ui-ux-workflows-local.spec.ts --workers=1 --reporter=list,json
```

最終 `redesign-rollout-final.json`：**9 passed、0 failed、0 skipped、0 flaky**，109.42 秒。內容包括：

1. 五個實際頁面明暗共十種狀態的 axe 檢查。
2. 六語供應視窗：Tab 焦點圈、Escape、返回焦點及 axe。
3. 平台管理者撤銷／恢復店員權限；已開頁面的 API 會拒絕，不能只靠前端隱藏。撤權回應 404 是既有防枚舉契約。
4. 真實角色登入、五頁 × 七寬度，共 35 張候選截圖；pageerror 為空。
5. 延遲儲存、重複點擊僅一請求、429／500／網路故障後保留日期；busy Escape 與可恢復重試。
6. 儀表板較舊查詢晚回覆不覆蓋較新結果；離線保留上次資料，連線恢復後可重新整理。此案例使用真實 API payload 加錯誤／亂序注入，不能當作真實營運數字。
7. 100+ 實際在案訂單，五筆分頁、跨頁選取、不重複、不漏頁、空搜尋、來源、鍵盤、長者暗色、CSS 200% zoom；browser beforeprint/afterprint 保留原全量票面範圍。
8. 商品五筆分頁、跨頁選取、真實供應儲存與 DB 讀回、409 保留視窗、當前模組文字確實未被 clip-path 隱藏。
9. 匿名 401、店員對商家商品管理 403，以及無權頁面邊界。

## 攤位分批啟用與回退

`npx playwright test e2e/ui-ux-rollout-local.spec.ts --workers=1 --reporter=list,json`：1 passed，25.5 秒，rollout-qa-final.json。驗證匿名 401、一般店員即使帶有效 CSRF 仍 404（平台資源防枚舉）、管理者 STALL 範圍關閉→啟用→回退→再次啟用；核對所有訂單 id／status／paymentStatus／total 不變及 audit 寫入。未啟用仍可選單與使用原工作台。保留本機示範攤位 enabled=true，不開全域。

`npx vitest run src/server/resilience/staff-workspace-rollout.test.ts src/server/resilience/feature-flag-service.test.ts src/components/staff-order-queue.test.ts src/components/staff-order-board-presentation.characterization.test.ts --maxWorkers=2`：21 passed；涵蓋預設關閉、不同攤位／組織隔離與設定查詢失敗仍可回原介面。沒有把旗標讀取錯誤當成登入或交易失敗。

## 核心業務連動回歸

下表使用本次版本的多次 run；不是把所有歷史 run 次數相加。失敗留存於 integrated-round1～5 等目錄，修正後的個別結果另列。

| 測試命令／檔案 | 最終觀察結果 |
|---|---|
| `LOCAL_CATALOG_AMENDMENTS_QA=true`，`npx playwright test e2e/catalog-availability-amendments-local.spec.ts --workers=1` | 六案例最終均通過：供應／跨日／永久下架、已列印原單增刪與價格保留、idempotent replay／409、製作中／不足庫存整筆回復、320～1440 巢狀視窗、QR 舊購物車售完／恢復、店員必選加餐及變更單。前五見 functional-final.json；第六以 `--grep '店員畫面可增刪'` 通過，staff-amendment-final.json |
| `npx playwright test e2e/qr-edit-local-flow.spec.ts` | 手機 QR 原單修改／取消、維護遮罩與保留餐具；外帶修改保留姓名電話、錯誤摘要可聚焦及取消後立即顯示結果。兩案例均通過；functional-final.json＋functional-retest.json |
| `npx playwright test e2e/product-note-groups.spec.ts --grep 'QR 註記選擇會'` | 360px 真正選必選辣度＋多選加料、下單、後端價格 90、顧客追蹤、店員核對註記與授權取消；通過，functional-retest.json |
| `npx playwright test e2e/staff-kds-print-closure-flow.spec.ts --workers=1 --reporter=list,json` | 最新旗標版完整五案例均通過（2.3 分鐘，kds-rollout-final-pass.json）：KDS/列印關閉結帳一次、Menu 已備妥、印表成功自動完成、失敗→重印失敗→成功後平板／手機恢復完成且不二次收款、公休同步 Menu/QR 並阻擋下單 |
| `npx playwright test e2e/staff-orders-print-runtime-responsive.spec.ts` | 三案例通過：大量品項響應式、Star SDK 有限失敗重試、變更單列印命令。軟體／協定替身驗證，不是實體出票證明 |
| `npx playwright test e2e/payment-workflow-local.spec.ts` | 兩案例通過：多種 mock 支付結果、未知／pending、退款／對帳與重試；未發生真實扣款 |
| `npx playwright test e2e/operational-switcher-permissions.spec.ts` | 純店員／廚房不可切管理模式，商家可切已啟用 KDS；兩例通過，functional-retest.json |
| `npx playwright test e2e/qr-local-smoke.spec.ts --grep-invert '輕量 session'` | 手機固定摘要、無水平溢出、真實 session 與購物車還原；兩例通過。直接 Edge 輕量 session 案例仍是環境缺口 |

測試前提修正包括：多商家登入指定 next、找指定訂單先跨頁搜尋、KDS／列印測試明確建立及恢復本機模組／列印規則、供應商品不任取保留資料的第一筆。Circuit B 的 200 idempotent session replay 沿用 server 契約，並檢查 token 形狀；沒有只為綠燈修改 server 回應碼。

補驗旗標後，列印完整套件首次為 2 passed／1 failed／2 not run（kds-rollout-final.json）。根因是保留的 disabled 規則仍未軟刪除，觸發 `20260912112100_order_amendment_print_jobs.sql` 的規則路由，無匹配路由時取消相容工作；原測試只建立 printer、未建立 rule，誤假設不存在規則。修正測試為專用印表機建立明確 ORDER_CONFIRMED 規則，結束清除本次 fixture，原規則保留。沒有改 server 或把 CANCELLED 接受為 PENDING；重新完整執行五例均通過。

## 成對畫面與效能

基準及候選都使用相同 125 個訂單 id/status，SHA-256 `70f2ad14379ea7fefbe947e87d2db08f2ff8b2ddffd09e828752e10a14ab2680`，商品數 91。寬度 320／360／390／768／1024／1280／1440，height 900，Chromium、zh-TW、Asia/Taipei。每個角色使用獨立 context，避免測試登入角色互相競爭。

| 1280px 畫面 | DOM 前 → 後 | 變化 | 其他 |
|---|---|---|---|
| 店員 | 4,878 → 532 | −89.09% | 清單票 125 → 5；全頁按鈕 568 → 46 |
| 商品 | 3,443 → 2,158 | −37.32% | 商品列 91 → 5；分類／註記區保留 |
| 儀表板 | 404 → 406 | +0.50% | 增加 freshness 語意 |
| 平台帳務 | 370 → 373 | +0.81% | 增加低頻設定收合控制 |
| 公開 Menu | 1,639 → 1,639 | 0% | 本輪改進在下單後的 checkout，不改只讀 Menu 資料量 |

最新含旗標版本重新截圖；相同啟用路徑多一個 React 節點，視覺與按鈕數保持一致。

所有 35 個候選畫面 `scrollWidth <= innerWidth`，pageerror 為空。這不代表全部 111 頁與所有彈窗都測過。

Production build 共 140 個 JS chunks：5,414,225 → 5,423,113 bytes，增加 8,888 bytes（約 0.16%）。既有八個 route entry 預算均通過；dashboard entry 112,573 → 113,113 bytes（+540），其餘測得 entry 相同。entry 指標不包括所有延後載入內容；總量也不是一次頁面載入量。

沒有正式 field CWV／真人完成時間資料，未宣稱 LCP／INP 或錯誤率改善。dev 編譯／記憶體暖機不當成正式效能；長期程序達約 9GB 後重啟自身程序，改以 4GB heap 執行後續檢查，未停其他工作區。

## 缺口與發布條件

- Edge A/B runtime 九項預設略過、直接 Edge 輕量 session 無服務；本輪真實下單是 Node Circuit B。沒有改後端 A/B 實作，因此不為本次 UI 自動啟動完整 DR／多寫入端。
- 實體列印／錢櫃、iPad／Android 實機、鎖屏通知、真實支付／外送／LINE provider、螢幕閱讀器與原生縮放需另外實測。
- 商家搜尋目錄、平台側欄與工作台攤位旗標已實作；缺少完整分母的新指標維持設計評估。未做 Staging／正式發布及 live QA。
- 沒有全面滲透測試、所有頁面的 axe 或所有付款 provider 真實交易證據，不宣稱不存在所有權限／交易問題。

這些缺口會阻止全系統／正式發布完成宣告。下一步的值來源、位置、驗證與回復集中於 [release-and-rollback-plan.md](release-and-rollback-plan.md)。
