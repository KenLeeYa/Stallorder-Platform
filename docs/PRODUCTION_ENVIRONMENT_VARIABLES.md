# Production Environment Variables

所有值都由平台 Secret／Environment 管理。`NEXT_PUBLIC_` 只可放可公開的 URL、publishable key 或 Site Key；database、Supabase secret、Turnstile secret、hash secret、OAuth secret、Cron secret 都是 server-only。

## Vercel variables

| Variable | Preview | Production | 敏感 | 用途 |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Staging Transaction Pooler | `<PRODUCTION_DATABASE_URL>` | 是 | Prisma serverless runtime |
| `DIRECT_URL` | Staging direct/session URL | `<PRODUCTION_DIRECT_URL>` | 是 | Prisma validate／migration-compatible connection |
| `NEXT_PUBLIC_APP_URL` | 實際 Preview／staging URL | `https://app.qidaigo.com` | 否 | OAuth、CSRF origin、QR links |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Project URL | Production Project URL | 否 | Supabase Auth/browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Staging active publishable key | Production active publishable key | 否 | Browser Supabase client |
| `SUPABASE_SECRET_KEY` | Staging secret key | Production secret key | 是 | 受信任 server 的 Storage 管理；不得進 client bundle |
| `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` | `https://<STAGING_SUPABASE_PROJECT_REF>.supabase.co/functions/v1` | `https://<PRODUCTION_SUPABASE_PROJECT_REF>.supabase.co/functions/v1` | 否 | Public order Edge API |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Staging Site Key | `<PRODUCTION_TURNSTILE_SITE_KEY>` | 否 | Turnstile widget |
| `AUDIT_IP_HASH_SECRET` | Staging unique secret | Production unique secret | 是 | Next.js audit IP HMAC |
| `TRUSTED_CLIENT_IP_HEADER` | `x-forwarded-for` | `x-forwarded-for` | 否 | Vercel 覆寫的單一 client IP header |
| `ALLOW_DEMO_SEED` | `false` | `false` | 否 | 正式 guardrail |
| `LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT` | `false` | `false` | 否 | 只能在雙 loopback 本機 QA 使用 |
| `CRON_SECRET` | Staging unique secret | Production unique secret | 是 | Vercel Cron authorization |
| `RESEND_API_KEY` | Staging key | Production key | 是 | 排程報表寄送 |
| `REPORT_FROM_EMAIL` | 已驗證 staging sender | 已驗證 qidaigo.com sender | 否 | 報表寄件者 |
| `REPORT_DELIVERY_MODE` | `simulate` 或 staging policy | `live` | 否 | 正式不得 simulate |

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

`staging` 與 `production` Environment 各自設定：

- Secret `SUPABASE_ACCESS_TOKEN`
- Secret `SUPABASE_DB_PASSWORD`
- Variable `SUPABASE_PROJECT_REF`

`production-readiness.yml` 只做 migration list、dry-run 與 lint，不自動套 Production migration。Production Environment 應設定必要 reviewer。

## Supabase Auth provider

Google OAuth Client Secret 只放 Supabase Auth provider 設定；Preview 與 Production redirect URI 分開 allow list。不得建立 `NEXT_PUBLIC_GOOGLE_CLIENT_SECRET`。

## 驗證與輪替

設定後只列 variable 名稱與環境，不匯出值。每次 rotate database password、Supabase key、Turnstile、hash、Cron 或寄信 key 後，重新部署對應環境並執行 smoke test；記錄輪替時間與 operator，不記錄舊值或新值。
