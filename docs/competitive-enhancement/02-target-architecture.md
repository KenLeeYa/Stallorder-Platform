# 目標架構

```text
QR / Staff POS / LINE / Delivery / Partner API
                    |
           Server-side Auth + RBAC
                    |
      Canonical Order + Catalog + Customer
       /        |        |         \
     KDS      Growth   Supply     Event
       \        |        |         /
            Domain Outbox/Inbox
                    |
     Provider Adapters / Signed Webhooks
                    |
       Audit, Metrics, Retry, DLQ, Alerts
```

## 邊界

- Browser 只送意圖；價格、狀態、權限、庫存與歸因由 server 判定。
- Organization/Stall scope 必須出現在資料與授權查詢中。
- 內部事件使用既有 Outbox/Inbox；外部 Provider 透過 Adapter 與 Integration Registry。
- Secret 只儲存 reference 或 hash；API Key 只在建立時顯示一次。
- 新模組透過 Feature flag 漸進開啟，預設不影響現有訂單流程。

## 一致性原則

- 訂單與庫存異動使用 idempotency key；庫存 ledger 不可變。
- 菜單發布使用 immutable version、checksum 與 publication receipt。
- 活動歸因必須在兩條公開下單路徑達成 parity 後才可寫入。
- Webhook 投遞要有 HMAC、timestamp、retry、dead-letter 與 replay audit。
