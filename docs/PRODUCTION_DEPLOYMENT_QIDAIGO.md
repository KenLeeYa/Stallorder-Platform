# StallOrder qidaigo.com 正式部署總覽

本文件是 `deployment/production-qidaigo` 分支的上線執行入口。產品名稱為 StallOrder（攤點通），正式主機為 `https://app.qidaigo.com`，預設時區 `Asia/Taipei`、幣別 `TWD`。

## 目前執行狀態

| 項目 | 狀態 | 已確認內容 |
| --- | --- | --- |
| GitHub | 已連線 | `KenLeeYa/Stallorder-Platform`，預設分支 `main`，Private repository |
| 部署分支 | 已建立 | `deployment/production-qidaigo` |
| Supabase Organization | 已找到 | `KuanGuard`，ID `urxujyhcggjgwsjtleys` |
| Supabase 費用 | 已查詢、待使用者確認 | 每個新專案 0／月；兩個合計 0／月 |
| 既有 Supabase | 保留為開發環境 | 已有健康的 `StallOrder Project`；不改名、不作正式用途 |
| Staging／Production Supabase | 尚未建立 | 必須先取得明確費用同意 |
| Vercel | 已連線 | Team `ada76145-8663's projects`；目前沒有專案 |
| Turnstile Production Widget | 尚未建立 | 需由 Cloudflare Dashboard 手動建立 |
| GoDaddy DNS | 尚未變更 | 必須等 Vercel 回傳專案專屬記錄，禁止猜值 |

## USER ACTION REQUIRED

1. 明確同意在 `KuanGuard` 建立 `stallorder-staging` 與 `stallorder-production`。Supabase 回報每個專案 0／月，兩個合計 0／月。
2. 建立 Cloudflare Turnstile Production Widget，並分別將 Site Key 與 Secret Key 放入 Vercel／Supabase Secret 管理。
3. 提供或自行設定 Staging 與 Production 各自獨立的資料庫密碼、Edge secrets、Vercel variables、OAuth 與寄信憑證。不得在訊息、Git 或 Markdown 貼出 secret 值。
4. Vercel 加入網域後，依 [GODADDY_DNS_SETUP.md](./GODADDY_DNS_SETUP.md) 的 Vercel 實際回傳值手動修改 DNS。
5. 在 GitHub 建立 `staging` 與 `production` Environment；Production 設必要審核者，並將 `CI` 設為 `main` 必要檢查。

除上述人工項目外，其餘工作可繼續自動執行。

## 實際儲存庫與原規格差異

- 專案是 Next.js 16 App Router、React 19、Prisma 6、Supabase PostgreSQL／Auth／Realtime／Edge Functions，不是純 Supabase client 專案。
- Prisma 僅由可信任的 Next.js 後端使用，`DATABASE_URL` 與 `DIRECT_URL` 都是 server-only。
- 目前共有 26 份版本化 migration 與 12 個 pgTAP 測試檔；`supabase/seed.sql` 是 Development demo seed。
- 公開 Edge Functions 是 `create-order-session`、`create-public-order`、`get-public-order`，三者刻意使用 `verify_jwt=false`，並自行驗證 CORS、QR、短效 session、Turnstile、限流、冪等與權限。
- Vercel 必要 variables 不只原提示列出的連線字串，還包括 Supabase public URL／publishable key、server secret key、報表 Cron 與寄信設定；完整清單見 [PRODUCTION_ENVIRONMENT_VARIABLES.md](./PRODUCTION_ENVIRONMENT_VARIABLES.md)。
- 程式使用明確白名單 `TRUSTED_CLIENT_IP_HEADER`，而非 `TRUST_PROXY_HEADERS`。Vercel 應設 `x-forwarded-for`；Supabase Edge 應依平台實際 gateway 使用 `cf-connecting-ip`，兩者不可互換或接受任意 header。
- `vercel.json` 已有每五分鐘執行報表寄送的 Cron，正式環境必須設定 `CRON_SECRET`。
- 原 README 的「單一 Supabase 專案」正式部署敘述已不適用；Development、Staging、Production 必須完全隔離。

## 上線順序與阻擋條件

1. 本機驗證：`npm ci`、Prisma generate/validate、lint、typecheck、unit、pgTAP、db lint、build、npm audit。
2. Staging：建立專案、比對 migration history、dry-run、套 migration、RLS／Advisor、Edge secrets/functions、Preview smoke test。
3. Production：重複 migration history 與 dry-run，只套版本化 migration，不含 seed；完成 RLS／Advisor。
4. Vercel：Preview 僅連 Staging；所有測試通過後才建立 Production deployment。
5. 網域：加入三個網域並取得 Vercel 的確切 DNS 要求；GoDaddy 人工作業後再驗證 DNS、HTTPS 與 redirect。
6. Bootstrap：建立最小正式管理資料，攤位維持關閉、QR 維持暫停；完成實流測試才開單。
7. Go-Live：完成 [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)，任何阻擋項目未完成都不得接真實訂單。

以下任何一項失敗都阻擋 Production：lint、typecheck、unit tests、database tests、migration drift、db lint、RLS、Security Advisor critical/high、build、Preview smoke test、Turnstile hostname、HTTPS。

## 監控與備份基線

- 監控 Vercel Application Logs、Supabase Database／Auth／Realtime／Edge Function Logs，以及外部 `/api/health` uptime。
- 告警至少涵蓋 Edge 5xx、Turnstile 失敗、rate limit、session replay、QR mismatch、待確認逾時、DB connection／CPU／disk、Cron 失敗。
- 啟用 Supabase 平台備份；另做每週 logical backup、Storage object backup，並定期在隔離環境執行 restore test。CSV 匯出不算資料庫備份。
- Log 與警示不得包含 QR 明文 token、session token、pickup code、資料庫連線字串或任何 secret。

## 文件索引

- [SUPABASE_ENVIRONMENT_MATRIX.md](./SUPABASE_ENVIRONMENT_MATRIX.md)
- [SUPABASE_STAGING_SETUP.md](./SUPABASE_STAGING_SETUP.md)
- [SUPABASE_PRODUCTION_SETUP.md](./SUPABASE_PRODUCTION_SETUP.md)
- [PRODUCTION_DATABASE_VALIDATION.md](./PRODUCTION_DATABASE_VALIDATION.md)
- [PRODUCTION_EDGE_FUNCTION_VALIDATION.md](./PRODUCTION_EDGE_FUNCTION_VALIDATION.md)
- [VERCEL_PRODUCTION_SETUP.md](./VERCEL_PRODUCTION_SETUP.md)
- [TURNSTILE_PRODUCTION_SETUP.md](./TURNSTILE_PRODUCTION_SETUP.md)
- [PRODUCTION_ENVIRONMENT_VARIABLES.md](./PRODUCTION_ENVIRONMENT_VARIABLES.md)
- [PRODUCTION_SMOKE_TEST.md](./PRODUCTION_SMOKE_TEST.md)
- [PRODUCTION_BOOTSTRAP.md](./PRODUCTION_BOOTSTRAP.md)
- [PRODUCTION_ROLLBACK.md](./PRODUCTION_ROLLBACK.md)
- [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)
