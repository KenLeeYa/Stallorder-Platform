# Vercel 正式環境設定

目標 Team：`ada76145-8663's projects`。目標專案：`stallorder-platform`。GitHub repository：`KenLeeYa/Stallorder-Platform`。Framework：Next.js。Production branch：`main`。

目前 Vercel Team 沒有專案，因此需建立或由第一次 deployment 自動建立。

## USER ACTION REQUIRED

- 將敏感 variables 直接設定於 Vercel Dashboard／CLI Secret flow，不要貼在聊天或文件。
- 在 GitHub／Vercel 啟用必要 CI check，確保 `main` 的 Production deployment 不早於 CI 成功。
- 啟用 Production Environment approval／deployment protection（方案支援時）。

## 建立／連結專案

1. 連接 GitHub repository，專案名稱設 `stallorder-platform`，Root Directory 為 repository root。
2. Framework preset 使用 Next.js；保留 `npm run build` 與 npm lockfile。
3. Production branch 設 `main`；`deployment/production-qidaigo` 只能產生 Preview。
4. 保留 `vercel.json` 的 report delivery Cron；Production 必須有 `CRON_SECRET`。

## 環境隔離

- Development：本機／開發值。
- Preview：只用 `<STAGING_SUPABASE_PROJECT_REF>`、Staging database、Staging Turnstile。
- Production：只用 `<PRODUCTION_SUPABASE_PROJECT_REF>`、`<PRODUCTION_DATABASE_URL>`、`<PRODUCTION_DIRECT_URL>` 與 Production Turnstile。

完整 variable 清單見 [PRODUCTION_ENVIRONMENT_VARIABLES.md](./PRODUCTION_ENVIRONMENT_VARIABLES.md)。Preview 與 Production 設定後，各自重新部署，因為 `NEXT_PUBLIC_` 值會在 build 時寫入 client bundle。

## Preview Gate

從 `deployment/production-qidaigo` 建立 Preview，確認：

- build 成功，`/`、`/login`、merchant／staff route 與 `/q/:token` 可載入。
- `/api/health` 回傳最小 `{status,timestamp}`，不暴露 DB detail。
- 未登入 merchant API 為 401／403。
- Preview 連 Staging，不會寫 Production。
- CSP、HSTS（Preview HTTPS）、nosniff、Referrer、Permissions、frame-ancestors 正確。
- HTML／client JS 沒有 Supabase secret key、database URL、Turnstile secret、OAuth secret。

```powershell
$env:PRODUCTION_BASE_URL='https://<ACTUAL_PREVIEW_URL>'
$env:SMOKE_SKIP_DOMAIN_REDIRECTS='true'
npm run production:smoke
```

## Production Gate

只在 Staging migration／RLS／Advisor／Edge tests、Preview smoke、CI 全部通過後執行。Production deployment 必須對應已通過 CI 的 `main` commit；不得從未提交 working tree 直接上正式環境。

部署後掃描 Vercel build/runtime logs，確認沒有 5xx 或 secret，再執行 [PRODUCTION_SMOKE_TEST.md](./PRODUCTION_SMOKE_TEST.md)。

## 網域

加入：

- `app.qidaigo.com`：primary production domain。
- `qidaigo.com`：redirect 到 `https://app.qidaigo.com`。
- `www.qidaigo.com`：redirect 到 `https://app.qidaigo.com`。

加入後以 Vercel Project Domain API／Dashboard／`vercel domains inspect` 取得每個網域實際 A／CNAME／TXT 與驗證狀態，再填入 [GODADDY_DNS_SETUP.md](./GODADDY_DNS_SETUP.md)。不得使用網路文章的通用記錄代替專案回傳值。
