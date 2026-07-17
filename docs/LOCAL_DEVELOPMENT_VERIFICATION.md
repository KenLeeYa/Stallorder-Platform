# StallOrder 本機開發與驗證基準

本文件定義 Windows 本機開發、Vercel Preview 驗證、Prisma/Supabase 連線與 secret 管理基準。所有指令都避免輸出 secret 值。

## 1. 套件管理與版本

- Package manager: `npm`
- Lockfile: `package-lock.json`
- Node.js: `24.x`
- 專案版本檔: `.node-version`
- Vercel Project Node.js: `24.x`

不要混用 `pnpm`、`yarn`、`bun`。若未來要切換 package manager，必須同時更新 `packageManager`、lockfile、CI/Vercel build 文件與本文件。

## 2. 必要工具檢查

```powershell
$PSVersionTable
winget --version
git --version
node --version
npm --version
docker --version
docker compose version
npx vercel --version
npx supabase --version
codex --version
```

本機 Supabase stack 需要 Docker Desktop。若 Docker Engine 未啟動，`npm run db:reset` 與 `npm run db:test` 會失敗，但不影響 Vercel Preview build。

## 3. 安裝與本機驗證

```powershell
npm ci
npm run local:doctor
npx prisma format
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
```

若 Docker Desktop 已啟動，再執行：

```powershell
npm run db:reset
npm run db:test
```

不要在一般 Vercel Build 或 Production DB 上執行：

```text
prisma migrate dev
prisma migrate reset
prisma db push --accept-data-loss
```

Production migration 僅能在明確核准、確認備份與 rollback 策略後使用：

```powershell
npx prisma migrate deploy
```

## 4. Prisma 與 Supabase 連線規則

`prisma/schema.prisma` 必須保留：

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

- `DATABASE_URL`: runtime connection string，Vercel serverless 應使用 Supabase Transaction Pooler。
- `DIRECT_URL`: migration/direct 用途，使用 Supabase Direct 或 Session Pooler。
- 不得硬編碼任何帳號、密碼或 connection string。
- 不得將 `DATABASE_URL` 或 `DIRECT_URL` 加上 `NEXT_PUBLIC_`。

## 5. Prisma Client Singleton

Prisma Client 初始化位於 `src/lib/prisma.ts`。

要求：

- import module 時不可立刻建立資料庫連線。
- 第一次 Prisma query 時才驗證 `DATABASE_URL` 並建立 client。
- Development 使用 `globalThis` 保存 client，避免 hot reload 重複建立。
- Production 每個 serverless instance 重用單一 client，降低連線耗盡風險。
- 錯誤訊息只能顯示缺少的 env 名稱，不得顯示 env 值。

## 6. Next.js App Router Rendering

首頁 `/` 已設定：

```ts
export const dynamic = "force-dynamic";
```

這可避免 Vercel/Next.js build 將首頁誤納入 static export 時提前觸發 runtime database path。若其他頁面在 build 階段需要資料庫查詢，應逐頁判斷是否也需要 dynamic rendering；不得用吞錯方式掩蓋資料庫錯誤。

## 7. Vercel Environment Variables

至少確認下列變數名稱存在於 Production 與 Preview：

```text
DATABASE_URL
DIRECT_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
NEXT_PUBLIC_TURNSTILE_SITE_KEY
AUDIT_IP_HASH_SECRET
TRUSTED_CLIENT_IP_HEADER
CRON_SECRET
```

`CRON_API_SECRET` 目前用於 `/api/cron/process-orders`，Preview 已需要；Production 若要啟用相同 cron，也必須設定。

安全規則：

- `vercel env ls` 只可確認變數名稱，不可輸出值。
- 不要執行會把 secret 印到 terminal 的命令。
- `.env.local`、`.env.production.local`、`.vercel/project.json` 不可提交。

## 8. Secret Hygiene

`.gitignore` 必須保留：

```gitignore
.env*
!.env.example
.vercel
```

提交前檢查：

```powershell
git status --short
git ls-files | Select-String -Pattern "\.env|\.vercel"
git diff --cached
```

禁止提交：

- Database password
- Full `DATABASE_URL` / `DIRECT_URL`
- Supabase `service_role` key
- Supabase access token
- Vercel token
- OpenAI API key

若發現 secret 曾進入 commit 或 terminal log，先 rotate secret，再評估是否需要清理 Git history。

## 9. Vercel Preview 驗證

Preview build 通過後再測：

```powershell
npx vercel env ls preview --project stallorder-platform --scope team_MMfsiG94K9Zy3e6w7Ccc9xY4 --non-interactive
```

只確認名稱，不讀值。

可用 Vercel connector 或受保護 URL 工具測：

- `/api/health` 應回 `200`
- `/` 若有 Deployment Protection，可能回 SSO redirect，這不等同 app build 失敗。

## 10. 人工待辦

需要人工確認或核准的項目：

- Vercel OAuth login
- Supabase OAuth login 或 `SUPABASE_ACCESS_TOKEN`
- Production environment variable 設定
- Production migration approval
- Production deployment approval
- Docker Desktop 啟動與公司 proxy/WSL2/Hyper-V 問題排除

## 11. 快速狀態指令

```powershell
npm run local:doctor
npm run typecheck
npm test
npm run build
```

`local:doctor` 只輸出 secret 名稱與 PASS/FAIL/WARN，不輸出 secret 值。
