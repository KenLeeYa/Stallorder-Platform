# Entitlement Engine

中央實作位於 `src/server/billing/entitlement-service.ts`，負責 Subscription 可用性、有效 Plan Version、feature、數量限制、帳期用量與 warnings。

核准建立的 Trial Organization 立即沿用此 engine。設定測試單只在資料庫層豁免 Trial／order package 的訂單額度；`SUBSCRIPTION_NOT_ACTIVE`、`SUBSCRIPTION_SUSPENDED`、feature 與 tenant scope 仍 fail closed。

重要錯誤碼包括：`FEATURE_NOT_INCLUDED`、`PLAN_LIMIT_REACHED`、`SUBSCRIPTION_NOT_ACTIVE`、`SUBSCRIPTION_SUSPENDED`、`TRIAL_EXPIRED`、`TRIAL_ORDER_LIMIT_REACHED`、`ADDITIONAL_STALL_APPROVAL_REQUIRED`、`ORDER_PACKAGE_REQUIRED` 與 `UPGRADE_REQUIRED`。

開放測試期間，`OPEN_BETA_FREE_ACCESS_ENABLED=true` 會暫時略過 Trial 到期、方案功能與數量限制；它不會略過 Organization 的 Subscription 關聯，也不會略過 `SUSPENDED` 或 `CANCELLED`。同一邊界同時存在於 Next.js entitlement service 與資料庫 order/resource gate。

前端提示不是授權來源；重要寫入仍由 Server、transaction lock、constraint 與 RLS 共同執行。
