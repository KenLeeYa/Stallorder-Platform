# 多攤位儀表板與報表

## 路由

```text
/merchant/dashboard
/merchant/stalls/:stallId/dashboard
/merchant/reports/overview
/merchant/reports/stalls
/merchant/reports/products
/merchant/reports/payments
```

Dashboard 支援全部、單一或多個授權攤位，以及今天、昨天、本週、本月、自訂日期。報表與 CSV 的最大查詢範圍為 93 天，攤位清單最多 50 個且不可重複。

## Trusted API

`GET /api/merchant/dashboard/overview`

參數：

```text
organizationId=<uuid>
stallId=<uuid>        可重複
dateFrom=YYYY-MM-DD
dateTo=YYYY-MM-DD
```

處理順序：

1. strict parse 允許的 query key、UUID、日期及範圍。
2. 由應用 session 解析 profile。
3. 驗證 organization subscription 為可營運狀態。
4. 取得 workspace 的授權攤位集合。
5. 拒絕任何不在集合內的 requested stall。
6. 只聚合 `daily_stall_summaries`，回傳 `private, no-store`。

Client 提供的 organization/stall 只表示請求範圍，不能擴張後端授權集合。

## 每日摘要

`daily_stall_summaries` 以 `(stall_id, business_date)` 唯一。訂單或付款變更時，database trigger 以該攤 `timezone` 重建受影響日期。

主要欄位：

- order/confirmed/completed/cancelled/pending/unpaid count
- gross/discount/net sales
- cash/manual transfer/other payment
- average order value、last order time、last calculated time

`rebuild_daily_stall_summary` 最長接受 367 天，由 service role 執行。這是對帳/修復工具，不提供給瀏覽器。

## 指標定義

- 總銷售額：完成訂單 `net_sales` 加總。
- 訂單總數：範圍內所有訂單數。
- 平均客單價：`total sales / completed orders`，不是各攤平均值再平均。
- 取消率：`cancelled orders / all orders`。
- 待處理：WAITING_CONFIRMATION、CONFIRMED、PREPARING、READY。
- 未付款：非 CANCELLED/EXPIRED 且 payment status 為 UNPAID。
- 最佳攤位：範圍內 `totalSales` 最大。
- 最忙攤位：範圍內 `orderCount` 最大。

攤位比較包含狀態、點餐開關、訂單/完成、銷售、客單、待處理、未付款、取消率與最後訂單時間，可搜尋及排序。

## UI 行為

- Desktop 使用固定欄位表格；手機使用每攤卡片，避免必要水平捲動。
- 範圍與日期變更會重新呼叫 trusted API。
- 顯示 Realtime/自動更新狀態與手動重新整理。
- Owner/Admin 可對已驗證範圍執行批次暫停/恢復，需二次確認。
- Loading、error、empty、alert 都有繁體中文狀態。

## CSV

CSV 由 `POST /api/merchant/reports/export` 產生：

- session、`VIEW_REPORTS`、CSRF 與授權 stall set 都會驗證。
- 同樣限制 93 天。
- 公式起始字元會轉義，避免 spreadsheet formula injection。
- 每次匯出記錄 audit 與 `CSV_EXPORTED` usage event。

## 效能與對帳

- Dashboard 不抓取歷史 order item 明細。
- 常用索引為 `(organization_id, business_date, stall_id)` 與 `(stall_id, business_date desc)`。
- 遇到摘要落差，先在唯讀查詢比對訂單/付款，再由 service role 重建指定 stall/date range。
- 對帳完成後重新呼叫 API，確認 summary 與各攤合計一致。
