# 商業計費 Migration 計畫

## 原則

1. 僅新增 migration，不修改 `20260713000560_commercial_and_invitations.sql` 或其他已套用檔案。
2. 所有 schema 變更先在 Local reset 與 database tests 驗證，再套用 Staging。
3. 保留既有 Organization、Stall、User、Membership、Order、Payment、Subscription、Invoice 與 Usage Event。
4. 所有 TWD 金額使用 integer，不使用浮點數。
5. 每個 migration 都要可重跑驗證、具備資料完整性檢查，部署前建立備份／PITR 還原點。

## Migration 順序

### P1 Core

1. 擴充 `plans` 的目錄屬性但不把它當合約快照。
2. 建立 `plan_versions` 並為每個現有方案建立第一版。
3. 將既有 `subscriptions` 回填至對應 `plan_version_id`。
4. 建立 `plan_entitlements` 與方案權益 seed。
5. 建立 `add_on_catalog` 與 Phase 1/disabled Add-on seed。
6. 建立 `subscription_items`。
7. 擴充 Invoice 欄位、Line Item metadata 與狀態 constraint。
8. 建立 database-backed Invoice sequence／counter function。
9. 建立 `manual_payment_records`。
10. 擴充 `usage_events` 支援 `BILLABLE_ORDER_COMPLETED` 與唯一事件。
11. 建立 `billing_usage_summaries`。
12. 建立 `billing_feature_flags`。
13. 建立 `billing_notifications` 與 `notification_outbox`。
14. 為所有新表加入 scope constraint、explicit grants、RLS 與 policy。
15. 建立 plan version、entitlement、add-on、feature flag seed；不建立商家或付款 demo data。

### P2 Enforcement

1. 建立完成訂單首次轉換的 billable usage trigger。
2. 建立鎖定 Organization Subscription 的 limit-check SQL functions。
3. 在公開 order session/order RPC 交易內加入 subscription 與 Trial quota gate。
4. 建立 usage summary rebuild 與 warning reconciliation function。
5. 建立冪等 trial expiration／Invoice overdue／usage warning pg_cron 工作。

### P4 Future Compatibility

只有 P0-P3 Staging 人工驗收通過後才套用：

1. `payment_provider_customers`
2. `payment_attempts`
3. `billing_webhook_events`
4. `tax_documents`
5. `tax_document_events`
6. disabled route contract 與 provider adapter，不建立 provider credential。

## 現有資料回填

- 既有 `plans` 保留原 ID，並建立 version 1。
- 既有 Subscription 依目前 `plan_id` 綁定該 Plan 的 version 1，不改變原方案或狀態。
- 新 TRIAL 方案只供新 onboarding；既有 TRIALING Subscription 不會在 migration 當下被強制停權。
- 既有 Invoice 金額回填：`total_amount = total`、`amount_paid = total` 僅限既有 `PAID`，其他為 0，`amount_due = total - amount_paid`。
- 舊 `ISSUED` Invoice 轉為 `OPEN`；其餘既有狀態保持語意。
- 舊 `ORDER_CREATED` 用量保留作營運資料，不轉換成 billable event。
- 既有已完成訂單建立一次性 `BILLABLE_ORDER_COMPLETED` backfill，依唯一 constraint 防重。

## 驗證查詢

部署後至少確認：

```sql
select count(*) from subscriptions where plan_version_id is null;
select event_type, reference_id, count(*)
from usage_events
where event_type = 'BILLABLE_ORDER_COMPLETED'
group by event_type, reference_id having count(*) > 1;
select id from invoices
where subtotal + tax_amount - discount_amount <> total_amount
   or total_amount - amount_paid <> amount_due;
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in (
  'plan_versions', 'plan_entitlements', 'add_on_catalog', 'subscription_items',
  'manual_payment_records', 'billing_usage_summaries', 'billing_feature_flags',
  'billing_notifications', 'notification_outbox'
);
```

預期：第一、二、三個查詢皆為 0 筆；所有 exposed 表的 RLS 與 force RLS 均為 true。

## 回復策略

- 尚未套用：移除新 migration 並修正後重新 local reset。
- Staging 已套用但未上線：使用 Staging 備份還原，或以新 forward migration 停用 trigger／cron、移除 grants，保留資料供調查。
- Production 已套用：不修改 migration history，不直接 drop 有資料的表；先關閉新 Feature Flag、停止 cron、回復應用程式，必要時由 PITR 還原。
- P4 Adapter 回復：保持所有 provider flags false，停用 route；future tables 可保留，不影響 Phase 1。

## Staging Gate

P4 之前必須在 Staging 完成：

1. 建立/open Invoice 並驗證 server-side total。
2. Merchant 送出 BANK_TRANSFER、CASH、LINE_PAY_MANUAL 測試紀錄。
3. Platform Admin 驗證付款，確認付款、Invoice、Subscription、Audit、Notification 同一交易完成。
4. 完成續約後確認 period 與 plan version 快照。
5. 停權後確認公開 session/order、新攤位／產品／員工／QR 被阻擋，歷史與帳務仍可讀。
6. Trial 期限與 100 筆完成訂單 hard limit。
7. Paid plan 80/90/100/110% 只警告、不在 100% 突然停止接單。
8. RLS cross-organization、Finance Viewer read-only、Staff/Kitchen deny、Anonymous deny。

