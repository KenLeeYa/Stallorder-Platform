# 用量計量

## 計費事件

- 只在訂單第一次進入 `COMPLETED` 時建立 `BILLABLE_ORDER_COMPLETED`。
- `ORDER_CREATED`, `WAITING_CONFIRMATION`, rejected, expired, cancelled 與惡意嘗試不計費。
- `(event_type, reference_id)` 唯一約束防止同一訂單重複計量。
- `usage_events` 為 append-only 計量來源；summary 可重建，原始事件不可刪除。
- 完整退款第一次成立時建立唯一 `BILLABLE_ORDER_FULL_REFUND=-1`；重複退款不再次折抵，部分退款不自動視為零平台費。

## 帳期摘要

`billing_usage_summaries` 保存指定 organization 與 billing period 的完成訂單、啟用攤位、啟用員工、QR 數量及 CSV export 次數。`rebuild_billing_usage_summary` 從可信事件及目前範圍重算，人工觸發須寫入 `USAGE_REBUILT` audit event。

PAYG 另以 `billing_stall_usage_summaries` 保存每個攤位的 gross、完整退款、net、未封頂金額、TWD 1,499 cap、final charge 與 cap savings。`rebuild_payg_stall_usage_summaries` 依 ledger 重建並寫入 `PAYG_USAGE_REBUILT`；Organization 金額是各攤位 final charge 的總和。

## Trial

- 14 天或 100 筆完成訂單，任一先到即停止新公開 order session 與公開訂單。
- 已建立資料、登入、歷史檢視及帳務頁仍可使用。
- Trial gate 同時存在於 Next.js／Edge 流程與資料庫交易層。

## 付費方案

- 預設 `SOFT_LIMIT_MANUAL_BILLING`。
- 80%：資訊提示。
- 90%：緊急提示。
- 100%：要求用量檢查，但不中斷營業。
- 110%：建議升級或指派 order package。
- emergency hard cap 預設關閉，只有 Platform Admin 受稽核操作可設定。

## 對帳

1. 選定 subscription 與 billing period。
2. 執行重建 summary。
3. 比對 `usage_events` 唯一完成訂單數與 summary。
4. 檢查 80／90／100／110% warnings 是否去重。
5. 記錄 request ID、操作者與差異原因。
6. PAYG 逐攤驗證 `net=max(gross-refund,0)` 與 `final=min(net,1499)`，再比對 Invoice line metadata。

重建不應改變訂單、付款、Invoice 或歷史事件。

