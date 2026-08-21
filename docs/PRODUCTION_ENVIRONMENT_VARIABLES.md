# Production Environment Variables

所有值都由平台 Secret／Environment 管理。`NEXT_PUBLIC_` 只可放可公開的 URL、publishable key 或 Site Key；database、Supabase secret、Turnstile secret、hash secret、OAuth secret、Cron secret 都是 server-only。

## Vercel variables

下表的 `Preview` 指 `Ephemeral Preview Validation` 在每次 PR 執行時產生並只
注入該次部署的隔離值，不是 Vercel 專案的持久 Preview variables；不得把
Production Primary、Production DR 或舊 Staging 連線填入通用 Git Preview。

| Variable | Preview | Production | 敏感 | 用途 |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | PR 專屬 Branch Transaction Pooler | `<PRODUCTION_DATABASE_URL>` | 是 | Prisma serverless runtime |
| `DIRECT_URL` | PR 專屬 Branch direct/session URL | `<PRODUCTION_DIRECT_URL>` | 是 | Prisma validate／migration-compatible connection |
| `NEXT_PUBLIC_APP_URL` | 配對 Vercel Preview URL | `https://app.qidaigo.com` | 否 | OAuth、CSRF origin、QR links |
| `NEXT_PUBLIC_SUPABASE_URL` | PR 專屬 Branch URL | Production Project URL | 否 | Supabase Auth/browser |
| `NEXT_PUBLIC_SUPABASE_REALTIME_URL` | PR 專屬 Branch URL；與 Auth 相同時可省略 | Production Project URL；與 Auth 相同時可省略 | 否 | Browser Realtime；未設定時沿用 `NEXT_PUBLIC_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | PR 專屬 Branch publishable key | Production active publishable key | 否 | Browser Supabase client |
| `SUPABASE_SECRET_KEY` | 僅在配對流程需要時注入 Branch secret | Production secret key | 是 | 受信任 server 的 Storage 管理；不得進 client bundle |
| `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` | `https://<PR_PREVIEW_PROJECT_REF>.supabase.co/functions/v1` | `https://<PRODUCTION_SUPABASE_PROJECT_REF>.supabase.co/functions/v1` | 否 | Public order Edge API |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 隔離測試策略；不得用 Production key | `<PRODUCTION_TURNSTILE_SITE_KEY>` | 否 | Turnstile widget |
| `AUDIT_IP_HASH_SECRET` | 每次流程產生的獨立值 | Production unique secret | 是 | Next.js audit IP HMAC |
| `TRUSTED_CLIENT_IP_HEADER` | `x-forwarded-for` | `x-forwarded-for` | 否 | Vercel 覆寫的單一 client IP header |
| `ALLOW_DEMO_SEED` | `false` | `false` | 否 | 正式 guardrail |
| `LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT` | `false` | `false` | 否 | 只能在雙 loopback 本機 QA 使用 |
| `CRON_SECRET` | 每次流程產生的獨立值 | Production unique secret | 是 | `/api/cron/report-deliveries` bearer authorization；Supabase Vault 需保存同值供資料庫排程呼叫 |
| `RESEND_API_KEY` | 不注入；Preview 不寄真實郵件 | Production key | 是 | 排程報表寄送 |
| `REPORT_FROM_EMAIL` | 不注入 | 已驗證 qidaigo.com sender | 否 | 報表寄件者 |
| `REPORT_DELIVERY_MODE` | `simulate` | `live` | 否 | 正式不得 simulate |

本專案沒有 `TRUST_PROXY_HEADERS`；不要新增未實作的 variable。Vercel 官方邊緣層會覆寫 `x-forwarded-for`，程式仍只接受單一合法 IP，拒絕逗號鏈與任意 header 名稱。

## Supabase Edge secrets

| Variable | Staging | Production | 敏感 |
| --- | --- | --- | --- |
| `ABUSE_HASH_SECRET` | 獨立高熵值 | 不同的獨立高熵值 | 是 |
| `TOKEN_DERIVATION_SECRET` | 獨立高熵值 | 不同的獨立高熵值 | 是 |
| `TURNSTILE_SECRET_KEY` | Staging secret | `<PRODUCTION_TURNSTILE_SECRET_KEY>` | 是 |
| `TURNSTILE_EXPECTED_HOSTNAME` | 實際 staging hostname | `app.qidaigo.com` | 否 |
| `TURNSTILE_ALLOW_TEST_KEYS` | 明確 staging policy | `false` | 否 |
| `PUBLIC_APP_ORIGINS` | 精確 Preview／staging origins | `https://app.qidaigo.com` | 否 |
| `TRUSTED_CLIENT_IP_HEADER` | `cf-connecting-ip` | `cf-connecting-ip` | 否 |
| `APP_ENV` | `staging` | `production` | 否 |

`ABUSE_HASH_SECRET` 與 `TOKEN_DERIVATION_SECRET` 不可相同。若授權自動產生，使用至少 48 random bytes；命令輸出直接導入 Secret 管理，不回顯到報告。

## GitHub Environment secrets／variables

`Preview` Environment 設定：

- Secret `SUPABASE_ACCESS_TOKEN`
- Secret `VERCEL_TOKEN`
- Secret `VERCEL_AUTOMATION_BYPASS_SECRET`
- Variable `SUPABASE_PARENT_PROJECT_REF`
- Variable `VERCEL_ORG_ID`
- Variable `VERCEL_PROJECT_ID`

`production` Environment 設定：

- Secret `SUPABASE_ACCESS_TOKEN`
- Variable `SUPABASE_PROJECT_REF`

`production` Environment 另外設定：

- Secret `PRODUCTION_TEST_QR_URL`（同源專用 `/q/<token>`，不得回顯 token）

`production-readiness.yml` uses the access token to obtain a short-lived
Postgres login role through the linked IPv4 Supavisor endpoint. A long-lived
`SUPABASE_DB_PASSWORD` secret is not required by this workflow.

`production-readiness.yml` 預設只做 migration list、dry-run 與 lint；只有手動選擇
`apply_migrations=true` 且前置檢查全部成功時，才會套用 Production migration。
Apply 會要求 `PRODUCTION_TEST_QR_URL`，在 promote 前部署並以
`supabase functions list` 驗證所有 repository Edge Functions，最後執行不可略過
專用 QR 的 Production smoke。
Production Environment 應設定必要 reviewer。

## Supabase Auth provider

Google OAuth Client Secret 只放 Supabase Auth provider 設定；Preview 與 Production redirect URI 分開 allow list。不得建立 `NEXT_PUBLIC_GOOGLE_CLIENT_SECRET`。

## 驗證與輪替

設定後只列 variable 名稱與環境，不匯出值。每次 rotate database password、Supabase key、Turnstile、hash、Cron 或寄信 key 後，重新部署對應環境並執行 smoke test；記錄輪替時間與 operator，不記錄舊值或新值。
