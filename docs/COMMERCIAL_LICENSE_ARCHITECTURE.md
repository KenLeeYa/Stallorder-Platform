# 商用授權架構

正式商用授權單位是 `Organization`，不是 Stall、Google metadata、license key 或前端方案名稱。

```text
Merchant Application
  -> approved Organization
  -> one Subscription
  -> immutable Plan Version
  -> Plan Entitlements + Subscription Items
  -> Usage Events + Billing Usage Summary
  -> Invoice + Manual Payment
```

核准服務直接建立既有資料模型所需的 Trial Subscription，不建立第二套授權狀態。公開 QR、Next.js API 與資料庫 enforcement 仍透過 `EntitlementService` 及 billing SQL functions 判斷可用性。

詳細元件、信任邊界、migration 與停用 provider 見 [COMMERCIAL_BILLING_ARCHITECTURE.md](COMMERCIAL_BILLING_ARCHITECTURE.md)。商家申請銜接見 [MERCHANT_APPLICATION_ARCHITECTURE.md](MERCHANT_APPLICATION_ARCHITECTURE.md)。
