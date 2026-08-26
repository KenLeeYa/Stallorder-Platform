# 整合事件 Runbook

## 分級

- SEV-1：跨租戶、付款錯誤、重複訂單、secret 外洩。
- SEV-2：單一 Provider 大量失敗、backlog、菜單同步不一致。
- SEV-3：單一連線、單一商品或非核心延遲。

## 處置

1. 立即停止受影響 Provider 的 write/action flag；保留 read-only 或核心點餐。
2. 撤銷／輪替疑似外洩憑證，停止 Webhook endpoint。
3. 以 event id、idempotency key、payload hash、request id 對帳；不要重送原始敏感 payload。
4. 對重複事件回傳既有結果；失敗事件進 DLQ，不手改 canonical Order。
5. 需要 replay 時由有權限人員執行，寫入 actor、reason、source event 與 outcome。
6. 恢復前通過 signature、replay、亂序、429/5xx、timeout 與 reconciliation 測試。

對外通知只使用已確認事實，區分「接收失敗」、「處理失敗」與「Provider 未回應」。
