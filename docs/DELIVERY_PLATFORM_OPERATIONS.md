# 外送平台營運手冊

## 每日檢查

- Active Connection 的 `last_successful_sync_at` 與 `last_error_code`。
- Webhook Rejection、Duplicate、Mapping Required、Retry Pending、Dead Letter 數量。
- External Order 與 Canonical Order 的一對一關係。
- `PENDING_RECONCILIATION` 與 Provider Settlement 差異。
- Circuit A/B 比例及 Primary Writer 健康狀態。

## Job Worker

`GET /api/cron/delivery-jobs` 僅接受 `Authorization: Bearer <CRON_SECRET>`。Worker 使用 `FOR UPDATE SKIP LOCKED` 原子領取，Lease 為 10 分鐘，最大 5 次；延遲為 1、5、15、60、360 分鐘。

人工重試只允許授權管理員對 `FAILED`、`DEAD_LETTER`、`CANCELLED` 工作執行，並寫入 Audit Log。遇到 Provider 不確定回應，不得直接重試 Accept/Reject，需先查 Provider 狀態。

## 警示

- `DELIVERY_ORDER_MAPPING_REQUIRED`
- `DELIVERY_JOB_DEAD_LETTER`
- Webhook Rejection Spike
- Duplicate Spike
- Provider Action Timeout
- Primary Writer Unavailable
- Unexpected DR Write Attempt
- Mock Provider Active in Production

## 故障處理

1. 先停用該 Provider Action Flag，保留 Ledger 與內部訂單。
2. 判斷是 Credential、Store Mapping、Menu Mapping、Provider Outage 或 Primary Fencing。
3. 不刪除 Webhook/Event/Job 證據。
4. Provider 復原後，以 Admin Retry 執行可證明安全的工作。
5. Payment 差異保持 `PENDING_RECONCILIATION`，不得人工改成現金收入。

## 安全日誌

日誌可包含 Provider、Circuit、內部 Event/Job ID、狀態與安全錯誤碼；不得包含 Raw Payload、Customer Note、Phone、Address、OAuth Code、Token、Secret 或 Connection String。
