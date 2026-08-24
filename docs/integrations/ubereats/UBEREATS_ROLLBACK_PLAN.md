# Uber Eats Rollback Plan

## Global

1. 關閉所有 `UBER_EATS_*_WRITE_ENABLED`、ready、fulfillment flags。
2. 關閉 `DELIVERY_PROVIDER_ACTIONS_ENABLED`。
3. 關閉 `UBER_EATS_ORDERS_ENABLED`、`UBER_EATS_API_ENABLED`、`UBER_EATS_OAUTH_ENABLED`。
4. 關閉 `UBER_EATS_INTEGRATION_ENABLED`；必要時關閉 global foundation。

## Per store

將 connection 設為 `PAUSED`；不刪除 event/order/job/audit。人工在 Uber portal 核對 live orders，避免重複 accept/deny。修復後只對 allowlisted canary connection 重放具 idempotency key 的 job。

## DB

以 forward-fix 為優先。constraint rollback 只可在確認沒有新格式寫入、backup/restore 演練完成且另行核准後進行。
