# 資料庫連線效能

## 程式責任

- `prisma/schema.prisma`：PostgreSQL provider；`DATABASE_URL` 給 runtime，`DIRECT_URL` 給 migration／管理操作。
- `src/lib/prisma.ts`：延遲建立 Prisma Client；Development 存於 `globalThis`，Production 每個 Function instance 重用一個 client。
- `src/lib/database-connection-profile.ts`：只輸出安全布林值，不輸出 hostname、帳號、密碼、query value 或完整 URL。

搜尋結果只有 `src/lib/prisma.ts` 的 runtime client 與 `prisma/seed.ts` 的一次性 seed client，沒有 per-request `new PrismaClient()`。

## Production／Preview 已確認項目

Vercel authenticated CLI 已確認兩個環境都有名為 `DATABASE_URL` 與 `DIRECT_URL` 的 Sensitive 變數；Vercel 不允許本機讀回內容，因此未假裝驗證其值。部署後可在 private runtime logs 查閱 `DATABASE_CONNECTION_PROFILE` 的布林欄位，不會出現在 health response。

Preview deployment `dpl_6pFaHauh8vibRwUmYXH5QLzQeitF` 的安全布林 log 已實際確認：

```text
runtimeConfigured=true
runtimeValid=true
runtimeSupavisor=true
runtimeTransactionPort=true
runtimePgbouncerMode=true
runtimeConnectionLimitConfigured=false
directConfigured=true
directValid=true
directMigrationPort=true
```

因此 Preview runtime 已使用 Supavisor transaction pooler，migration 連線也分離正確；目前唯一缺口是 `DATABASE_URL` 未配置 `connection_limit`。此值應由 Supabase Connect 面板重新複製／確認後再更新 Preview 與 Production Sensitive 變數，不在程式、PR 或日誌中重建 URL。

Runtime `DATABASE_URL` 應由 Supabase Connect 面板複製 Transaction Pooler 設定：

- Supavisor host，通常 port `6543`。
- `pgbouncer=true`，避免 transaction pooling 的 prepared statement 衝突。
- serverless 初始建議 `connection_limit=1`，再依 Vercel concurrency 與 Supabase connection metrics 調整。
- TLS 參數必須使用 Supabase 當前 Connect 面板提供的值，不手動猜測。

Migration `DIRECT_URL` 應使用 direct 或 session pooler 的 `5432` 連線，且只由 migration／管理工作使用。不得在瀏覽器變數加上 `NEXT_PUBLIC_`。

## 部署後檢查

在 Vercel runtime logs 確認：

```text
runtimeConfigured=true
runtimeValid=true
runtimeSupavisor=true
runtimeTransactionPort=true
runtimePgbouncerMode=true
runtimeConnectionLimitConfigured=true
directConfigured=true
directValid=true
directMigrationPort=true
```

若任一 runtime pooler 欄位為 false，請在 Vercel Production 與 Preview 重新由 Supabase Connect 面板建立變數，再 redeploy；不可把 URL 貼進 issue、PR、日誌或 commit。

## 效能判讀

連線建立時間無法由 Prisma query API 精確拆出，因此 `dbConnectMs` 只在有獨立連線階段的程式路徑記錄，不以猜測值填入。`/api/health` 的 `dbMs`、Vercel Function duration、Supabase connection metrics 與 `pg_stat_statements.mean_exec_time` 應合併判讀。

對齊 `hnd1` 後，Preview health log 的 warm `totalMs` 約 13.4-20.0 ms、`dbMs` 約 12.7-19.5 ms；從台灣經 `hkg1` 量到的 HTTP warm P75 為 131.7 ms。
