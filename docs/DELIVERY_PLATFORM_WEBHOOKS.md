# 外送平台 Webhook

## Endpoint

```text
POST /api/webhooks/delivery/:provider
```

目前可自動測試的 Provider 為 `mock`。Uber Eats 與 foodpanda Endpoint 存在於同一 Provider-neutral Route，但正式 Adapter 預設拒絕。

## 請求控制

- `Content-Type: application/json`
- 最大 128 KB
- PostgreSQL-backed Rate Limit
- Connection Selector 只用於尋找候選連線，不是驗證憑證
- Provider Adapter 在 Server 端驗證 Signature
- Strict Event Schema
- Payload Hash 與 Provider Replay Key

## 處理順序

1. 驗證 Feature Flag、Connection 與 Entitlement。
2. 讀取一次 Raw Body 並計算 Hash。
3. Adapter 驗證 Signature 及 Provider Event。
4. 交易內寫入 Webhook Ledger、External Order Ledger 與 Import Job。
5. 唯一 Replay Key 回傳安全的 Duplicate Acknowledgement。

簽章失敗、Payload Hash 不符、Store/Scope 錯誤都會寫入不含 Raw Payload 的拒絕帳本。只有找到同一 Replay Key 的既有事件時，Database Unique Conflict 才可視為合法重播。

## Mock 簽章

Local/Ephemeral Preview 使用 HMAC-SHA256 與每次工作流生成的專用 Secret。Mock Runtime 在 Vercel Production 或一般 Production Node Runtime 會硬拒絕。
