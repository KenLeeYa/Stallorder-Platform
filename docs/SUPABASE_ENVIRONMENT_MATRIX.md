# Supabase 環境矩陣

任何兩個環境都不得共用 Project ref、URL、API key、Auth user、Storage、database password、Edge secret 或 Turnstile secret。

| 環境 | Application URL | Supabase 專案 | Project ref | Project URL | Git branch | Vercel 環境 | Migration | Edge Functions | RLS | Turnstile hostname |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Development | `http://localhost:3000` | 本機 Supabase CLI | local | `http://127.0.0.1:54321` | feature branches | Development | 本機 27 份已驗證 | 本機 serve | 13 檔／232 項 pgTAP 通過 | localhost／測試政策 |
| Staging | Vercel Preview URL；日後可用 `https://staging.qidaigo.com` | `StallOrder Project`（轉作 Staging；待改顯示名稱） | `daeqwtpaxcebmtwxqdkj` | `https://daeqwtpaxcebmtwxqdkj.supabase.co` | `deployment/production-qidaigo`／PR | Preview | 27 份已套用，版本完全一致 | 待設定 secrets 後部署 | 51/51 強制 RLS；Advisor 已驗證 | 實際 Preview 或 staging hostname |
| Production | `https://app.qidaigo.com` | `stallorder-production` | `eyuctbnlvnbnivwasvqr` | `https://eyuctbnlvnbnivwasvqr.supabase.co` | `main` | Production | 27 份已套用，版本完全一致 | 待 Staging Edge／Preview 通過後部署 | 51/51 強制 RLS；Advisor 已驗證 | `app.qidaigo.com` |

## 資料規則

### Development

- 可使用 `supabase/seed.sql`、demo accounts、demo QR、Turnstile test key。
- 僅允許 loopback URL；不可暴露本機 Supabase 到公開網路。

### Staging

- 只放 synthetic test data，不複製 Production 顧客、Auth user 或 Storage object。
- Preview 必須連到 `daeqwtpaxcebmtwxqdkj`，不得使用 Production database。
- Secret 必須與 Production 獨立；測試 key 是否允許需由 staging Turnstile 政策明確決定。

### Production

- 不執行 `supabase/seed.sql`、`prisma/seed.ts`、`db reset` 或 `db push --include-seed`。
- 不建立 demo account、demo QR 或 synthetic customer order。
- `TURNSTILE_ALLOW_TEST_KEYS=false`、`ALLOW_DEMO_SEED=false`。
- 所有 public schema table 必須同時 `ENABLE ROW LEVEL SECURITY` 與 `FORCE ROW LEVEL SECURITY`。

## 狀態更新責任

建立專案、部署 migration、Edge Function、網域或 Turnstile 後，更新本矩陣的「待」狀態；不得寫入 key、password、connection string 或 secret。
