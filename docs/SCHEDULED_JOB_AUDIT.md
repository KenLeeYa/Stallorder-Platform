# 排程工作稽核

## 修改前清冊

| 執行器 | Job | 頻率 | 責任 |
| --- | --- | ---: | --- |
| Supabase pg_cron | `stallorder-expire-unconfirmed-orders` | 每分鐘 | DB 內逾期 WAITING_CONFIRMATION、清理 bucket／attempt |
| Supabase pg_cron | `invoke-vercel-preview-process-orders` | 每 5 分鐘 | 呼叫 Vercel process-orders，再執行相同逾期維護 |
| Supabase pg_cron | `stallorder-report-deliveries` | 每 5 分鐘 | 觸發外部日／週報寄送 |
| Vercel Cron | 無 | - | `vercel.json` 無 crons |
| GitHub Actions schedule | 無 | - | workflows 無 schedule trigger |

`invoke-vercel-preview-process-orders` 與每分鐘 DB-native job 重複處理訂單逾期；另外店員頁與 order polling 原本也同步呼叫同一 RPC。

## 變更

`20260718181009_disable_duplicate_vercel_order_expiry_cron.sql` 先確認 DB-native job 存在且 active，才 unschedule 重複 Vercel job；若前置條件不成立會 fail closed。內部函式與 Vault 設定不刪除，保留可回復性。店員 request path 不再同步維護逾期狀態。

責任切分：

- pg_cron：訂單逾期與純資料庫維護。
- pg_cron + external Edge：報表寄送等外部副作用。
- Vercel request：只讀取目前狀態，不做全域 maintenance。

所有訂單 transition 仍具 idempotency／狀態條件與 audit 行為。

## 驗證與回復

Database test 必須確認重複 job 不存在、每分鐘 DB-native job 仍 active、公開角色不能執行內部 scheduler。緊急回復：

Staging 已實際套用版本 `20260718181009`；套用後只保留 active 的 `stallorder-expire-unconfirmed-orders`，`invoke-vercel-preview-process-orders` 已不存在。

```sql
select cron.schedule(
  'invoke-vercel-preview-process-orders',
  '*/5 * * * *',
  'select internal.invoke_vercel_preview_cron();'
);
```

回復後會再次形成重複處理，只應在 DB-native job 故障且經維運批准時暫時使用。
