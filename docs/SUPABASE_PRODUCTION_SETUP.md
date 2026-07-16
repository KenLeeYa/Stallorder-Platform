# Supabase Production 設定

目標名稱 `stallorder-production`，Organization `KuanGuard`，區域 `ap-northeast-1`。

## 前置必要條件

- Supabase 費用已由使用者明確確認。
- `stallorder-staging` 健康、migration／RLS／Advisor／Edge tests 全部通過。
- 本機 CI、build、npm audit 與 Vercel Preview 均通過。
- 已備妥 Staging 完全不同的 Production secrets，但不把值寫入檔案。

## 建立與連線

1. 以 Supabase cost confirmation 建立 `stallorder-production`，ref 記為 `<PRODUCTION_SUPABASE_PROJECT_REF>`。
2. 等待 `ACTIVE_HEALTHY`；記錄 Project URL 與區域，不記錄 database password 或 secret key。
3. 從 Supabase 取得實際 Transaction Pooler 與 Direct/Session connection：
   - `DATABASE_URL=<PRODUCTION_DATABASE_URL>`，供 Vercel serverless runtime。
   - `DIRECT_URL=<PRODUCTION_DIRECT_URL>`，供 Prisma migration-compatible connection。
4. 不猜 pooler port、mode 或 connection parameter。

## 正式 Migration

```powershell
npx supabase link --project-ref <PRODUCTION_SUPABASE_PROJECT_REF>
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

禁止 `db reset`、`--include-seed`、Dashboard 手動改 schema、跳過 migration history 或把 Staging Auth／資料複製進來。

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
- 部署三個公開 Edge Functions，確認名稱、版本、`verify_jwt=false`、secret presence 與 logs。
- 不建立真實訂單，直到 [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md) 的專用測試攤位建立完成。
- Production 有任何 critical/high、migration drift、RLS 失敗或 log 洩密即停止上線。
