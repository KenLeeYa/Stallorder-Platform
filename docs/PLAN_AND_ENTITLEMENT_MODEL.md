# 方案與權益模型

## 合約來源

- `plans`：穩定方案識別與目錄狀態。
- `plan_versions`：訂閱合約的價格、週期、額度及 retention 快照。
- `plan_entitlements`：功能是否開啟及功能型限制。
- `subscriptions.plan_version_id`：唯一決定該 Organization 的有效合約。
- React、API 與 Edge Function 不得以 `plan.code === ...` 決定授權。

## 初始方案版本

| 方案 | 月繳 | 年繳 | Included / Max stalls | Staff | Products | QR | Included orders | Retention |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| TRIAL | 0 | 0 | 1 / 1 | 2 | 50 | 1 | 100（hard） | 試用期 |
| LITE | 399 | 3,990 | 1 / 1 | 2 | 100 | 1 | 500（soft） | 90 天 |
| STANDARD | 699 | 6,990 | 1 / 10 | 5 | 300 | 5 | 2,000（soft） | 365 天 |
| PRO | 1,190 | 11,900 | 3 / 50 | 15 | 1,000 | 20 | 10,000（soft） | 1,095 天 |
| ENTERPRISE | 2,990 起 | 報價 | 可設定 | 可設定 | 可設定 | 可設定 | 可設定 | 可設定 |

方案價格變更必須新增版本。既有 Subscription 不自動遷移。

## Phase 1 權益摘要

| Feature | TRIAL | LITE | STANDARD | PRO | ENTERPRISE |
| --- | --- | --- | --- | --- | --- |
| QR_ORDERING / MANUAL_CHECKOUT / PRODUCT_MANAGEMENT / BASIC_REPORTS | 開 | 開 | 開 | 開 | 可設定 |
| BUSINESS_HOURS | 關 | 開 | 開 | 開 | 可設定 |
| MODIFIERS / KITCHEN_VIEW / STAFF_ROLES / MULTIPLE_QR_CODES | 關 | 關 | 開 | 開 | 可設定 |
| CSV_EXPORT / PRODUCT_SALES_REPORT / PAYMENT_REPORT | 關 | 關 | 開 | 開 | 可設定 |
| MULTI_STALL_BASIC | 關 | 關 | 開 | 開 | 可設定 |
| MULTI_STALL_DASHBOARD / ADVANCED_REPORTS | 關 | 關 | 關 | 開 | 可設定 |
| SCHEDULED_REPORTS / CUSTOM_BRANDING / AUDIT_VIEWER / OPERATIONAL_ALERTS | 關 | 關 | 關 | 開 | 可設定 |
| PRINTER_INTEGRATION | 關 | 關 | 關 | 包含；攤位層級選擇啟用 | 包含且可設定；攤位層級選擇啟用 |
| API_ACCESS / WEBHOOK_ACCESS / CUSTOM_DOMAIN / WHITE_LABEL / SSO | 關 | 關 | 關 | 關 | 可設定且需人工核准 |

Legacy PRO 與 ENTERPRISE v1 由中央 server-side entitlement resolver 提供 `PRINTER_INTEGRATION` 相容權益。此規則只在 entitlement snapshot 缺少該功能資料列時生效；既有資料列（包括明確停用）仍優先，也不會自動開啟任何攤位的 `print_module_enabled`。

這項相容規則只涵蓋 legacy v1。之後建立 PRO 或 ENTERPRISE 版本時，必須在不可變的 entitlement snapshot 中明確寫入 `PRINTER_INTEGRATION`，不得依方案 code 或 legacy 規則動態推論。

## 限制策略

- Trial：期限或 `BILLABLE_ORDER_COMPLETED` 達 100 任一成立，即阻擋新的 public order session 與 public order。
- Paid：included orders 採 `SOFT_LIMIT_MANUAL_BILLING`；80/90/100/110% 產生通知，但預設不停止接單。
- Emergency hard cap：資料模型可設定，預設 false；不得由前端自行啟用。
- Count limit：攤位、員工、產品、QR 由 transaction lock 後重新計數再寫入。

## Add-on 狀態

Phase 1 可用：額外攤位、人工 order package、custom service line item。

Phase 1 只顯示且不自動化：Custom Domain、Scheduled Reports、White Label、API Access。狀態只允許 `COMING_SOON` 或 `MANUAL_APPROVAL_REQUIRED`。

`add_on_catalog` 的 Printer Integration 仍只代表尚未自動化的列印訂閱 add-on 目錄項目；其 `COMING_SOON` 狀態與 PRO／ENTERPRISE 已包含的方案權益是兩份獨立合約，不表示系統已支援自動購買、計費或開通列印 add-on。

## Server-only Feature Flags

| Flag | 預設 |
| --- | --- |
| MANUAL_BILLING_ENABLED | true |
| AUTOMATED_BILLING_ENABLED | false |
| ECPAY_BILLING_ENABLED | false |
| NEWEBPAY_BILLING_ENABLED | false |
| E_INVOICE_ENABLED | false |
| EMAIL_BILLING_NOTIFICATIONS_ENABLED | false |
| AUTOMATIC_DUNNING_ENABLED | false |
| AUTOMATIC_RENEWAL_ENABLED | false |
| AUTOMATIC_OVERAGE_BILLING_ENABLED | false |
| COUPONS_ENABLED / PRORATION_ENABLED / CUSTOMER_BILLING_PORTAL_ENABLED | false |
| RESELLER_BILLING_ENABLED / PARTNER_BILLING_ENABLED | false |
| BILLING_ANALYTICS_ADVANCED_ENABLED | false |

## 安全錯誤碼

UI 可安全顯示：`FEATURE_NOT_INCLUDED`、`PLAN_LIMIT_REACHED`、`SUBSCRIPTION_NOT_ACTIVE`、`SUBSCRIPTION_SUSPENDED`、`TRIAL_EXPIRED`、`TRIAL_ORDER_LIMIT_REACHED`、`ADDITIONAL_STALL_APPROVAL_REQUIRED`、`ORDER_PACKAGE_REQUIRED`、`UPGRADE_REQUIRED`。

錯誤內容不得包含其他 Organization ID、付款註記、銀行資訊、session/token 或資料庫錯誤細節。
