# Uber Eats Runbook

| 症狀 | 立即動作 | 檢查 |
|---|---|---|
| HMAC failure | 保持 Orders OFF，不回顯 payload | raw body、header、secret reference |
| Unknown store | fail closed | `meta.user_id` 與 active mapping |
| ORDER_FETCH backlog | 暫停擴量 | queue age、API 429/timeout、DLQ |
| Accept deadline risk | 人工 portal 接手並記錄 | webhook lag、worker latency |
| 401 | 只允許一次 token refresh | environment/client/scope |
| Store mismatch | 停止該 connection | fetched order store vs mapped store |
| Duplicate | 不刪 event | event_id/replay key/connection |
| Item sync error | 關閉 menu item write | menu ownership、store/item mapping |

事故證據使用 request/event/job/order ID 與 payload hash；不得記錄 token、secret、完整電話或未遮罩 payload。
