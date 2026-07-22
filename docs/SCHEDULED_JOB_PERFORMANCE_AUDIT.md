# 排程工作效能稽核

## 稽核來源

- `vercel.json`：僅指定 `hnd1`，沒有 Vercel Cron 宣告。
- `src/app/api/cron/process-orders/route.ts`：保留受驗證的外部呼叫端點，但 Vercel 本身未排程。
- `supabase/migrations/*cron*.sql`：資料庫原生訂單到期、報告寄送及舊 Preview 呼叫排程。
- `.github/workflows`：沒有 GitHub Actions cron。

## 發現

Production 在稽核時有三個 active jobs：

| Job | 頻率 | 責任 | 判定 |
| --- | --- | --- | --- |
| `stallorder-expire-unconfirmed-orders` | 每分鐘 | 資料庫內訂單到期 | 保留，正確 owner |
| `invoke-vercel-preview-process-orders` | 每 5 分鐘 | 再次呼叫訂單到期流程 | 重複，且 Production 不應依賴 Preview URL |
| `stallorder-report-deliveries` | 每 5 分鐘 | 鎖定並處理報告寄送 | 保留，具不同責任 |
| `stallorder-notification-jobs` | 每 1 分鐘 | 呼叫 Vercel 處理 LINE 非同步通知工作 | 保留，外部供應商工作且使用唯一工作鍵防重複 |
| `stallorder-line-link-session-cleanup` | 每 5 分鐘 | 清除逾時 LINE OAuth session 與 Vault 暫存 secret | 保留，純資料庫安全維護 |

Staging 已只有訂單到期與報告寄送，重複的 Preview job 已不存在。

## P2 修改

新增 migration：

`supabase/migrations/20260718181009_disable_duplicate_vercel_order_expiry_cron.sql`

Migration 先驗證資料庫原生到期 job 存在且 active；條件不成立會直接失敗，不會留下無人處理的到期訂單。驗證成功後才移除所有同名的重複 Vercel job。

同時移除六個頁面/API/Edge request path 的到期掃描。結果是固定每分鐘一次資料庫工作，不再因顧客掃碼或店員重新整理而增加全域掃描。

## 責任分工

- Supabase `pg_cron`：訂單到期、資料庫內摘要/清理與必要的資料庫狀態維護。
- 應用程式 request：執行當次操作的條件式狀態驗證，不掃描全域到期資料。
- 外部排程：僅用於郵件、通知或其他確實需要 HTTP/外部 API 的工作。

所有既有冪等與 audit 行為保留。訂單確認仍以目前狀態與 `confirmation_expires_at` 條件更新，不能利用最多一分鐘的排程間隔確認過期訂單。

## Rollback

只有在資料庫原生 job 已確認故障，且 `/api/cron/process-orders` 的驗證、Vercel bypass 與 Vault 設定仍有效時，才可緊急恢復舊排程：

```sql
select cron.schedule(
  'invoke-vercel-preview-process-orders',
  '*/5 * * * *',
  'select internal.invoke_vercel_preview_cron();'
);
```

恢復前必須先確認沒有同名 job，避免再次建立重複排程。正常 rollback 應優先修復並重新啟用 `stallorder-expire-unconfirmed-orders`，而不是長期依賴 Preview HTTP 路徑。

## 驗證

`supabase/tests/database/vercel_preview_process_orders_cron.test.sql` 會同時驗證：

1. 重複 Vercel job 不存在。
2. 資料庫原生每分鐘到期 job 仍 active。
3. 內部函式權限邊界維持原狀。

本機 pgTAP 共 264 項通過。Production migration 僅能在 Preview/Staging 全部驗證後依正式部署步驟套用。
