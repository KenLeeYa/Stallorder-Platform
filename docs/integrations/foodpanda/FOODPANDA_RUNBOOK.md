# foodpanda Runbook

| 症狀 | 立即動作 | 檢查 |
|---|---|---|
| Webhook 401/403 | 保持 Orders OFF，核對 secret reference | 不輸出 raw Authorization |
| Webhook 重複 | 不手動刪 event；查 replay key/hash | connection-scoped unique key |
| Token 401 | client 僅允許一次 refresh；持續失敗即 pause | client ID、secret、environment pairing |
| 429/timeout | 保留 retry/backoff 與 DLQ | provider status、queue age |
| Store mismatch | 立即 fail closed | chain/vendor mapping 與 tenant |
| 金額不符 | 停止該 connection 的 import | currency、weighted item、discount sponsorship |
| DLQ 增長 | 關閉寫入 actions，保存 evidence | error code、attempt count、payload hash |

事故中不得把 secret、完整電話或完整 webhook payload貼入 ticket。恢復前執行單一 canary connection 測試。
