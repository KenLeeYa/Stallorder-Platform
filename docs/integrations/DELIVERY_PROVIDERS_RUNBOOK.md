# Delivery Providers Runbook

更新日期：2026-08-21

## 初始分流

1. 以 provider、connection ID、store ID、event/job/order ID 與 payload hash 定位；不得收集 raw secret、Authorization、完整電話或完整 payload。
2. 先判斷 authentication、tenant/store mismatch、provider 429/5xx、queue backlog、duplicate/replay 或資料正規化錯誤。
3. 保留 event/job/audit evidence；不得直接刪除 durable event、DLQ 或 order ledger。
4. 不確定影響時先關閉最小範圍 Feature Flag，再以單一 canary connection 驗證恢復。

## Rollback 層級

- Global：關閉 `delivery_integrations.enabled`；不得影響 native StallOrder ordering。
- Provider：只關閉 `foodpanda.integration.enabled` 或 `uber_eats.integration.enabled`，另一 provider 保持原狀。
- Capability：依序關閉 provider 的 actions、menu、orders/import flags，保留 webhook evidence 能力需由事件處理策略明確決定。
- Merchant：停用指定 connection 或 store mapping，不修改其他 tenant。

Rollback 後確認：新 external writes 為 0、native orders 正常、queue 不再增加、既有 job 已 pause/DLQ、audit 記錄 actor/reason/time。Database migration 只允許 forward-fix；不得在事故中任意 down-migrate 或刪除 ledger。

## 常見事件

| 症狀 | 立即動作 | 恢復條件 |
|---|---|---|
| Webhook 401/HMAC failure | 關閉該 provider orders，核對 secret reference/environment | canary webhook authentication PASS |
| Body/response contract error | 保留 hash/status，檢查 provider contract 與 cap | 小 payload與 over-limit tests PASS |
| 429/timeout/DLQ 增長 | 暫停 actions/擴量，保留 bounded retry | backlog、error rate、provider status 恢復 |
| Store/tenant mismatch | 立即 fail closed 該 connection | mapping 與 partner portal 雙向核對 |
| Duplicate/replay | 不刪 event，查 connection-scoped key | 無重複 canonical order/action |
| 金額或品項不符 | 停止 import/action | fixture、currency、discount/weighted item 驗證 PASS |

Provider 操作細節：

- [foodpanda runbook](foodpanda/FOODPANDA_RUNBOOK.md)
- [Uber Eats runbook](ubereats/UBEREATS_RUNBOOK.md)
