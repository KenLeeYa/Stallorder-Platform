# Usage Ledger

`usage_events` 是 append-only 計費來源。訂單只有第一次從非完成狀態進入 `COMPLETED` 且 `is_test=false` 時，才建立唯一 `BILLABLE_ORDER_COMPLETED` 事件。

不計費項目：測試單、取消、逾時、拒絕、Turnstile 失敗、惡意嘗試與 idempotent replay。`unique(event_type, reference_id)` 避免同一正式訂單重複計量。

`billing_usage_summaries` 可由 ledger 重建，但不得刪除或改寫原始事件。設定精靈的測試單也從一般營收、付款與 daily summary 排除。

操作與對帳流程見 [USAGE_METERING.md](USAGE_METERING.md)。
