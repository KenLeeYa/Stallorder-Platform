# 手機營運清單的逐步顯示

2026-10-02：MobileProgressiveRecords 僅在寬度小於 768px 時，將已載入記錄預設顯示 6 筆；每次「顯示更多」增加 6 筆，「收合」回到 6 筆。各區獨立控制，顯示已載入總數及目前筆數。768px 以上沿用原完整表格／卡片。這是呈現限制，不是分頁 API、方案額度或資料庫總筆數。

| 元件 | 手機逐步顯示區域 | 持續使用完整資料的摘要／限制 |
| --- | --- | --- |
| OperatingProfitDashboard | 已入帳支出、支出分類、每日淨營收、商品毛利排行 | 總額、日期／攤位範圍、缺配方警示 |
| WorkforceManager | 薪資預覽、出勤異常、已發布班表、休假申請、薪資單歷程 | 工時、薪資、待審休假與異常數；缺少時薪人數與產生薪資單禁用條件 |
| StallScheduleManager | 行程與現場狀態 | 完整有效行程數與方案新增上限 |
| MerchantEInvoiceManager | 電子發票紀錄 | 已載入文件的對帳差異紀錄數、本機 Mock 與正式開立停用提示 |

新資料陣列或 scope 改變即回到 6 筆，包括同一陣列參考的 A→B→A 切換。組織、行程攤位與報表日期切換會重建對應 workspace 元件，避免 useState(initialData) 留下前個範圍的資料／操作視窗。成功操作回傳更新資料後亦重置。展開／收合不呼叫 API；操作保持原始記錄 ID、CSRF 與權限流程，表單選項不裁切。

## 查詢與權限邊界

- 營業損益：src/app/merchant/operating-profit/page.tsx 保留 VIEW_REPORTS、授權攤位篩選；更正支出仍需 MANAGE_ORGANIZATION。既有日期／攤位查詢與毛利排行上限 100、支出上限 2000 不變。
- 排班薪資：src/app/merchant/workforce/page.tsx 保留 MANAGE_ATTENDANCE 與授權攤位限制。既有班表 5000、休假 2000、出勤 20000、薪資單歷程 12 筆上限不變；受限攤位角色不因呈現變更取得薪資单歷程。
- 出攤行程：src/app/merchant/stalls/[stallId]/schedule/page.tsx 保留 assigned stall、MANAGE_STALL_SCHEDULES 與 STALL_SCHEDULE 判斷；既有服務最多取 365 筆行程。呈現的 6 筆不參與 entitlement 計算。
- 電子發票：src/app/merchant/integrations/e-invoice/page.tsx 保留 MANAGE_PAYMENT_INTEGRATIONS；getMerchantEInvoiceData 僅取該組織最近 100 份文件，對帳差異關聯仍只載入 OPEN／IN_REVIEW。沒有新增 provider 呼叫或正式開立能力。

## 驗證與限制

src/components/operations-mobile-records.test.ts 使用實際 React 元件、locale/messages provider 與 Chromium 掛載；只有 fetch 邊界回傳 fixture，所有頁面請求在記憶體攔截，沒有啟動網站或資料庫。大量 fixture 驗證初始 6／增加／收合／末筆操作 ID／範圍重置／完整摘要與方案限制；768、1440 寬度驗證完整筆數，A→B→A 另有重現缺陷的 RED→GREEN。

這些測試不證明真實權限登入、資料庫寫入、provider、production build 或 CSS 幾何。整合建置後仍須在既有授權環境驗證 320／390／768／1440 頁面與可用 seed／空態；密集資料末筆可達性由元件 fixture 提供獨立證據。
