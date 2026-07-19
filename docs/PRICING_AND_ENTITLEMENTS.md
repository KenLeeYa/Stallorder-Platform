# 方案與權益規格

## Source of truth

- `plans`：方案設定。
- `subscriptions`：每 organization 一筆目前 subscription。
- `additional_stall_approvals`：人工額外攤位 entitlement。
- `invoices/invoice_line_items`：帳期與費用證據。
- `usage_events`：訂單、攤位、人員、QR、CSV 用量。

UI 只能顯示上述資料，不能用方案名稱自行推斷權限。

## 方案表

| Code | Included stalls | Additional | Max | 備註 |
| --- | ---: | ---: | ---: | --- |
| LITE | 1 | disabled | 1 | 單攤 |
| STANDARD | 1 | NT$299/月 | 10 | 人工核准 |
| PRO | 3 | NT$199/月 | 50 | 人工核准 |
| ENTERPRISE | configurable | configurable | configurable | 依合約 |

Base fee、included orders、excess order price 目前未取得核准商務值，種子是 0/NULL。正式上線前依 [MULTI_STALL_GITHUB_ISSUES.md](MULTI_STALL_GITHUB_ISSUES.md) 完成。

## Subscription 狀態

可營運/讀取 workspace：`TRIALING`、`ACTIVE`、`PAST_DUE`、`GRACE_PERIOD`。`SUSPENDED/CANCELLED` 不得新建攤位或繼續一般授權流程。實際 grace 策略由商務合約決定，不在 client 寫死。

## Entitlement 演算法

```text
if subscription inactive → deny
if active stalls >= max_stalls → deny
if next stall <= included_stalls → allow
if next stall <= included + active approved extras → allow
otherwise → additional approval required
```

判斷與建立 stall 在同一 transaction 鎖定 subscription，防止並行超額。

## Billing

```text
base plan
+ approved additional stalls × approved unit price
+ excess orders × plan excess order price
+ add-ons
```

Approval 保存當下 unit price，避免後續 plan 改價回算既有 invoice。Invoice total 必須等於 line items/subtotal 加總，修正以新 line item/audit 處理。

## 權限

- Organization Owner：管理方案/帳務與檢視用量。
- Finance Viewer：唯讀報表、帳務、用量與 CSV。
- Organization Admin：營運管理，不可變更 subscription。
- Stall roles：只看其功能所需資料。
- Platform Admin：人工核准額外攤位、記錄 charge。

## 驗收

- Lite 第二攤拒絕。
- Standard/Pro included 數量內允許。
- 未核准額外攤位拒絕；核准後允許；到期/撤銷後拒絕。
- Max stalls 永遠優先阻擋。
- 並行建立不越界。
- Invoice line/total、usage dedupe 與 audit 正確。
- Finance 只能讀；商戶不能自行授予 platform approval。

更多計價與對帳細節見 [MULTI_STALL_PRICING.md](MULTI_STALL_PRICING.md)。

## 版本化與執行來源

正式價格、年繳價格、included orders、上限與 feature codes 均以 `plan_versions`／`plan_entitlements` 為準，React 與 API 不以方案名稱判斷授權。既有訂閱鎖定特定版本；調價建立新版本。完整矩陣與超額行為見 [PLAN_AND_ENTITLEMENT_MODEL.md](PLAN_AND_ENTITLEMENT_MODEL.md) 及 [USAGE_METERING.md](USAGE_METERING.md)。
