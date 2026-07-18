# StallOrder 資料庫連線效能檢查

## 責任分離

`prisma/schema.prisma` 維持 PostgreSQL provider：

- `DATABASE_URL`：Vercel request runtime 使用。
- `DIRECT_URL`：Prisma migration 與管理作業使用。
- 任何 URL 都不寫入 source、文件、log 或 health response。

Vercel authenticated API 已確認 Production／Preview 各自存在 Sensitive `DATABASE_URL` 與 `DIRECT_URL`。Sensitive env pull 只回傳 `[SENSITIVE]`，所以本機無法讀回值；不得把「變數存在」誤寫成「內容已驗證」。

## Runtime 要求

依目前 Supabase Prisma／Supavisor guidance，serverless runtime 應使用 Transaction Pooler；本專案檢查條件為：

- hostname 為 Supabase pooler。
- port 為 `6543`。
- Prisma transaction pooling 使用 `pgbouncer=true`，避免不相容的 prepared statements。
- `connection_limit` 是否存在只記錄布林值；實際值須依 Supabase Connect 顯示與方案連線額度決定，不能猜測。
- Migration 使用 `DIRECT_URL` 或核准的 Session Pooler／Direct connection，通常為 `5432`。

參考：[Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma)、[Supabase prepared statements troubleshooting](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL)。

## 安全 runtime profile

`src/lib/database-connection-profile.ts` 只解析 URL 並回傳下列布林值：

```text
configured
validPostgresUrl
usesSupavisor
usesTransactionPort
disablesPreparedStatements
hasConnectionLimit
```

`/api/health` 只把這些布林值寫入 private runtime JSON log；response 仍只有 status/timestamp，且 `cache-control: no-store`。不得加入 hostname、username、password、query string 或 URL。

## Prisma Client reuse

- `src/lib/prisma.ts` 是 lazy singleton。
- Development 由 `globalThis.prisma` 重用。
- Production 在單一 Function instance 內重用 module-scoped client。
- import module 不會要求 `DATABASE_URL`；第一次資料庫存取才驗證。
- `src/lib/prisma.test.ts` 驗證 lazy import、缺值錯誤與 Development reuse。

## 環境隔離

- Preview 必須指向 Staging project `daeqwtpaxcebmtwxqdkj`。
- Production 必須指向 Production project `eyuctbnlvnbnivwasvqr`。
- P0 Preview 部署後，以 `DATABASE_CONNECTION_PROFILE` 布林 log 驗證 pooler mode；project 對應仍應在 Vercel Dashboard 以變數來源／environment scope 人工複核，不讀回 Secret。

## 手動 Dashboard 複核

1. Supabase Staging／Production 各自開啟 **Connect**。
2. Runtime 選擇 Transaction Pooler，核對顯示的 Prisma-compatible 參數。
3. Vercel `stallorder-platform` 的 Preview scope 對應 Staging；Production scope 對應 Production。
4. `DIRECT_URL` 只供 migration／admin，不加 `NEXT_PUBLIC_`。
5. 儲存後重新部署對應 environment，再檢查安全布林 log；不得把 URL 貼進 issue、PR 或 log。

## P0 驗證狀態

部署前：env 名稱與 scope 已確認；實際值因 Sensitive 保護不可讀回。部署後結果將記錄於本文件與 `docs/REGION_ALIGNMENT.md`。
