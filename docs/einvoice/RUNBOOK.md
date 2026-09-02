# Local Mock Runbook

## 啟用前檢查

1. 確認 `APP_ENV` 為 local/test/development，且不是實際 Production runtime。
2. `EINVOICE_PRODUCTION_ISSUE_ENABLED=false`。
3. 套用 local migration，執行 Prisma generate。
4. 以具有 `MANAGE_PAYMENT_INTEGRATIONS` 的商家帳號進入 `/merchant/integrations/e-invoice?organizationId=...`。

## 操作

1. 建立 Mock 賣方、connection 與 policy。
2. 使用已付款且已完成訂單開立 TEST 文件。
3. 驗證 query、void、allowance、allowance void 及 reconcile。
4. 在 admin `/admin/e-invoice` 查看唯讀聚合狀態。

## 異常處理

- `EINVOICE_MOCK_FORBIDDEN`：runtime 被判定為 Production，停止操作，不覆寫 gate。
- `*_CONTRACT_NOT_VERIFIED`：live adapter 正常 fail-closed，不改用猜測 endpoint。
- timeout/5xx：查 operation ledger 與 reconciliation，避免未知成功時重複開立。
- dead-letter：人工確認 remote state，再以新的 idempotency key 執行核准動作。

## 回復

關閉 platform/checkout/mock flags 即可停止入口；不得刪除既有文件、operation 或 policy history。Production rollback 不在本機 Mock 授權範圍內。
