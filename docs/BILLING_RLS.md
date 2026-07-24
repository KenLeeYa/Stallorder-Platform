# 帳務 RLS 與資料隔離

## 原則

- 每張 exposed table 啟用 RLS；敏感內部表同時使用 `FORCE ROW LEVEL SECURITY`。
- organization-owned row 必須保存 `organization_id`，關聯表以複合外鍵防止跨組織 Invoice／付款／稅務文件關聯。
- Next.js RBAC 是第一層，RLS／explicit grants 是第二層；任一層都不可單獨視為完整授權。
- Platform Admin 跨組織操作只經受控 server route，不把 service role key 暴露給瀏覽器。

## 角色矩陣

| 資料／操作 | Owner | Finance Viewer | Org Admin | Staff／Kitchen | Platform Admin | Anonymous |
| --- | --- | --- | --- | --- | --- | --- |
| 自有方案、訂閱、Invoice、用量 | 讀 | 讀 | 限定摘要 | 拒絕 | 受控跨組織讀 | 拒絕 |
| 提交人工付款 | 允許 | 拒絕 | 拒絕 | 拒絕 | 可代為受控登錄 | 拒絕 |
| 建立 Invoice／審核付款 | 拒絕 | 拒絕 | 拒絕 | 拒絕 | 允許 | 拒絕 |
| 啟用、停權、恢復訂閱 | 拒絕 | 拒絕 | 拒絕 | 拒絕 | 允許 | 拒絕 |
| Provider／Webhook／Tax future tables | 拒絕 | 拒絕 | 拒絕 | 拒絕 | 僅 server service role | 拒絕 |

## Service-only 表

以下表不建立商家 policy，並撤銷 `public`, `anon`, `authenticated` 權限；只有 `service_role` 有 CRUD grant：

- `billing_feature_flags`
- `notification_outbox`
- `payment_provider_customers`
- `payment_attempts`
- `billing_webhook_events`
- `tax_documents`
- `tax_document_events`

Supabase Advisor 的 `rls_enabled_no_policy` 對這些表為預期資訊提示，不代表應新增可由 Data API 存取的 policy。

## 租戶完整性

- `payment_attempts(invoice_id, organization_id)` 參照 `invoices(id, organization_id)`。
- `tax_documents(invoice_id, organization_id)` 參照 `invoices(id, organization_id)`。
- Invoice、line item、manual payment 與 billing change request 的 organization scope 由 trigger／FK 驗證。
- request body 的 organization ID 仍須與已授權 route parameter 一致；不可用 body 覆寫 session scope。

## 驗證

- pgTAP 測試 anonymous deny、Finance Viewer read-only、Staff/Kitchen deny、cross-organization deny 與 Platform Admin service path。
- 每次新增帳務表都必須驗證 `relrowsecurity`, `relforcerowsecurity`、grants、policy 與正反案例。
- 上線前以 Staging 身分實測，禁止使用 Production customer data。

