# Supabase Report Delivery Cron

StallOrder 的排程報表寄送由 Supabase Postgres 執行，不使用 Vercel Cron。這樣可以保留每 5 分鐘處理一次待寄送報表，同時避免 Vercel Hobby Preview 被 Cron 最短每日一次限制擋住。

## 執行流程

1. `pg_cron` 每 5 分鐘執行 `stallorder-report-deliveries`。
2. Cron command 呼叫 `app_private.invoke_due_report_deliveries()`。
3. 函式從 Supabase Vault 讀取：
   - `stallorder_report_delivery_url`
   - `stallorder_report_delivery_cron_secret`
4. 函式透過 `pg_net` 呼叫 `GET /api/cron/report-deliveries`，並帶上 `Authorization: Bearer <CRON_SECRET>`。
5. Next.js API route 仍會用現有 `CRON_SECRET` 驗證，不信任來源端。

Cron command 只儲存函式呼叫，不會把 bearer token 寫入 `cron.job.command`。

## Vault 設定

每個環境在目標網址確認後，各自建立 Vault secrets：

```sql
select vault.create_secret(
  'https://<preview-or-production-host>/api/cron/report-deliveries',
  'stallorder_report_delivery_url',
  'StallOrder report delivery cron URL'
);

select vault.create_secret(
  '<same value as Vercel CRON_SECRET>',
  'stallorder_report_delivery_cron_secret',
  'StallOrder report delivery cron bearer secret'
);
```

Production URL 應為：

```text
https://app.qidaigo.com/api/cron/report-deliveries
```

Staging 請使用 Preview 成功後的實際 Vercel Preview 或 branch URL。若 Vault 尚未設定，資料庫函式會 no-op，並以 notice 顯示 `REPORT_DELIVERY_CRON_NOT_CONFIGURED`。

## 安全注意事項

- `app_private` 不是公開 API schema。
- `anon` 與 `authenticated` 沒有 schema usage，也沒有函式 execute 權限。
- 函式使用 `security definer`，但釘住空 `search_path`，並限制 URL 必須是 HTTPS 且路徑結尾為 `/api/cron/report-deliveries`。
- Vercel 仍必須設定 `CRON_SECRET`，因為公開 route 仍需要 bearer token 驗證。
- 正式寄信前，Production 不可維持 `REPORT_DELIVERY_MODE=simulate`。
