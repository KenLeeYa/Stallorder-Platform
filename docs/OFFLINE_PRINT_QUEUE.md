# 離線列印佇列

## 支援範圍

攤位必須已啟用列印模組，Permit 也必須包含 `QUEUE_PRINT_JOB`。每筆離線訂單
最多建立一個相同用途的工作：

```text
offline-order:<offlineOrderId>:receipt:v1
```

`print_job_id` 與 `deduplication_key` 共同避免重新載入、重試或同步後重複建立
列印工作。

## 狀態

- `PENDING`
- `PRINTING`
- `SUCCEEDED`
- `FAILED`
- `CANCELLED`

只有 `SUCCEEDED` 可以有 `printedAt`。同步時找不到 printer reference 會建立
`UNKNOWN_REFERENCE`；停在 `PRINTING` 會建立 `PRINT_STATUS_UNKNOWN`，要求
先核對實體單據再決定是否補印。

瀏覽器列印不保證所有 Android 裝置或藍牙印表機都可用。沒有可驗證的 printer
integration 時，系統只保存本機工作與待核對狀態，不把「已送出瀏覽器列印」
視為可靠的列印成功。
