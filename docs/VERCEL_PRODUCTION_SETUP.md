# Vercel 正式環境設定

目標 Team：`ada76145-8663's projects`。目標專案：`stallorder-platform`。GitHub repository：`KenLeeYa/Stallorder-Platform`。Framework：Next.js。Production branch：`main`。

Vercel Team 已有 `stallorder-platform` 正式專案；以下建立步驟僅供災難復原或
重新連結時參考，不得在日常發布流程重建專案。

## USER ACTION REQUIRED

- 將敏感 variables 直接設定於 Vercel Dashboard／CLI Secret flow，不要貼在聊天或文件。
- 在 GitHub／Vercel 啟用必要 CI check，確保 `main` 的 Production deployment 不早於 CI 成功。
- 啟用 Production Environment approval／deployment protection（方案支援時）。

## 建立／連結專案

1. 連接 GitHub repository，專案名稱設 `stallorder-platform`，Root Directory 為 repository root。
2. Framework preset 使用 Next.js；保留 `npm run build` 與 npm lockfile。
3. Production branch 設 `main`；`deployment/production-qidaigo` 只能產生 Preview。
4. `vercel.json` 不宣告 Vercel Cron；報表排程改由 Supabase `pg_cron + pg_net + Vault` 執行。Production 仍必須有 `CRON_SECRET` 保護 `/api/cron/report-deliveries`。

## 環境隔離

- Development：本機／開發值。
- Preview：只用 `<STAGING_SUPABASE_PROJECT_REF>`、Staging database、Staging Turnstile。
- Production：只用 `<PRODUCTION_SUPABASE_PROJECT_REF>`、`<PRODUCTION_DATABASE_URL>`、`<PRODUCTION_DIRECT_URL>` 與 Production Turnstile。

完整 variable 清單見 [PRODUCTION_ENVIRONMENT_VARIABLES.md](./PRODUCTION_ENVIRONMENT_VARIABLES.md)。Preview 與 Production 設定後，各自重新部署，因為 `NEXT_PUBLIC_` 值會在 build 時寫入 client bundle。

## Preview Gate

後端驗證只使用 `Ephemeral Preview Validation` 建立的 PR 專屬 Vercel URL；它
連到同一流程建立的 data-less Supabase Branch。Vercel 自動建立的通用 Git
Preview 只作 build／前端訊號，不可連到 Production Primary 或 DR。下列
`Preview` 均指這個配對且隔離的 URL。

由 `Ephemeral Preview Validation` 建立配對 Preview，確認：

- build 成功，`/`、`/login`、merchant／staff route 與 `/q/:token` 可載入。
- `/api/health` 回傳最小 `{status,timestamp}`，不暴露 DB detail。
- 未登入 merchant API 為 401／403。
- Preview 只連同一個 PR 的 data-less Supabase Branch，不會寫 Production。
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

本專案只管理應用網域；品牌網站由獨立的公開網站專案管理：

- `app.qidaigo.com`：primary production domain。
- `qidaigo.com`：StallOrder／攤點通品牌公開網站的 canonical domain。
- `www.qidaigo.com`：以永久 301／308 redirect 到 `https://qidaigo.com/`。

調整前需分別從應用與公開網站專案的 Domain API／Dashboard 取得實際 A／CNAME／TXT 與驗證狀態，再填入 [GODADDY_DNS_SETUP.md](./GODADDY_DNS_SETUP.md)。不得使用舊文件或網路文章的通用記錄代替專案回傳值。
