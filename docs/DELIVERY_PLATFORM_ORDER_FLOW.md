# 外送平台訂單流程

## 匯入

```text
Signed Webhook
-> verified ledger
-> external order ledger
-> ORDER_IMPORT job
-> verified store/menu/modifier mapping
-> canonical order WAITING_CONFIRMATION
-> staff confirmation
-> KDS production tasks
-> PREPARING / READY provider jobs
```

## Canonical 規則

- `source` 與 `external_provider` 保存 Provider。
- `origin = IMPORTED`。
- Mock Order 設為 `is_test = true`。
- 初始狀態固定 `WAITING_CONFIRMATION`。
- 未經店員確認不得製作或列印。
- External Platform Payment 設為 `PENDING_RECONCILIATION`，不建立現金 Payment。
- Provider 代配送訂單不保存 Provider 擁有的地址與電話；自有外送仍維持地址與電話必填。
- Item Snapshot 保存 Provider 當下品名、數量與價格；內部 Product ID 來自已驗證 Mapping。

## 狀態

- `CONFIRMED`：先向 Provider Accept，成功後以交易更新內部 Order。
- `CANCELLED`：先向 Provider Reject，成功後以交易取消。
- `PREPARING`、`READY`：內部狀態先可靠落庫，再建立去重 Job；Provider 暫時失效不阻塞 KDS。
- `COMPLETED`：完成內部流程，不把平台收款當現金。

## KDS/CDS

KDS 顯示 Provider、External Order Number、預計取餐與 Rider 狀態。CDS 排除 `DELIVERY` 訂單，避免向現場顧客顯示外送騎手訂單；Provider Pickup 可沿用 `TAKEOUT`。
