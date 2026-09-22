# Phase 00–15 交付範圍

本輪依下載的 Master Prompt 全文執行。基準 `5cc15c6`，實作分支 `codex/ui-ux-redesign-20260923`。這是漸進改造，不是將 111 個頁面一次重寫。正式發布、第三方交易及硬體驗收尚未進行。以下「沿用」均指有來源可追溯的現有能力，不能當成本次重新實測通過。

| Phase | 本輪產出／來源 | 驗收或限制 |
|---|---|---|
| 00 盤點 | current-state-audit、route-inventory；實讀 Git、provider、111 page 路由、真實五頁截圖 | 正式只讀入口基準；本機專用 DB/API 邊界 |
| 01 研究 | benchmark-matrix、personas-and-jobs、journey-and-service-blueprint、issues-backlog | 官方來源與設計推論分開；persona 未經商家訪談 |
| 02 IA | information-architecture、design-decisions；商家目前模組文字及 aria-current | 既有路由及角色判斷保留；全面搜尋式側欄為後續方案 |
| 03 設計系統 | design-system；中文 fallback、觸控、長者資料字級、暗色選取態 | 沿用原生控制與交易專用 dialog；沒有重造未使用的元件庫 |
| 04 工作台 | staff-order-queue；五筆分頁、狀態計數、來源／最近一小時、付款／列印摘要 | 在原有 active orders 範圍內；已完成與預約區維持原功能；不新增批次接單權限 |
| 05 異常 | 供應儲存重入鎖／忙碌焦點；原有付款未知與原票／重印工作家族回歸 | 權威模型沿用 primary-print-status、checkout controller、offline operations；硬體票尚未驗證 |
| 06 消費者 | 結帳可見 label、必填語意、可定位的錯誤欄位、觸控尺寸 | 訪客／QR／外帶／外送沿用相同 controller，不變更姓名電話要求或價金 |
| 07 商品 | 五筆管理清單、跨頁選取、五模式供應與六語；巢狀視窗焦點 | 真實儲存／讀回及衝突保留；時區、跨日與庫存演算沿用 server |
| 08 平台 | 帳務低頻系統設定收合、深色對比修正；權限路由盤點 | 既有管理者 server guard、審核／理由／audit 保留；不新增 impersonation |
| 09 a11y | axe WCAG tags、六語 dialog、鍵盤、長者、200% CSS zoom、各斷點 | 自動檢查不是 WCAG 認證；實機螢幕閱讀器、原生瀏覽器 zoom 仍須補驗 |
| 10 儀表板 | 單攤更新時間及時區、保留精確摘要；查詢結果取消及最新回應核對 | 現有資料沒有製作 p95／售完頻率分母，僅提供定義方案，不畫假圖 |
| 11 效能 | 有限 DOM、保留 server rendering、查詢 abort、既有 bundle budgets | 成對資料與同機量測記於 verification；不將 dev 編譯時間當 CWV |
| 12 QA | 單元／實際 DB、RBAC、瀏覽器、多語及錯誤注入 | 每次 run 的 passed/failed/not_run 分開；見 verification-report |
| 13 遷移 | 獨立分支、無 schema 變更、保留 routes/controller；預設關閉的攤位工作台旗標 | 真實管理者啟用／回退、權限拒絕、訂單不變通過；Staging／正式設定仍待發布流程 |
| 14 驗收 | 核對 Master Prompt 10 條驗收條件 | 外部 provider、實機、正式部署、全站全路由仍有未驗證範圍，不宣稱全系統完全驗收 |
| 15 文件 | 11 份必要文件＋本表＋路由盤點＋真實 before/after | 以本次 report 與 commit 為準，沒有沿用歷史成功宣告 |

## 儀表板評估與後續指標定義

| 問題 | 可用來源／現有呈現 | 決策 |
|---|---|---|
| 今天各攤銷售與待處理量 | MultiStallDashboard 的摘要、攤位表、期間／generatedAt、status alerts | 保留可直接進攤位操作的表格，補單攤 freshness |
| 趨勢與尖峰時段 | merchant/reports 的既有 sales trends／time buckets | 保留既有期間及匯出權限；不額外建立重複即時圖表 |
| 接單／製作／出餐時間 | order/item timestamps 有部分資料，關閉 KDS 時可能缺失 | 未完成資料完整率與統一定義前不發布平均值；後續分母只含時間完整的完成單，同列 missing count |
| 付款／列印失敗率 | payment/print jobs，重試與重印可多筆 | 不能拿失敗 job / order 當失敗率；須先按交易／原票家族去重，另列仍未恢復數 |
| 售完頻率 | 當前 availability 與 audit，非完整每次售完歷史 | 不由當前 isSoldOut 倒推出歷史頻率；後續需定義 business-day 次數及永久下架排除 |
| 來源占比／熱門品項 | 現有 order source／items 與報表 | 既有資料使用原幣別／期間；分母為符合期間的有效訂單，取消另列 |

## Phase 14 十條驗收逐項判定

| 條件 | 本輪判定與證據界線 |
|---|---|
| 1 三類角色路由／權限／旅程 | 有 111 頁盤點、角色旅程與實際顧客／店員／管理者案例；不是全部路由重走 |
| 2 接單至出餐及狀態 | 本機五個 KDS／列印／結單案例完整通過；實體出票尚未驗證 |
| 3 手機必選／多選訂單 | 360px 客製下單、價格、追蹤、店員核對通過；重複送出及錯誤定位另有回歸 |
| 4 售完前後一致 | 真實供應儲存、顧客舊購物車阻擋及恢復、跨日／永久下架通過 |
| 5 異常安全恢復 | 網路／衝突／未知 mock 付款／列印失敗復原通過；真實 provider 為缺口 |
| 6 裝置寬度 | 五個核心頁面 320～1440px 共 35 張、關鍵互動與長者模式通過；其餘頁面仍需驗 |
| 7 a11y | 五頁明暗十狀態及六語 dialog axe、鍵盤／焦點回歸通過；NVDA／VoiceOver／TalkBack 未實測 |
| 8 安全邊界 | 本次 API 401／403／404、撤權與旗標 scope 通過；未做全系統滲透驗證，不能宣稱全面無漏洞 |
| 9 QA／build | 本輪必要核心套件、型別、lint、單元及 build 通過；九項既有 A/B runtime 與直接 Edge 案例未跑，明列環境原因 |
| 10 效能 | 相同資料 DOM 大幅減少、八項 bundle 預算通過，總 JS 增加 0.16%；未量測真實 field CWV，不宣稱整體體感速度提升 |

因此可交付本機候選版及本輪範圍的 QA 證據；不能將本表等同全部十條在所有環境完全達標。未完成項目按 backlog 與發布表繼續驗收。

## 權限地圖補充

route-inventory 的 direct guards 不含 inherited layout；不能據此判斷無 guard 即公開。

- `/admin/*`：`admin/layout.tsx` 執行 `requirePlatformAdminPage`，子頁再依資料函式／API 驗證。
- `/merchant/*`：layout 只提供語系，實際每頁需 `requireWorkspacePage`／`requireWorkspaceOrganization`／permission；不可把 layout 當授權。
- `/staff/:slug`：`requirePagePermission(VIEW_ORDERS)`；具體付款、製作、取消、列印由各 API 再驗角色。
- `/kitchen`：`requireKitchenPage` 加 KDS 模組與角色範圍，不因前端導航可見就授權。
- `/q/:token`、`/store/:code`、`/order/:trackingToken`：公開入口不等於公開訂單資料；session、device、token、rate limit、RLS／RPC 為原有邊界。
- 本次修改未新增 API、資料欄位或 cookie；旗標讀取失敗僅新增固定 fallback log，沒有輸出例外、姓名電話／token 作為遙測。
