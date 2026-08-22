# StallOrder 商業帳務架構

## 範圍

Phase 1 提供 14 天試用、人工 Invoice、人工付款確認、訂閱啟用／續約／停權、方案權益、用量計量、額外攤位核准與站內通知。PAYG forward migration 加入每筆淨完成訂單 TWD 1、每攤位每月 TWD 1,499 封頂的可信計費模型；目前由開放測試旗標維持免費，商家帳務介面預設隱藏。Phase 2、Phase 3 僅保留資料結構與 Adapter 介面，所有外部服務均未啟用。

## 信任邊界

```text
Merchant / Platform Admin UI
        -> Next.js RBAC + CSRF + Zod
        -> BillingWorkflowService / EntitlementService
        -> Prisma transaction
        -> Supabase PostgreSQL + RLS + audit log
```

- StallOrder 資料庫是方案、價格、權益、用量及存取狀態的唯一來源。
- 客戶端不得送入可信價格、付款成功狀態或租戶範圍。
- Payment Provider 未來只負責收款與回報，不得成為授權來源。
- Invoice 付款、訂閱啟用及稽核紀錄在同一資料庫交易完成。
- 公開點餐仍由 Edge Function 與資料庫 gate 驗證訂閱及試用額度。

## 主要元件

| 元件 | 責任 | 實作 |
| --- | --- | --- |
| 方案目錄 | 版本化價格、限制與生效區間 | `plans`, `plan_versions` |
| 權益引擎 | 功能、數量限制、訂閱可用性 | `src/server/billing/entitlement-service.ts` |
| 帳務工作流 | Invoice、人工付款、狀態轉換、用量重建 | `src/server/billing/billing-workflow-service.ts` |
| PAYG 工作流 | 明確遷移、每攤位封頂與月份關帳 | `src/server/billing/payg-billing-service.ts` |
| 商家入口 | 方案、用量、Invoice、付款提交 | `/merchant/billing` |
| 平台入口 | Invoice、付款審核、訂閱、方案版本 | `/admin/billing` |
| 稽核與通知 | before/after、request ID、站內通知、outbox | `audit_logs`, `billing_notifications`, `notification_outbox` |
| 未來 Provider | fail-closed Adapter 與 service-only 資料表 | `src/server/billing/providers`, `src/server/e-invoice` |

## 已啟用

- `MANUAL_BILLING_ENABLED=true`
- 現行公開路徑為版本化的 `TRIAL → PAYG`；`ENTERPRISE` 僅供人工報價，`LITE`、`STANDARD`、`PRO` 只保留既有合約與歷史支援。
- `BANK_TRANSFER`, `CASH`, `LINE_PAY_MANUAL`, `OTHER` 人工付款。
- Trial 100 筆完成訂單硬限制；PAYG 依每攤位可信淨完成訂單計費及封頂；只有 legacy 固定月費方案沿用 included-order 軟限制與 80／90／100／110% 警示。
- `TRIALING`, `ACTIVE`, `PAST_DUE`, `GRACE_PERIOD`, `SUSPENDED`, `CANCELLED` 狀態。

## 明確停用

- ECPay、NewebPay、自動扣款、電子發票、Email 帳務通知、自動催收、自動續約。
- 未啟用 webhook 固定 fail closed，不讀取或處理付款內容。
- Mock Provider 僅允許在 `NODE_ENV=test` 建立。

## Migration

1. `20260718224537_commercial_billing_phase1_core.sql`
2. `20260718230704_commercial_billing_entitlement_enforcement.sql`
3. `20260718233000_commercial_billing_phase1_workflows.sql`
4. `20260719015432_commercial_billing_future_provider_scaffolding.sql`
5. `20260821150000_payg_open_beta_billing.sql`

既有 applied migration 不修改。Staging 先 forward migrate、驗證、再安排 Production 維護窗；資料庫 migration 的回復以 PITR 或事前核准的新 forward migration 執行。

## 延伸文件

- [方案與權益](PLAN_AND_ENTITLEMENT_MODEL.md)
- [人工帳務操作](MANUAL_BILLING_OPERATIONS.md)
- [安全控制](BILLING_SECURITY.md)
- [RLS](BILLING_RLS.md)
- [測試計畫](BILLING_TEST_PLAN.md)
- [PAYG 計費模型](PAYG_BILLING_MODEL.md)

