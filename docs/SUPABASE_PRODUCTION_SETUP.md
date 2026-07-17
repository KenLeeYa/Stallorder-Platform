# Supabase Production 設定

目標名稱 `stallorder-production`，Organization `KuanGuard`，區域 `ap-northeast-1`。

## Edge 與應用正式部署前置條件

- Supabase 費用已由使用者明確確認。
- Staging 資料庫的 migration／RLS／Advisor 已通過；Edge tests 仍須完成。
- 本機 CI、build 與 npm audit 已通過；Vercel Preview 仍須完成。
- 已備妥 Staging 完全不同的 Production secrets，但不把值寫入檔案。

## 建立與連線

1. `stallorder-production` 已建立，ref 為 `eyuctbnlvnbnivwasvqr`。
2. 專案已確認為 `ACTIVE_HEALTHY`；Project URL 與區域已記錄，未記錄 database password 或 secret key。
3. 從 Supabase 取得實際 Transaction Pooler 與 Direct/Session connection：
   - `DATABASE_URL=<PRODUCTION_DATABASE_URL>`，供 Vercel serverless runtime。
   - `DIRECT_URL=<PRODUCTION_DIRECT_URL>`，供 Prisma migration-compatible connection。
4. 不猜 pooler port、mode 或 connection parameter。

## 正式 Migration

```powershell
npx supabase link --project-ref eyuctbnlvnbnivwasvqr
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

禁止 `db reset`、`--include-seed`、Dashboard 手動改 schema、跳過 migration history 或把 Staging Auth／資料複製進來。

27 份 migration 已套用，遠端版本與 Git timestamp 逐筆一致。Production 目前沒有 Auth user、organization、stall、product、order 或 Storage object；僅有 migration 建立的 4 筆系統方案定義。

## Production Auth 與 API

- Site URL：`https://app.qidaigo.com`。
- Redirect allow list：只加入實際需要的 `https://app.qidaigo.com/auth/callback`；Preview callback 留在 Staging。
- Anonymous sign-in 保持關閉；檢查 password、OAuth、session 與 rate limit 設定。
- 只將 publishable key 暴露給 browser。Supabase secret key 僅放 Vercel server-only variable 或 Edge runtime managed secret。

## 正式 Edge 設定

- `TURNSTILE_EXPECTED_HOSTNAME=app.qidaigo.com`
- `TURNSTILE_ALLOW_TEST_KEYS=false`
- `PUBLIC_APP_ORIGINS=https://app.qidaigo.com`
- `TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`
- `APP_ENV=production`

其餘 secret 必須獨立產生且至少 32 bytes entropy；若需由自動化產生，先取得明確授權，值只寫入 Secret 管理。

## 部署後驗證

- 執行 [PRODUCTION_DATABASE_VALIDATION.md](./PRODUCTION_DATABASE_VALIDATION.md) 與 Security／Performance Advisor。
- 51 個 `public` 資料表已全部啟用並強制 RLS；Security Advisor 無 critical/high，Performance Advisor 無未索引外鍵。
- 部署三個公開 Edge Functions，確認名稱、版本、`verify_jwt=false`、secret presence 與 logs。
- 不建立真實訂單，直到 [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) 的專用測試攤位建立完成。
- Production 有任何 critical/high、migration drift、RLS 失敗或 log 洩密即停止上線。
