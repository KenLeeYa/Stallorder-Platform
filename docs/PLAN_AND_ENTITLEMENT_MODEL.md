# 方案與權益模型

## 合約來源

- `plans`：穩定方案識別與目錄狀態。
- `plan_versions`：訂閱合約的價格、週期、額度及 retention 快照。
- `plan_entitlements`：功能是否開啟及功能型限制。
- `subscriptions.plan_version_id`：唯一決定該 Organization 的有效合約。
- React、API 與 Edge Function 不得以 `plan.code === ...` 決定授權。

## 現行方案目錄與歷史合約

新商家只提供 `TRIAL → PAYG` 的標準路徑；需要客製合約、SSO、API 或大規模組織治理時，改由 Platform Admin 人工評估 `ENTERPRISE`。`LITE`、`STANDARD`、`PRO` 不再對新商家銷售，但資料與不可變的方案版本必須保留，供既有訂閱、Invoice、稽核與客服查詢使用。

| 方案 | 月繳 | 年繳 | Included / Max stalls | Staff | Products | QR | Included orders | Retention |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| TRIAL | 0 | 0 | 1 / 1 | 2 | 50 | 1 | 100（hard） | 試用期 |
| PAYG | 0 + 每筆淨完成訂單 TWD 1 | 不適用 | 各攤位獨立計費 | 核心營運可用 | 核心營運可用 | 多組 | 每攤每月 TWD 1,499 封頂 | 依既有資料政策 |
| ENTERPRISE | 人工報價 | 人工報價 | 可設定 | 可設定 | 可設定 | 可設定 | 可設定 | 可設定 |

### 歷史固定月費合約（停止新售）

| 方案 | 月繳 | 年繳 | Included / Max stalls | Staff | Products | QR | Included orders | Retention |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| LITE | 399 | 3,990 | 1 / 1 | 2 | 100 | 1 | 500（soft） | 90 天 |
| STANDARD | 699 | 6,990 | 1 / 10 | 5 | 300 | 5 | 2,000（soft） | 365 天 |
| PRO | 1,190 | 11,900 | 3 / 50 | 15 | 1,000 | 20 | 10,000（soft） | 1,095 天 |

方案價格變更必須新增版本。既有 Subscription 不自動遷移。

PAYG 使用 `USAGE_PER_STALL_CAPPED`，unit price、metric、scope、cap 與 minimum 同時存在 `plans` 目錄與 immutable `plan_versions` 快照。LITE、STANDARD、PRO 的既有版本與 Subscription 保留，但 public offering 關閉；遷移只能由受稽核的 Platform Admin 操作完成。完整合約見 [PAYG_BILLING_MODEL.md](PAYG_BILLING_MODEL.md)。

## PAYG 核心權益

PAYG v1 僅啟用下列明確 allowlist，不從 PRO 複製權益，也不依前端方案名稱推論：`QR_ORDERING`、`MANUAL_CHECKOUT`、`PRODUCT_MANAGEMENT`、`BUSINESS_HOURS`、`MODIFIERS`、`KITCHEN_VIEW`、`BASIC_REPORTS`、`CSV_EXPORT`、`MULTIPLE_QR_CODES`、`MULTI_STALL_BASIC`、`PRINTER_INTEGRATION`。其中列印模組仍需商家於攤位層級選擇啟用。

進階報表、排程報表、自訂品牌、API、Webhook、Custom Domain、White Label、SSO 及其他未列出的功能，不會因 PAYG 自動開啟；需由 ENTERPRISE 或人工審核流程處理。

## 歷史固定月費方案權益摘要

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
- PAYG：不使用 included-order 軟限制；依每攤位可信淨完成訂單計價並套用每月封頂。
- Legacy fixed paid：included orders 採 `SOFT_LIMIT_MANUAL_BILLING`；80/90/100/110% 產生通知，但預設不停止接單。
- Emergency hard cap：資料模型可設定，預設 false；不得由前端自行啟用。
- Count limit：攤位、員工、產品、QR 由 transaction lock 後重新計數再寫入。

## Add-on 狀態

PAYG 的多攤位直接依各攤位用量獨立計費，不販售額外攤位或 order package。舊 `ADDITIONAL_STALL_*` 與 `ORDER_PACKAGE_*` 目錄資料保留但不公開，只供既有固定月費合約及歷史帳務相容；`custom service line item` 僅能由 Platform Admin 人工建立並留下原因。

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
| OPEN_BETA_FREE_ACCESS_ENABLED | true |
| MERCHANT_BILLING_VISIBLE | false |
| PAYG_BILLING_ENABLED / PAYG_NEW_MERCHANTS_ENABLED / PAYG_LEGACY_MIGRATION_ENABLED | false |
| PAYG_REFUND_CREDITS_ENABLED / PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED | false |

`OPEN_BETA_FREE_ACCESS_ENABLED` 只暫時免除 Trial 到期、方案功能及數量限制，不會繞過 Subscription 存在性、`SUSPENDED` 或 `CANCELLED`。開放測試仍記錄可信用量，但 PAYG flags 關閉時不得建立正式 PAYG 帳單。

## 安全錯誤碼

UI 可安全顯示：`FEATURE_NOT_INCLUDED`、`PLAN_LIMIT_REACHED`、`SUBSCRIPTION_NOT_ACTIVE`、`SUBSCRIPTION_SUSPENDED`、`TRIAL_EXPIRED`、`TRIAL_ORDER_LIMIT_REACHED`、`ADDITIONAL_STALL_APPROVAL_REQUIRED`、`ORDER_PACKAGE_REQUIRED`、`UPGRADE_REQUIRED`。

錯誤內容不得包含其他 Organization ID、付款註記、銀行資訊、session/token 或資料庫錯誤細節。
