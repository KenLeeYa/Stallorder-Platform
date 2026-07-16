# StallOrder 攤點通

StallOrder 是供夜市攤位、餐車、市集商戶、快閃店與小型餐飲業者使用的多租戶 QR 點餐 SaaS。每個部署環境以一套前端、一個獨立 Supabase 專案及一個 PostgreSQL 資料庫服務多個組織；每個組織可管理多個攤位，資料以 `organization_id` 與 `stall_id` 分層，並由 PostgreSQL RLS 強制隔離。

預設語系為台灣繁體中文，時區為 `Asia/Taipei`，幣別為 `TWD`。

## 已完成範圍

- Google OAuth/Supabase Auth 身分連結，以及資料庫式八小時應用 session
- 組織與攤位分層 RBAC、CSRF、登入/API rate limiting 與結構化稽核
- `ORGANIZATION_OWNER`、`ORGANIZATION_ADMIN`、`FINANCE_VIEWER`
- `STALL_MANAGER`、`STAFF`、`KITCHEN`
- 多攤位工作區、攤位切換、建立/編輯/停用與人員指派
- 組織共用商品分類、群組與商品主檔，支援多攤分派、攤位價格覆寫及售罄
- 多攤位儀表板、單攤篩選、跨攤報表、CSV 匯出與每日摘要
- 授權範圍內的 Realtime、SSE/輪詢備援與營運警示
- Lite、Standard、Pro、Enterprise 方案資料、額外攤位核准、invoice line item 與 usage metering
- 高熵、雜湊儲存、七日到期、一次性且比對 Google 驗證 Email 的團隊邀請
- 靜態 QR、10 分鐘短效單次 session、Turnstile 伺服器驗證與多維防濫用限流
- `WAITING_CONFIRMATION` 接單、未確認逾時、即時員工看板、防誤取消、三位取餐碼與人工現金結帳
- 32 張公開業務表啟用且強制 RLS；匿名客戶端不能直接寫入訂單

## 架構摘要

```text
StallOrder
└─ Organization
   ├─ Organization memberships
   ├─ Shared product catalog
   ├─ Subscription / invoices / usage
   ├─ Stall A
   │  ├─ Stall memberships
   │  ├─ Product settings
   │  └─ Orders / payments / summaries
   └─ Stall B
```

- Next.js 16、React 19、TypeScript、Tailwind CSS
- Supabase PostgreSQL、Auth、Realtime、Edge Functions、RLS、pg_cron
- Prisma 只供受信任的 Next.js 後端使用
- Zod、bcrypt、Vitest、pgTAP、Playwright

公開瀏覽器不持有 service role key，也不能直接寫入 `orders`。掃碼 session 與公開訂單只由 Edge Functions 呼叫受限 RPC 建立；價格、供應、數量、攤位狀態、Turnstile 與 session 消耗都在伺服器及同一交易內重新驗證。

## 主要路由

```text
/select-organization                  組織選擇
/select-stall                         攤位選擇
/merchant/dashboard                  多攤位儀表板
/merchant/stalls                     攤位管理
/merchant/catalog                    組織共用商品
/merchant/reports/*                  跨攤位報表
/merchant/team                       組織與攤位邀請/成員
/merchant/subscription               方案、用量與帳務
/staff/:stallSlug                    店員/廚房訂單看板
/q/:qrToken                          顧客掃碼點餐
/order/:trackingToken                顧客訂單追蹤
```

## 本機啟動

需求：Node.js 22 以上、Docker Desktop，以及 Supabase CLI。

```powershell
npm install
Copy-Item .env.example .env
Copy-Item supabase/functions/.env.example supabase/functions/.env
npx supabase start
npm run db:reset
```

分別啟動 Edge Functions 與 Next.js：

```powershell
npm run functions:serve
npm run dev
```

預設網址為 `http://localhost:3000`。若改用其他連接埠，`NEXT_PUBLIC_APP_URL` 與 Edge 的 `PUBLIC_APP_ORIGINS` 必須使用完全相同的 Origin。

示範帳號密碼為 `StallOrderDemo!2026`：

- `owner@stallorder.test`
- `staff@stallorder.test`
- `kitchen@stallorder.test`

示範 QR：`/q/demo-aming-chicken-qr-2026-rotate-me`。正式環境禁止執行示範 seed。

## 驗證

```powershell
npm run lint
npm run typecheck
npm run test
npm run db:test
npx supabase db lint --local
npm run build
npm run test:e2e
npm audit --audit-level=moderate
```

`npm run test:e2e` 只允許連接 `localhost/127.0.0.1` 資料庫，會啟動本機 OAuth 測試端、Next.js 與 Edge Functions。外部 Google 同意頁仍需在 staging/production 使用真實 Google/Supabase 憑證做部署驗收。

## 正式部署

1. 分別建立 Staging 與 Production Supabase 專案；先在 Staging 驗證所有 migration，再以同一版本化歷史部署 Production，且 Production 不執行 demo seed。
2. 設定 Google provider、Site URL 與 `/auth/callback` redirect allow list。
3. 部署 `create-order-session`、`create-public-order`、`get-public-order`，維持 `verify_jwt=false`；函式自行執行 CORS、Turnstile、session 與 rate limit 驗證。
4. 設定 Edge secrets：`ABUSE_HASH_SECRET`、`TOKEN_DERIVATION_SECRET`、`TURNSTILE_SECRET_KEY`、`TURNSTILE_EXPECTED_HOSTNAME`、`PUBLIC_APP_ORIGINS`、`TRUSTED_CLIENT_IP_HEADER`、`APP_ENV=production`。
5. 正式環境設定 `TURNSTILE_ALLOW_TEST_KEYS=false`，且不得使用 Cloudflare 測試金鑰。
6. Next.js 設定資料庫、Supabase、應用 Origin、Turnstile、audit hash 與明確的 `TRUSTED_CLIENT_IP_HEADER`；正式環境維持 `ALLOW_DEMO_SEED=false`。
7. 上線前填入核准的方案底價與超額訂單單價；目前種子保守維持為 0/未設定。
8. 將 stdout 與資料庫安全事件送入集中式監控，完成備份還原與 QR/secret 輪替演練。
9. 設定 `CRON_SECRET`、`RESEND_API_KEY` 與已驗證網域的 `REPORT_FROM_EMAIL`，並依 [Supabase Report Delivery Cron](docs/SUPABASE_REPORT_DELIVERY_CRON.md) 設定 Vault 後確認排程報表寄送紀錄。

詳細步驟見 [多攤位維運手冊](docs/MULTI_STALL_OPERATIONS.md)。

`qidaigo.com` 的完整環境隔離、Supabase、Vercel、Turnstile、DNS、smoke test、bootstrap 與 rollback 流程見 [正式部署總覽](docs/PRODUCTION_DEPLOYMENT_QIDAIGO.md)。

## 文件

- [架構](docs/MULTI_STALL_ARCHITECTURE.md)
- [資料庫 Schema](docs/MULTI_STALL_DATABASE_SCHEMA.md)
- [遷移計畫](docs/MULTI_STALL_MIGRATION_PLAN.md)
- [RLS 與權限](docs/MULTI_STALL_RLS.md)
- [儀表板與報表](docs/MULTI_STALL_DASHBOARD.md)
- [Realtime 與警示](docs/MULTI_STALL_REALTIME.md)
- [方案與計價](docs/MULTI_STALL_PRICING.md)
- [測試計畫](docs/MULTI_STALL_TEST_PLAN.md)
- [維運手冊](docs/MULTI_STALL_OPERATIONS.md)
- [後續議題](docs/MULTI_STALL_GITHUB_ISSUES.md)
- [安全基線](docs/SECURITY.md)
- [監控基線](docs/MONITORING.md)
- [P2 排程報表寄送](docs/P2_REPORT_DELIVERY.md)
- [Supabase 報表排程 Cron](docs/SUPABASE_REPORT_DELIVERY_CRON.md)
- [qidaigo.com 正式部署](docs/PRODUCTION_DEPLOYMENT_QIDAIGO.md)
- [Go-Live Checklist](docs/GO_LIVE_CHECKLIST.md)
