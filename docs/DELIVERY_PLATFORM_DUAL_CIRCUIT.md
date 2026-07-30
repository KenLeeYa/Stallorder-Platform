# 外送平台雙迴路

## 職責

| 迴路 | 入口 | 用途 |
| --- | --- | --- |
| Circuit A | Supabase Edge Function | 未來可承接經核准的 Provider Webhook 或低延遲入口 |
| Circuit B | Vercel Route Handler | 目前 Webhook、管理 API、Cron 與 Provider Action |

兩個入口必須共用同一組 PostgreSQL Ledger、Idempotency Key、Job Queue 與商業規則，不得建立兩套訂單邏輯。

## 寫入規則

- Production Primary 是唯一 `ACTIVE_WRITER`。
- Production DR 保持 `READ_ONLY_STANDBY`，不是測試環境。
- 所有 Delivery Writer Table 有 `*_primary_writer_guard` Trigger。
- Application Service 在交易內再次呼叫 `app_private.assert_backend_writable(null)`。
- 每筆 Webhook、External Order 與 Job 記錄 `received_via_circuit` 或 `requested_via_circuit`。

## 切換與重試

- Webhook Replay Key 與 External Order Unique Key 跨迴路共用。
- Provider Action 使用穩定 Idempotency Key。
- 明確商業拒絕不觸發迴路切換。
- 不確定 Provider 是否已執行的回應不得盲目重送；先查詢 Provider 狀態或人工對帳。
- DR 未經獨立核准、Fencing 與人工 Promotion，不得寫入。

## Preview

Preview 僅使用 data-less Supabase Branch、合成身分與 Mock Provider。任何 Vercel Preview 若無法確認連到相同 Preview Branch，必須停止雲端瀏覽器測試，不能改接 Primary 或 DR。
