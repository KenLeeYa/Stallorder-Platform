# foodpanda Rollback Plan

## 緊急停用順序

1. 關閉 `FOODPANDA_CATALOG_WRITE_ENABLED` 與 `FOODPANDA_OUTLET_ENABLED`。
2. 關閉 `DELIVERY_PROVIDER_ACTIONS_ENABLED`。
3. 關閉 `FOODPANDA_ORDERS_ENABLED` 與 `FOODPANDA_WEBHOOK_ENABLED`。
4. 關閉 `FOODPANDA_PARTNER_API_ENABLED`、`FOODPANDA_INTEGRATION_ENABLED`；必要時關閉 global foundation。
5. 將受影響 connection 設為 `PAUSED`，保留 event/order/job/audit 證據。

## Live order handling

停用後不可刪除 webhook 或 ledger。人工在 foodpanda portal 核對未完成訂單，標記事故窗口，修復後僅重放已驗證且具 idempotency key 的事件。

## Database

優先 forward-fix。不得在有新格式寫入後直接 rollback constraint；如需 DB 回復，必須使用已驗證 backup/restore 計畫與獨立核准。
