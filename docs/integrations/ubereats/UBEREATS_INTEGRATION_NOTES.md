# Uber Eats Integration Notes

- webhook 是 event reference，不是完整訂單；必須先驗證 HMAC，再 enqueue `ORDER_FETCH`。
- 成功 webhook response 為空 body `200`；Uber 可重試，因此 durable idempotency 是必要條件。
- order fetch 使用 v2；accept/deny 使用官方 v1 operations，不能假設所有 endpoint 同一 generation。
- accept/deny 需在 Uber 時限內完成；本實作不把 11.5 分鐘當作延後處理的目標。
- `resource_href` 不直接 fetch，避免 SSRF；只允許固定 Uber origin/path 並以 resource ID 重建 request。
- ready、ready time、fulfillment、reports、store status 與 full menu 尚未實作，對應 flags OFF。
- application token cache 是 process-local；多 instance shared single-flight 尚未完成。
