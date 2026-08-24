# Usage Ledger

`usage_events` 是 append-only 計費來源。訂單只有第一次從非完成狀態進入 `COMPLETED` 且 `is_test=false` 時，才建立唯一 `BILLABLE_ORDER_COMPLETED` 事件。

PAYG 完整退款以新的唯一 `BILLABLE_ORDER_FULL_REFUND=-1` 事件折抵，不刪除原完成事件。每筆事件保存由可信訂單推導的 `organization_id`、`stall_id`、billing period 與 order reference；不得相信前端提供的攤位或價格。部分退款目前不建立完整折抵。

不計費項目：測試單、取消、逾時、拒絕、Turnstile 失敗、惡意嘗試與 idempotent replay。`unique(event_type, reference_id)` 避免同一正式訂單重複計量。

`billing_usage_summaries` 與 `billing_stall_usage_summaries` 可由 ledger 重建，但不得刪除或改寫原始事件。設定精靈的測試單也從一般營收、付款與 daily summary 排除。

操作與對帳流程見 [USAGE_METERING.md](USAGE_METERING.md)。

計費月份一律使用 Subscription 從封存 PlanVersion 複製的 billing timezone，不再使用可變更的攤位營運時區。已付款或已開立稅務文件後才發生的完整退款，保留原事件並建立 linked late-credit adjustment，不重寫原帳期。
