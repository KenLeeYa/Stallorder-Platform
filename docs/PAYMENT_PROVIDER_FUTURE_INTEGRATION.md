# Payment Provider 未來整合（停用）

## 現況

- `ManualBillingProvider` 啟用，僅建立 StallOrder 內部人工付款流程。
- `MockBillingProvider` 僅測試環境可用。
- `EcpayBillingProvider`、`NewebpayBillingProvider` 為 disabled stub，所有方法丟出 `BILLING_PROVIDER_NOT_CONFIGURED`。
- `/api/billing/webhooks/ecpay` 與 `/api/billing/webhooks/newebpay` 在停用時回 404 `SERVICE_NOT_ENABLED`，不讀 body、不寫資料。
- `AUTOMATED_BILLING_ENABLED`, `ECPAY_BILLING_ENABLED`, `NEWEBPAY_BILLING_ENABLED` 均為 false。

## Future table

- `payment_provider_customers`
- `payment_attempts`
- `billing_webhook_events`

Provider event ID 與 transaction ID 具唯一約束；Webhook 只保存 payload hash。Payment Attempt 與 Invoice 以 organization 複合外鍵綁定。

## Webhook 必要順序

```text
限制 body size
-> 驗證 Provider signature 與 timestamp
-> 計算 payload hash
-> 檢查 provider event idempotency
-> 對照 payment attempt / invoice / organization
-> 核對 amount 與 currency
-> 單一 DB transaction 更新付款、Invoice、Subscription、audit、outbox
-> 回應 Provider
```

Browser redirect 只供 UX，不得標記付款成功。只有驗證過的 server-to-server callback 或受信任的 payment query 可改變 Invoice。

## 啟用前檢查

- Provider 正式申請、sandbox 與 production credential 分離。
- Callback domain、TLS、DNS、IP／簽章政策依官方規格驗證。
- Invalid signature、replay、duplicate event、amount mismatch、currency mismatch、late event、out-of-order event 全部測試。
- Refund、partial refund、timeout、retry、Provider outage 與人工對帳 runbook 完成。
- Secret 存 Secret Manager，權限最小化並可輪替。
- 先啟用個別 Provider flag，再以 canary merchant 驗證；任何未配置狀態仍 fail closed。

