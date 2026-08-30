# Domain Model

| 模型 | 目的 | 主要限制 |
|---|---|---|
| `InvoiceSellerProfile` | 每組織的法律賣方資料 | 統編只存遮罩／測試資料；驗證狀態明確 |
| `InvoiceProviderConnection` | 商家自有 Provider 帳號 | secret 只存 reference，不回傳明文 |
| `InvoicePolicyVersion` | 開票時點與稅務策略快照 | append-only、有效期間不可重疊 |
| `InvoiceCheckoutPreference` | 顧客每筆訂單的選項 | 載具加密，safe snapshot 遮罩／雜湊 |
| `InvoiceDocument` | 訂單發票法律生命週期的內部記錄 | 每訂單只允許一張 original；金額為 integer |
| `InvoiceProviderOperation` | Provider 操作帳本 | tenant-scoped idempotency；operation identity 不可變 |
| `InvoiceReconciliationCase` | 遠端／本地差異的人工案件 | 差異不自動改帳 |

## 狀態獨立

合法且預期的組合包括：`Order=COMPLETED`、`Payment=PAID`、`Invoice=ISSUE_FAILED`。發票失敗只進 retry 或人工處理，不得取消訂單或退款。

## 金額與快照

- 所有金額使用最小貨幣單位整數。
- `totalAmount = salesAmount + taxAmount` 在 adapter boundary 驗證。
- 本機 Mock 不推導真實稅務，固定使用明確的 `MOCK_NOT_TAX_DETERMINED`。
- 賣方、買方與 policy 都在開立時快照，避免事後設定變更改寫歷史。

