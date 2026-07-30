# 外送平台整合架構

## 狀態

- 已實作：Provider-neutral Domain、資料表、RLS、工作佇列、商家與平台管理介面、Mock Provider。
- 已實作但預設關閉：全部外送 Feature Flag 與方案 Entitlement。
- 僅合成驗證：Mock OAuth、Mock Webhook、訂單匯入、KDS 狀態同步。
- 尚未啟用：Uber Eats、foodpanda 正式連線與任何正式商家流量。

## 元件

```text
Provider Webhook
  -> /api/webhooks/delivery/:provider
  -> Adapter.verifyWebhook()
  -> delivery_webhook_events
  -> external_orders
  -> delivery_sync_jobs
  -> canonical orders / order_items
  -> KDS

Merchant UI -> Connection / Store / Menu Mapping services
Admin UI    -> Request review / Connection lifecycle
Cron        -> PostgreSQL job claim -> Adapter action
```

程式邊界：

- Adapter：`src/server/delivery-platforms/delivery-platform-adapter.ts`
- Provider Registry：`src/server/delivery-platforms/delivery-platform-registry.ts`
- Webhook：`src/server/delivery-platforms/webhook-service.ts`
- Canonical Order Writer：`src/server/delivery-platforms/external-order-service.ts`
- Job Worker：`src/server/delivery-platforms/sync-job-service.ts`
- Merchant API：`src/app/api/merchant/integrations/delivery/**`
- Admin API：`src/app/api/admin/delivery-*/**`

## 資料權威

`orders` 與 `order_items` 仍是唯一營運訂單來源。`external_orders` 是平台事件與對帳帳本，不是第二套訂單系統。平台付款一律使用 `PENDING_RECONCILIATION`，不建立現金 `payments`，也不納入現金交班。

## Provider 隔離

使用者登入 OAuth 與商家外送平台連線分屬不同資料表、狀態、Secret Reference、Callback 與稽核事件。Provider Token 不得授予 StallOrder RBAC，也不得寫入公開資料表。

## 生命週期

```text
DRAFT -> PENDING_REVIEW -> APPROVED -> CONNECTING
      -> TESTING -> ACTIVE -> PAUSED -> DISCONNECTED
```

只有後端可變更生命週期。商家提出申請與選擇門市；平台管理員審查；正式啟用仍受 Provider Approval、Feature Flag、Entitlement 與 Production Canary 四層限制。
